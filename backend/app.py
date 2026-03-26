# Detection of Fake Reviews & Rating Manipulation: Backend API
# FastAPI + Heuristic-Based Analysis

from __future__ import annotations
import os
import logging
import traceback
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any, List, Dict, Optional
import numpy as np
from datetime import datetime
import re
import math
from collections import Counter, defaultdict

from db import db, insert_analysis, get_analysis_by_product, insert_label, get_labels, insert_audit
from ml_model import train_from_labeled_reviews, predict_fake_probability
from ollama_client import query_qwen

app = FastAPI(title="TrustGuard API", version="2.0.0")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("trustguard")

ENABLE_ML = os.getenv("ENABLE_ML", "1") == "1"
MODEL_TRAIN_THRESHOLD = int(os.getenv("MODEL_TRAIN_THRESHOLD", "30"))


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)

# ==================== DATA MODELS ====================

class ReviewInput(BaseModel):
    product_id: str
    reviews: List[Dict]
    metadata: Dict

class TrustScoreResponse(BaseModel):
    trust_score: float
    adjusted_rating: float
    breakdown: Dict
    flags: List[str]
    confidence: float
    qwen_summary: Optional[str] = None

# ==================== HEURISTIC ANALYSIS ENGINE ====================

# Common generic phrases found in fake/low-effort reviews
GENERIC_PHRASES = [
    "highly recommend", "must buy", "best product", "amazing product",
    "love it", "great product", "awesome product", "perfect product",
    "excellent product", "fantastic product", "wonderful product",
    "best ever", "five stars", "5 stars", "totally worth",
    "don't hesitate", "waste of money", "worst product", "terrible product",
    "do not buy", "stay away", "horrible product", "very bad",
    "super product", "mind blowing", "outstanding", "superb quality",
    "value for money", "paisa vasool", "best in class",
]

# Indicators of specific, authentic content
SPECIFICITY_PATTERNS = [
    r'\d+\s*(inch|cm|mm|kg|lb|gb|mb|tb|mah|watt|hour|day|week|month|year)',  # measurements
    r'\$\d+|\₹\d+|\d+\s*(dollar|rupee|rs)',  # prices
    r'\d+(\.\d+)?\s*(out of|/)\s*\d+',  # ratings like "8/10"
    r'(after|for|since|about)\s+\d+\s+(day|week|month|year)',  # time usage
    r'(compared|versus|vs|better than|worse than|unlike)',  # comparisons
    r'(battery|screen|display|camera|speaker|keyboard|weight|size|color|texture)',  # specific features
    r'(pro|con|advantage|disadvantage|downside|upside|issue|problem|flaw)',  # balanced language
    r'(however|although|but|though|on the other hand|that said)',  # nuanced transitions
]

# Suspicious patterns
SUSPICIOUS_PATTERNS = [
    r'(.{20,})\1+',  # repeated long phrases
    r'[!]{3,}',  # excessive exclamation marks
    r'[A-Z][A-Z\s]{30,}[A-Z]',  # all caps passages (30+ chars, avoids abbreviations)
    r'(buy|purchase|order)\s+(now|today|immediately|asap)',  # urgency language
    r'(click|visit|check out|go to)\s+(the\s+)?(link|site|website|page)',  # link bait
]


class TextAnalyzer:
    """Heuristic-based text analysis for review authenticity detection"""

    def analyze_single(self, text: str) -> Dict:
        """Analyze a single review text and return component scores"""
        if not text or len(text.strip()) < 5:
            return {"score": 15.0, "flags": ["Empty or near-empty review"]}

        scores = {}
        flags = []

        # 1. Vocabulary Richness (0-100)
        scores["vocabulary"] = self._vocabulary_richness(text)

        # 2. Sentence Variance / Burstiness (0-100)
        scores["burstiness"] = self._sentence_burstiness(text)

        # 3. Specificity Score (0-100)
        scores["specificity"] = self._specificity_score(text)

        # 4. Length Appropriateness (0-100)
        scores["length"] = self._length_score(text)

        # 5. Generic Phrase Density (0-100, higher = fewer generics = better)
        scores["originality"] = self._originality_score(text)

        # 6. Suspicious Pattern Detection (0-100, higher = less suspicious)
        susp_score, susp_flags = self._suspicion_score(text)
        scores["authenticity"] = susp_score
        flags.extend(susp_flags)

        # Weighted combination
        overall = (
            scores["vocabulary"] * 0.15 +
            scores["burstiness"] * 0.10 +
            scores["specificity"] * 0.25 +
            scores["length"] * 0.10 +
            scores["originality"] * 0.20 +
            scores["authenticity"] * 0.20
        )

        return {"score": overall, "components": scores, "flags": flags}

    def _vocabulary_richness(self, text: str) -> float:
        """Measure unique word ratio - real reviews have diverse vocabulary"""
        words = re.findall(r'[a-zA-Z]+', text.lower())
        if len(words) < 3:
            return 20.0
        unique_ratio = len(set(words)) / len(words)
        # Scale: 0.3 ratio -> 30, 0.5 -> 50, 0.7 -> 80, 0.9 -> 95
        return min(95, max(10, unique_ratio * 110))

    def _sentence_burstiness(self, text: str) -> float:
        """Real humans vary sentence length; bots/AI tend to be uniform"""
        sentences = [s.strip() for s in re.split(r'[.!?]+', text) if s.strip()]
        if len(sentences) < 2:
            return 40.0  # Can't measure burstiness with 1 sentence

        lengths = [len(s.split()) for s in sentences]
        mean_len = np.mean(lengths)
        if mean_len == 0:
            return 30.0

        std_dev = np.std(lengths)
        cv = std_dev / mean_len  # coefficient of variation

        # CV of 0 = perfectly uniform (suspicious), CV of 0.5-1.0 = natural human writing
        if cv < 0.1:
            return 25.0  # Very uniform, likely generated
        elif cv < 0.3:
            return 50.0
        elif cv < 0.6:
            return 80.0  # Good natural variation
        elif cv < 1.0:
            return 90.0  # High variation, very human-like
        else:
            return 70.0  # Extremely variable, might be messy but still human

    def _specificity_score(self, text: str) -> float:
        """Reviews with specific details (numbers, features, comparisons) are more authentic"""
        text_lower = text.lower()
        matches = 0
        for pattern in SPECIFICITY_PATTERNS:
            found = re.findall(pattern, text_lower)
            matches += len(found)

        # Scale by text length to normalize
        words = len(text.split())
        if words == 0:
            return 10.0

        density = float(matches) / max(float(words) / 20.0, 1.0)  # specifics per ~20 words

        if density >= 2.0:
            return 95.0
        elif density >= 1.0:
            return 82.0
        elif density >= 0.5:
            return 65.0
        elif density >= 0.2:
            return 45.0
        else:
            return 20.0  # Very vague, no specifics

    def _length_score(self, text: str) -> float:
        """Evaluate review length appropriateness"""
        words = len(text.split())

        if words < 5:
            return 10.0   # Too short to be useful
        elif words < 15:
            return 35.0   # Very brief
        elif words < 30:
            return 55.0   # Short but acceptable
        elif words < 80:
            return 85.0   # Good detailed review
        elif words < 200:
            return 90.0   # Very detailed
        elif words < 500:
            return 75.0   # Getting long
        else:
            return 55.0   # Suspiciously long

    def _originality_score(self, text: str) -> float:
        """Detect generic/templated language. More generics = lower score."""
        text_lower = text.lower()
        generic_hits: float = 0.0
        for phrase in GENERIC_PHRASES:
            if phrase in text_lower:
                generic_hits += 1.0

        words = len(text.split())
        if words == 0:
            return 20.0

        # Normalize by review length
        generic_density = float(generic_hits) / max(float(words) / 15.0, 1.0)

        if generic_hits == 0:
            return 92.0  # No generic phrases at all
        elif generic_density < 0.3:
            return 75.0  # Some generic language but mostly original
        elif generic_density < 0.7:
            return 45.0  # Moderate generic content
        elif generic_density < 1.5:
            return 25.0  # Heavily generic
        else:
            return 10.0  # Almost entirely generic phrases

    def _suspicion_score(self, text: str) -> tuple:
        """Detect suspicious patterns. Returns (score, flags)."""
        flags: List[str] = []
        penalty: float = 0.0

        for pattern in SUSPICIOUS_PATTERNS:
            # The all-caps pattern must NOT use IGNORECASE
            if "A-Z" in pattern:
                match = re.search(pattern, text)
            else:
                match = re.search(pattern, text, re.IGNORECASE)

            if match:
                penalty += 15.0
                if "!" in pattern:
                    flags.append("Excessive punctuation detected")
                elif "buy" in pattern or "purchase" in pattern:
                    flags.append("Urgency/sales language detected")
                elif "click" in pattern or "visit" in pattern:
                    flags.append("Link bait language detected")
                elif "A-Z" in pattern:
                    flags.append("Excessive capitalization detected")

        # Check emoji density
        emoji_count = len(re.findall(r'[\U0001F600-\U0001F9FF]', text))
        if emoji_count > 5:
            penalty += 10.0
            flags.append("Excessive emoji usage")

        score = max(5, 95 - penalty)
        return score, flags


class CrossReviewAnalyzer:
    """Analyze patterns across multiple reviews together"""

    def analyze(self, reviews: List[Dict]) -> Dict:
        """Cross-review analysis for collusion and manipulation patterns"""
        if len(reviews) < 2:
            return {
                "duplicate_score": 80.0,
                "rating_distribution_score": 70.0,
                "reviewer_diversity_score": 70.0,
                "flags": [],
                "overall": 73.0
            }

        flags = []
        scores = {}

        # 1. Duplicate/Near-duplicate Detection
        scores["duplicate_score"] = self._duplicate_detection(reviews, flags)

        # 2. Rating Distribution Analysis
        scores["rating_distribution_score"] = self._rating_distribution(reviews, flags)

        # 3. Reviewer Diversity
        scores["reviewer_diversity_score"] = self._reviewer_diversity(reviews, flags)

        # 4. Sentiment-Rating Consistency
        scores["consistency_score"] = self._sentiment_rating_consistency(reviews, flags)

        overall = (
            scores["duplicate_score"] * 0.30 +
            scores["rating_distribution_score"] * 0.25 +
            scores["reviewer_diversity_score"] * 0.20 +
            scores["consistency_score"] * 0.25
        )

        return {**scores, "flags": flags, "overall": overall}

    def _duplicate_detection(self, reviews: List[Dict], flags: List[str]) -> float:
        """Find near-duplicate reviews (same text from different reviewers)"""
        texts = [r.get("text", "").lower().strip() for r in reviews]

        # Create word-set fingerprints for fuzzy matching
        fingerprints = []
        for text in texts:
            words = set(re.findall(r'[a-z]+', text))
            fingerprints.append(words)

        duplicate_pairs: float = 0.0
        total_pairs: float = 0.0

        for i in range(len(fingerprints)):
            for j in range(i + 1, len(fingerprints)):
                total_pairs += 1
                if not fingerprints[i] or not fingerprints[j]:
                    continue
                intersection = len(fingerprints[i] & fingerprints[j])
                union: float = float(len(fingerprints[i] | fingerprints[j]))
                if union > 0.0 and float(intersection) / union > 0.7:
                    duplicate_pairs += 1.0

        if total_pairs == 0:
            return 80.0

        dup_ratio = float(duplicate_pairs) / float(max(total_pairs, 1.0))

        if duplicate_pairs > 0:
            flags.append(f"{duplicate_pairs} near-duplicate review pair(s) found")

        if dup_ratio > 0.5:
            return 10.0
        elif dup_ratio > 0.3:
            return 30.0
        elif dup_ratio > 0.1:
            return 55.0
        elif dup_ratio > 0:
            return 72.0
        else:
            return 92.0  # No duplicates

    def _rating_distribution(self, reviews: List[Dict], flags: List[str]) -> float:
        """Analyze if the rating distribution looks organic"""
        ratings = [r.get("rating", 3) for r in reviews]
        if not ratings:
            return 60.0

        rating_counts: Dict[int, int] = dict(Counter(ratings))
        total: int = len(ratings)

        five_star = float(rating_counts.get(5, 0)) / float(max(total, 1))
        one_star = float(rating_counts.get(1, 0)) / float(max(total, 1))
        extreme_ratio = five_star + one_star
        unique_ratings = len(rating_counts)

        avg_rating = np.mean(ratings)
        std_rating = np.std(ratings)

        score: float = 70.0  # Base

        # All same rating is suspicious
        if unique_ratings == 1:
            score = 20.0
            flags.append(f"All reviews have the same {ratings[0]}-star rating")
        elif unique_ratings == 2 and total > 4:
            score = 40.0
            flags.append("Very limited rating variety")
        elif std_rating > 0.8:
            score = 88.0  # Good variety in ratings
        elif std_rating > 0.4:
            score = 72.0

        # Extreme bias check
        if five_star > 0.85 and total > 3:
            score = min(score, 25.0)
            flags.append(f"{five_star:.0%} of reviews are 5-star (suspicious)")
        elif one_star > 0.85 and total > 3:
            score = min(score, 30.0)
            flags.append(f"{one_star:.0%} of reviews are 1-star (possible review bombing)")

        return score

    def _reviewer_diversity(self, reviews: List[Dict], flags: List[str]) -> float:
        """Check if reviews come from diverse reviewers"""
        reviewer_ids = [r.get("reviewer_id", "") for r in reviews]
        unique_reviewers = len(set(reviewer_ids))
        total = len(reviewer_ids)

        if total == 0:
            return 50.0

        diversity_ratio = unique_reviewers / total

        if diversity_ratio < 0.5:
            flags.append("Multiple reviews from the same reviewer accounts")
            return 25.0
        elif diversity_ratio < 0.8:
            return 55.0
        else:
            return 88.0

    def _sentiment_rating_consistency(self, reviews: List[Dict], flags: List[str]) -> float:
        """Check if sentiment in text matches the star rating"""
        positive_words = {"great", "good", "excellent", "amazing", "love", "perfect",
                         "fantastic", "wonderful", "awesome", "best", "happy",
                         "satisfied", "recommend", "impressed", "quality", "nice"}
        negative_words = {"bad", "terrible", "horrible", "worst", "hate", "awful",
                         "poor", "disappointed", "broken", "waste", "useless",
                         "defective", "cheap", "fail", "regret", "return"}

        inconsistent_count = 0
        for review in reviews:
            text_lower = review.get("text", "").lower()
            rating = review.get("rating", 3)
            words = set(re.findall(r'[a-z]+', text_lower))

            pos_count = len(words & positive_words)
            neg_count = len(words & negative_words)

            # High rating but negative text
            if rating >= 4 and neg_count > pos_count and neg_count >= 2:
                inconsistent_count += 1
            # Low rating but positive text
            elif rating <= 2 and pos_count > neg_count and pos_count >= 2:
                inconsistent_count += 1

        total = len(reviews)
        if total == 0:
            return 70.0

        incon_ratio = inconsistent_count / total

        if inconsistent_count > 0:
            flags.append(f"{inconsistent_count} review(s) with mismatched sentiment and rating")

        if incon_ratio > 0.5:
            return 20.0
        elif incon_ratio > 0.3:
            return 40.0
        elif incon_ratio > 0.1:
            return 65.0
        elif incon_ratio > 0:
            return 78.0
        else:
            return 90.0


class TemporalAnalyzer:
    """Analyze review timing patterns"""

    def analyze(self, reviews: List[Dict]) -> Dict:
        """Detect review bursts and suspicious timing"""
        if len(reviews) < 2:
            return {"score": 70.0, "burst_detected": False, "flags": []}

        timestamps = []
        for r in reviews:
            try:
                ts_str = r.get('timestamp', '')
                if ts_str:
                    ts = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
                    timestamps.append(ts)
            except:
                continue

        if len(timestamps) < 2:
            return {"score": 65.0, "burst_detected": False, "flags": []}

        timestamps.sort()
        flags = []

        # Calculate intervals in hours
        intervals_hours = []
        for i in range(1, len(timestamps)):
            delta = (timestamps[i] - timestamps[i-1]).total_seconds() / 3600
            intervals_hours.append(max(delta, 0.001))  # Avoid zero

        avg_interval = np.mean(intervals_hours)
        min_interval = min(intervals_hours)
        std_interval = np.std(intervals_hours)

        score = 75.0  # Base

        # Check for suspiciously rapid reviews
        rapid_count = sum(1 for i in intervals_hours if float(i) < 0.5)  # Less than 30 min apart
        rapid_ratio = float(rapid_count) / float(max(len(intervals_hours), 1))

        if rapid_ratio > 0.7:
            score = 15.0
            flags.append(f"{rapid_ratio:.0%} of reviews posted within 30 minutes of each other")
        elif rapid_ratio > 0.4:
            score = 35.0
            flags.append(f"Suspicious burst: {rapid_count} reviews posted very close together")
        elif rapid_ratio > 0.2:
            score = 55.0
            flags.append("Some reviews posted in close succession")

        # Check for time span - all reviews on same day is suspicious for many reviews
        total_span_hours = (timestamps[-1] - timestamps[0]).total_seconds() / 3600
        if len(reviews) > 5 and total_span_hours < 24:
            score = min(score, 30.0)
            flags.append("All reviews posted within 24 hours")
        elif len(reviews) > 3 and total_span_hours < 6:
            score = min(score, 25.0)
            flags.append("All reviews posted within 6 hours")

        # Good spread earns higher score
        if total_span_hours > 168 and rapid_ratio == 0:  # > 1 week, no bursts
            score = max(score, 88.0)
        elif total_span_hours > 72 and rapid_ratio < 0.1:  # > 3 days
            score = max(score, 80.0)

        return {
            "score": float(score),
            "burst_detected": bool(rapid_ratio > 0.3),
            "rapid_ratio": float(round(float(rapid_ratio), 2)),
            "avg_interval_hours": float(round(float(avg_interval), 1)),
            "total_span_hours": float(round(float(total_span_hours), 1)),
            "flags": list(flags)
        }


class MetadataAnalyzer:
    """Analyze review metadata (verification, helpfulness, etc.)"""

    def analyze(self, reviews: List[Dict]) -> Dict:
        """Score based on metadata signals"""
        if not reviews:
            return {"score": 50.0, "verified_ratio": 0, "flags": []}

        flags = []
        total = len(reviews)

        # Verified purchase ratio
        verified_count = sum(1 for r in reviews if r.get('verified'))
        verified_ratio = verified_count / total

        # Helpful votes analysis
        helpful_votes = [r.get('helpful_votes', 0) for r in reviews]
        total_helpful = sum(helpful_votes)
        has_any_helpful = sum(1 for v in helpful_votes if v > 0)

        # Review text length distribution
        lengths = [len(r.get('text', '').split()) for r in reviews]
        avg_length = np.mean(lengths) if lengths else 0
        std_length = np.std(lengths) if len(lengths) > 1 else 0

        score = 50.0  # Start neutral

        # Verified purchases boost score significantly
        if verified_ratio >= 0.8:
            score += 30
        elif verified_ratio >= 0.5:
            score += 20
        elif verified_ratio >= 0.2:
            score += 10
        elif verified_ratio == 0:
            score -= 10
            flags.append("No verified purchase badges detected")

        # Helpful votes signal real community engagement
        if has_any_helpful / total > 0.3:
            score += 12
        elif total_helpful > 0:
            score += 5

        # Length variety signals organic reviews
        if std_length > 15:
            score += 8  # Good variety in review lengths

        # All reviews suspiciously similar length
        if std_length < 5 and total > 3:
            score -= 15
            flags.append("All reviews have suspiciously similar length")

        score = max(5, min(95, score))

        return {
            "score": float(score),
            "verified_ratio": float(round(float(verified_ratio), 2)),
            "avg_length_words": float(round(float(avg_length), 0)),
            "helpful_engagement": float(round(float(has_any_helpful) / float(max(total, 1)), 2)) if total > 0 else 0.0,
            "flags": list(flags)
        }


# ==================== TRUST SCORE CALCULATOR ====================

class TrustScoreCalculator:
    """
    Heuristic Trust Score Algorithm
    T = weighted combination of text quality, cross-review patterns,
        temporal patterns, and metadata signals
    """

    def __init__(self):
        self.text_analyzer = TextAnalyzer()
        self.cross_analyzer = CrossReviewAnalyzer()
        self.temporal_analyzer = TemporalAnalyzer()
        self.metadata_analyzer = MetadataAnalyzer()

        self.category_weights = {
            "default": {
                "text": 0.30,
                "cross_review": 0.30,
                "temporal": 0.20,
                "metadata": 0.20
            },
            "electronics": {
                "text": 0.25,
                "cross_review": 0.30,
                "temporal": 0.25,
                "metadata": 0.20
            },
            "books": {
                "text": 0.40,
                "cross_review": 0.25,
                "temporal": 0.15,
                "metadata": 0.20
            },
            "fashion": {
                "text": 0.30,
                "cross_review": 0.30,
                "temporal": 0.15,
                "metadata": 0.25
            },
            "software": {
                "text": 0.35,
                "cross_review": 0.25,
                "temporal": 0.25,
                "metadata": 0.15
            }
        }

    def bayesian_adjustment(self, raw_score: float, review_count: int) -> float:
        """Light Bayesian smoothing - only for very small review counts"""
        # m = minimum reviews for full confidence
        m = 10.0
        neutral = 55.0  # Neutral midpoint

        if float(review_count) < m:
            weight = float(review_count) / m
            adjusted = (weight * raw_score) + ((1.0 - weight) * neutral)
            return float(adjusted)
        return float(raw_score)

    def calculate(self, product_id: str, reviews: List[Dict],
                  category: str = "default") -> TrustScoreResponse:
        """Main trust score calculation"""

        weights = dict(self.category_weights.get(category, self.category_weights["default"]))
        all_flags: List[str] = []

        # 1. Text Quality Analysis (per-review, then aggregate)
        text_scores = []
        text_flags = []
        for review in reviews:
            result = self.text_analyzer.analyze_single(review.get('text', ''))
            text_scores.append(result['score'])
            text_flags.extend(result.get('flags', []))

        S_text = np.mean(text_scores) if text_scores else 50.0

        # Deduplicate text flags
        unique_text_flags = list(set(text_flags))
        if len(unique_text_flags) > 3:
            unique_text_flags = unique_text_flags[:3]

        # 2. Cross-Review Pattern Analysis
        cross_result = self.cross_analyzer.analyze(reviews)
        S_cross: float = float(cross_result['overall'])
        all_flags.extend(list(cross_result['flags']))

        # 3. Temporal Analysis
        temporal_result = self.temporal_analyzer.analyze(reviews)
        S_temp = temporal_result['score']
        all_flags.extend(temporal_result.get('flags', []))

        # 4. Metadata Analysis
        metadata_result = self.metadata_analyzer.analyze(reviews)
        S_meta = metadata_result['score']
        all_flags.extend(metadata_result.get('flags', []))

        # Add text flags at the end
        all_flags.extend(unique_text_flags)

        # Weighted combination
        T_raw = (
            S_text * weights['text'] +
            S_cross * weights['cross_review'] +
            S_temp * weights['temporal'] +
            S_meta * weights['metadata']
        )

        # Light Bayesian smoothing
        T_final = self.bayesian_adjustment(T_raw, len(reviews))

        # Clamp to valid range
        T_final = max(0, min(100, T_final))

        # Confidence based on review count and data completeness
        review_count_conf = min(1.0, len(reviews) / 20) * 0.6
        verified_conf = metadata_result.get('verified_ratio', 0) * 0.2
        length_conf = min(1.0, np.mean([len(r.get('text', '').split()) for r in reviews]) / 30) * 0.2 if reviews else 0
        confidence = review_count_conf + verified_conf + length_conf

        # Adjusted rating
        ratings = [r.get('rating', 3) for r in reviews]
        if ratings:
            trust_factor = float(T_final) / 100.0
            raw_avg = float(np.mean(ratings))
            # Blend: if trust is high, rating stays close to raw average
            # If trust is low, pull the rating toward neutral (3.0)
            adjusted_rating = raw_avg * trust_factor + 3.0 * (1.0 - trust_factor)
            adjusted_rating = max(1.0, min(5.0, adjusted_rating))
        else:
            adjusted_rating = 3.0

        return TrustScoreResponse.model_validate({
            "trust_score": float(round(float(T_final), 1)),
            "adjusted_rating": float(round(float(adjusted_rating), 2)),
            "breakdown": {
                "content_quality": float(round(float(S_text), 1)),
                "review_patterns": float(round(float(S_cross), 1)),
                "temporal_integrity": float(round(float(S_temp), 1)),
                "metadata_signals": float(round(float(S_meta), 1)),
                "weights_used": dict(weights)
            },
            "flags": list(all_flags)[:8],  # Max 8 flags
            "confidence": float(round(float(confidence), 2))
        })


# Initialize calculator
calculator = TrustScoreCalculator()

# ==================== API ENDPOINTS ====================

@app.post("/analyze", response_model=TrustScoreResponse)
async def analyze_product(data: ReviewInput):
    """Main analysis endpoint"""
    try:
        if len(data.product_id) < 8:
            raise HTTPException(status_code=400, detail="Product ID must be hashed")

        result = calculator.calculate(
            product_id=data.product_id,
            reviews=data.reviews,
            category=data.metadata.get('category', 'default')
        )

        # Optional ML classifier prediction layer
        ml_score = None
        if ENABLE_ML:
            labeled = await get_labels(limit=500)
            if len(labeled) >= MODEL_TRAIN_THRESHOLD:
                trained = train_from_labeled_reviews(labeled)
                if trained:
                    # average fake probability across reviews
                    probs = [predict_fake_probability(r.get('text', '')) for r in data.reviews if r.get('text')]
                    probs = [p for p in probs if p is not None]
                    if probs:
                        ml_score = float(round(float(sum(probs) / len(probs)), 3))
                        result.flags.append(f"ML fake probability average: {ml_score}")

        # ollama Qwen analysis (summarization + second opinion)
        try:
            summary_prompt = (
                "Identify suspicious patterns in these reviews and provide a short 2-sentence assessment:\n" +
                "\n".join([f"- [{r.get('rating', '?')}] {r.get('text','')[:120]}" for r in data.reviews[:10]])
            )
            # Use await for the refactored async query_qwen
            qwen_text = await query_qwen(summary_prompt, max_tokens=150, temperature=0.25)
            
            if qwen_text:
                result.qwen_summary = qwen_text
                # attach as audit log
                await insert_audit({
                    "product_id": data.product_id,
                    "source": "ollama_qwen",
                    "recommendation": qwen_text,
                    "heuristic_score": result.trust_score,
                    "timestamp": datetime.utcnow().isoformat() + "Z"
                })
        except Exception as api_exc:
            logger.warning("Unable to query Ollama Qwen: %s", api_exc)

        # Persist each analysis for history when DB configured
        try:
            await insert_analysis({
                "product_id": data.product_id,
                "reviews": data.reviews,
                "metadata": data.metadata,
                "trust_score": result.trust_score,
                "adjusted_rating": result.adjusted_rating,
                "confidence": result.confidence,
                "breakdown": result.breakdown,
                "flags": result.flags,
                "ml_fake_prob": ml_score,
                "created_at": datetime.utcnow()
            })
        except Exception as db_exc:
            logger.warning("Could not persist analysis: %s", db_exc)

        return result

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/history/{product_id}")
async def get_history(product_id: str, limit: int = 20):
    records = await get_analysis_by_product(product_id, limit=limit)
    return {"product_id": product_id, "history": records}


class LabelInput(BaseModel):
    product_id: str
    text: str
    label: str  # e.g. fake/spam/trustworthy
    user_id: Optional[str] = None


@app.post("/label")
async def label_review(label: LabelInput):
    inserted = await insert_label(label.dict())
    if not inserted:
        raise HTTPException(status_code=503, detail="Label store unavailable")
    return {"status": "ok", "id": inserted}


@app.get("/labels")
async def list_labels(limit: int = 100):
    results = await get_labels(limit=limit)
    return {"count": len(results), "labels": results}


@app.post("/analyze_reviews_batch")
async def analyze_reviews_batch(data: Dict[str, Any]):
    """
    Experimental batch analysis for individual reviews
    Expected format: { "reviews": [ { "text": "...", "verified": bool }, ... ] }
    """
    try:
        reviews = data.get("reviews", [])
        results = []
        
        for r in reviews:
            text = r.get("text", "")
            verified = r.get("verified", False)
            
            # Use the existing TextAnalyzer for a consistent heuristic score
            analysis = calculator.text_analyzer.analyze_single(text)
            
            # Simple metadata boost if verified
            if verified:
                analysis["score"] = min(95, analysis["score"] + 15)
                analysis["flags"].append("Verified Buyer Boost")
                
            results.append({
                "score": round(analysis["score"], 1),
                "flags": analysis["flags"][:3]
            })
            
        return {"success": True, "results": results}
    except Exception as e:
        logger.error(f"Batch analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/audit")
async def create_audit(entry: Dict[str, Any]):
    inserted = await insert_audit(entry)
    if not inserted:
        raise HTTPException(status_code=503, detail="Audit store unavailable")
    return {"status": "ok", "id": inserted}


@app.get("/audits")
async def list_audits(limit: int = 100):
    if db is None:
        raise HTTPException(status_code=503, detail="Audit store unavailable")
    cursor = db.audit_logs.find().sort("created_at", -1).limit(limit)
    records = [doc async for doc in cursor]
    return {"count": len(records), "audits": records}


@app.get("/health")
@app.get("/healthz")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy", 
        "version": "2.0.0",
        "model_loaded": True  # Ollama Qwen is assumed active if service is up
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
