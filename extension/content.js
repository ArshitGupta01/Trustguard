// TrustGuard Content Script - DOM Scraper & UI Injection v2.0
// CRITICAL: No direct fetch() calls here - all API calls go through background script

(function () {
    'use strict';

    console.log("TrustGuard: Content Script Loaded & Active");

    let currentASIN = null;
    let analysisInProgress = false;
    let trustScoreData = null;
    let observerInitialized = false;
    let loadingInterval = null;
    let loadingStartTime = null;

    // Enhanced selectors for better detection
    const SELECTORS = {
        amazon: {
            reviewContainer: [
                '[data-hook="review"]',
                '.a-section.review',
                '.review',
                '#cm_cr-review_list .a-section',
                '.a-section.celwidget'
            ],
            reviewText: [
                '[data-hook="review-body"] span',
                '.review-text-content span',
                '.review-text',
                '[data-hook="review-body"]'
            ],
            reviewTitle: [
                '[data-hook="review-title"] span',
                '.review-title',
                '[data-hook="review-title"]'
            ],
            rating: [
                '[data-hook="review-star-rating"] .a-icon-alt',
                '.review-rating .a-icon-alt',
                'i[data-hook="review-star-rating"]'
            ],
            reviewerName: [
                '[data-hook="review-author"] .a-profile-name',
                '.a-profile-name',
                '.review-byline .author'
            ],
            verifiedPurchase: [
                '[data-hook="avp-badge"]',
                '.a-declarative[data-action="reviews:filter-action:verified-purchase"]',
                '.a-icon-mini-star-filled',
                'span[data-hook="avp-badge-linkless"]',
                '.avp-badge'
            ],
            reviewDate: [
                '[data-hook="review-date"]',
                '.review-date'
            ],
            helpfulVotes: [
                '[data-hook="helpful-vote-statement"]',
                '.cr-vote-text'
            ],
            productTitle: [
                '#productTitle',
                '#title',
                '.product-title-word-break'
            ],
            asinFromUrl: [
                /\/dp\/([A-Z0-9]{10})/,
                /\/gp\/product\/([A-Z0-9]{10})/,
                /\/([A-Z0-9]{10})(?:\/|\?|$)/
            ],
            asinFromMeta: 'meta[name="keywords"]',
            asinFromData: '[data-asin]'
        },
        flipkart: {
            reviewContainer: ['._27M-vq', '.col-12-12._1c0LF1', '._1AtVbE', '._2wzgFH'],
            reviewText: ['.t-ZTKy div div', '._12cXul', '._2-N8zT'],
            rating: ['._3LWZlK', 'div[class*="3LWZlK"]'],
            reviewerName: ['._2sc7ZR'],
            verifiedPurchase: ['._2V5EHH', '._2mcZGG'],
            reviewDate: ['._2sc7ZR._2V5EHH', '._3n8db9'],
            productTitle: ['.B_NuCI', '.product-title'],
            asinFromUrl: /[?&]pid=([A-Za-z0-9_-]+)/i
        }
    };

    function getPlatform() {
        const host = window.location.hostname;
        if (host.includes('amazon')) return 'amazon';
        if (host.includes('flipkart')) return 'flipkart';
        return null;
    }

    function isProductPage() {
        const url = window.location.href;
        const path = window.location.pathname;
        const platform = getPlatform();
        if (!platform) return false;

        if (platform === 'amazon') {
            // Amazon product pages have /dp/ or /gp/product/ in the URL
            return /\/dp\/[A-Z0-9]{10}/i.test(url) || /\/gp\/product\//i.test(url);
        }
        if (platform === 'flipkart') {
            // Flipkart product pages have /p/ in the path
            return /\/p\//i.test(path) || /\/itm\//i.test(path);
        }
        return false;
    }

    function extractASIN() {
        const platform = getPlatform();
        if (!platform) return null;

        try {
            const s = SELECTORS[platform];

            if (s.asinFromUrl) {
                const patterns = Array.isArray(s.asinFromUrl) ? s.asinFromUrl : [s.asinFromUrl];
                for (const pattern of patterns) {
                    const match = window.location.href.match(pattern);
                    if (match) {
                        console.log(`TrustGuard: Found ASIN ${match[1]} via URL pattern`);
                        return match[1];
                    }
                }
            }

            if (s.asinFromData) {
                const asinEl = document.querySelector(s.asinFromData);
                if (asinEl) {
                    const asin = asinEl.getAttribute('data-asin');
                    if (asin && asin.length >= 10) {
                        console.log(`TrustGuard: Found ASIN ${asin} via data-asin attribute`);
                        return asin;
                    }
                }
            }

            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.has('pid')) return urlParams.get('pid');

            if (s.asinFromMeta) {
                const meta = document.querySelector(s.asinFromMeta);
                if (meta) {
                    const content = meta.getAttribute('content');
                    const asinMatch = content?.match(/[A-Z0-9]{10}/i);
                    if (asinMatch) {
                        console.log(`TrustGuard: Found ASIN ${asinMatch[0]} via meta tag`);
                        return asinMatch[0];
                    }
                }
            }
        } catch (e) {
            console.warn('TrustGuard: ASIN extraction failed', e);
        }

        return null;
    }

    function hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16).padStart(16, '0');
    }

    function parseRating(text) {
        if (!text) return 3;
        const match = text.match(/(\d+(\.\d+)?)/);
        return match ? parseFloat(match[1]) : 3;
    }

    function parseDate(dateText) {
        if (!dateText) return new Date().toISOString();
        try {
            const date = new Date(dateText);
            if (isNaN(date.getTime())) {
                return new Date().toISOString();
            }
            return date.toISOString();
        } catch {
            return new Date().toISOString();
        }
    }

    function getElement(root, selectors) {
        if (!Array.isArray(selectors)) selectors = [selectors];
        for (const selector of selectors) {
            try {
                const el = root.querySelector(selector);
                if (el) return el;
            } catch (e) {
                continue;
            }
        }
        return null;
    }

    function extractReviews() {
        const platform = getPlatform();
        if (!platform) {
            console.log("TrustGuard: Platform not detected");
            return [];
        }

        const s = SELECTORS[platform];
        const reviews = [];
        let containers = [];

        const containerSelectors = Array.isArray(s.reviewContainer)
            ? s.reviewContainer
            : [s.reviewContainer];

        for (const selector of containerSelectors) {
            try {
                const found = document.querySelectorAll(selector);
                if (found.length > 0) {
                    containers = found;
                    console.log(`TrustGuard: Found ${found.length} reviews using selector: ${selector}`);
                    break;
                }
            } catch (e) {
                continue;
            }
        }

        if (containers.length === 0) {
            console.log("TrustGuard: Trying fallback review detection...");
            const allDivs = document.querySelectorAll('div, article');
            containers = Array.from(allDivs).filter(el => {
                const text = el.innerText || '';
                const hasReviewPattern = /\b(review|verified purchase|helpful|out of \d+ stars)\b/i.test(text);
                const hasLength = text.length > 100 && text.length < 5000;
                return hasReviewPattern && hasLength;
            }).slice(0, 50);

            if (containers.length > 0) {
                console.log(`TrustGuard: Fallback found ${containers.length} potential reviews`);
            }
        }

        containers.forEach((container, index) => {
            try {
                const textEl = getElement(container, s.reviewText);
                const ratingEl = getElement(container, s.rating);
                const nameEl = getElement(container, s.reviewerName);
                const verifiedEl = getElement(container, s.verifiedPurchase);
                const dateEl = getElement(container, s.reviewDate);
                const helpfulEl = getElement(container, s.helpfulVotes);

                const text = textEl ? textEl.innerText.trim() : '';
                if (!text || text.length < 10) return;

                reviews.push({
                    text: text,
                    rating: parseRating(ratingEl ? ratingEl.innerText : ''),
                    verified: !!verifiedEl || (container.innerText.includes("Verified Purchase")),
                    timestamp: parseDate(dateEl ? dateEl.innerText : ''),
                    reviewer_id: hashString(nameEl ? nameEl.innerText : `unknown_${index}`),
                    helpful_votes: helpfulEl ? parseInt(helpfulEl.innerText.match(/\d+/)?.[0] || 0) : 0,
                    product_id: currentASIN
                });
            } catch (e) {
                console.error('TrustGuard: Error parsing review', e);
            }
        });

        console.log(`TrustGuard: Successfully extracted ${reviews.length} reviews`);
        return reviews;
    }

    // ── SVG Score Ring Helper ──
    function createScoreRing(score, size, strokeWidth) {
        const radius = (size - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (score / 100) * circumference;

        return `
            <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
                <circle class="tg-ring-bg" cx="${size/2}" cy="${size/2}" r="${radius}"/>
                <circle class="tg-ring-fill" cx="${size/2}" cy="${size/2}" r="${radius}"
                    stroke-dasharray="${circumference}"
                    stroke-dashoffset="${offset}"/>
            </svg>`;
    }

    function getScoreClass(score) {
        if (score >= 80) return 'tg-excellent';
        if (score >= 60) return 'tg-good';
        if (score >= 40) return 'tg-caution';
        return 'tg-danger';
    }

    function getScoreVerdict(score) {
        if (score >= 80) return 'Excellent Trust Score';
        if (score >= 60) return 'Good — Mostly Trustworthy';
        if (score >= 40) return 'Caution — Mixed Signals';
        return 'Warning — Potentially Manipulated';
    }

    function createTrustBadge(score, flags, mlEnhanced, originalRating, adjustedRating) {
        const badge = document.createElement('div');
        badge.id = 'trustguard-badge';
        badge.className = `trustguard-badge ${getScoreClass(score)}`;

        const flagsHtml = flags.slice(0, 3).map(f =>
            `<span class="tg-badge-flag">⚠ ${f}</span>`
        ).join('');

        const aiChip = mlEnhanced
            ? '<span class="tg-ai-chip">AI</span>'
            : '';

        badge.innerHTML = `
            <div class="tg-badge-inner">
                <div class="tg-ring-wrap">
                    ${createScoreRing(score, 64, 5)}
                    <span class="tg-ring-score">${adjustedRating ? adjustedRating : Math.round(score)}<span style="font-size:10px; opacity:0.7">/5</span></span>
                </div>
                <div class="tg-badge-info">
                    <div class="tg-badge-label">
                        🛡️ TrustGuard ${aiChip}
                    </div>
                    ${originalRating ? `
                    <div class="tg-badge-ratings" style="margin-bottom: 5px; font-size: 13px; color: #a1a1aa;">
                        Actual: <span style="color: #ffffff; font-weight: bold; margin-right: 8px;">⭐ ${originalRating}</span>
                        Adjusted: <span style="color: #00ff88; font-weight: bold;">⭐ ${adjustedRating}</span>
                    </div>` : ''}
                    <div class="tg-badge-verdict">${getScoreVerdict(score)}</div>
                    ${flags.length > 0 ? `<div class="tg-badge-flags">${flagsHtml}</div>` : ''}
                    <div class="tg-badge-cta">Click for detailed analysis →</div>
                </div>
            </div>
        `;

        badge.addEventListener('click', showDetailedAnalysis);
        return badge;
    }

    function showLoadingBadge() {
        const existing = document.getElementById('trustguard-badge');
        if (existing) existing.remove();

        let target = document.querySelector('#titleBlock, #title_feature_div, .B_NuCI, [data-hook="product-title"]');
        if (!target) {
            const titleSelectors = ['h1', '.product-title', '#productTitle', '[data-hook="product-title"]'];
            for (const sel of titleSelectors) {
                target = document.querySelector(sel);
                if (target) break;
            }
        }

        if (!target) return;

        const badge = document.createElement('div');
        badge.id = 'trustguard-badge';
        badge.className = 'trustguard-badge tg-loading-badge';
        
        badge.innerHTML = `
            <div class="tg-badge-inner" style="padding: 16px 24px;">
                <div class="tg-loading-spinner"></div>
                <div class="tg-badge-info" style="margin-left: 12px;">
                    <div class="tg-loading-text">Analysis is being prepared...</div>
                    <div class="tg-loading-subtext">Deep AI scanning active <span id="tg-analysis-timer" class="tg-timer">00s</span></div>
                </div>
            </div>
        `;

        if (target.parentNode) {
            target.parentNode.insertBefore(badge, target.nextSibling);
            console.log('TrustGuard: Loading badge injected');
        }

        stopLoading(); // Clear any existing
        loadingStartTime = Date.now();
        const timerEl = badge.querySelector('#tg-analysis-timer');
        
        loadingInterval = setInterval(() => {
            const seconds = Math.floor((Date.now() - loadingStartTime) / 1000);
            if (timerEl) {
                timerEl.textContent = `${seconds.toString().padStart(2, '0')}s`;
            }
        }, 1000);
    }

    function stopLoading() {
        if (loadingInterval) {
            clearInterval(loadingInterval);
            loadingInterval = null;
        }
    }

    function injectBadge(data) {
        stopLoading();
        const existing = document.getElementById('trustguard-badge');
        if (existing) existing.remove();

        let target = document.querySelector('#titleBlock, #title_feature_div, .B_NuCI, [data-hook="product-title"]');

        if (!target) {
            const titleSelectors = ['h1', '.product-title', '#productTitle', '[data-hook="product-title"]'];
            for (const sel of titleSelectors) {
                target = document.querySelector(sel);
                if (target) break;
            }
        }

        if (!target) {
            console.warn('TrustGuard: Could not find injection point for badge');
            return;
        }

        const mlEnhanced = data.breakdown?.ml_enhanced || false;
        const adjustedRating = data.adjusted_rating ? data.adjusted_rating.toFixed(1) : null;
        const originalRating = data.original_rating ? parseFloat(data.original_rating).toFixed(1) : null;

        const badge = createTrustBadge(data.trust_score, data.flags || [], mlEnhanced, originalRating, adjustedRating);
        
        // Expose adjusted rating and qwen summary to additional_detector.js
        if (adjustedRating) {
            badge.dataset.adjustedRating = adjustedRating;
        }
        if (data.qwen_summary) {
            badge.dataset.qwenSummary = data.qwen_summary;
        }

        if (target.parentNode) {
            target.parentNode.insertBefore(badge, target.nextSibling);
            console.log('TrustGuard: Badge injected successfully');
        }
    }

    // ── Metric icons & bar classes ──
    const METRIC_CONFIG = {
        content_quality:     { icon: '📝', bar: 'tg-bar-content',  label: 'Content Quality' },
        review_patterns:     { icon: '🔗', bar: 'tg-bar-patterns', label: 'Review Patterns' },
        temporal_integrity:  { icon: '⏱️', bar: 'tg-bar-temporal', label: 'Temporal Integrity' },
        metadata_signals:    { icon: '📊', bar: 'tg-bar-metadata', label: 'Metadata Signals' },
    };

    function showDetailedAnalysis() {
        if (!trustScoreData) {
            console.warn('TrustGuard: No data to show');
            return;
        }

        const existingModal = document.getElementById('trustguard-modal');
        if (existingModal) existingModal.remove();

        const score = trustScoreData.trust_score;
        const scoreClass = getScoreClass(score);
        const mlActive = trustScoreData.breakdown?.ml_enhanced || false;

        // Build score ring for modal (larger)
        const radius = 63;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (score / 100) * circumference;

        // Build metric rows
        const metricHtml = Object.entries(trustScoreData.breakdown || {})
            .filter(([k]) => k !== 'weights_used' && k !== 'ml_enhanced')
            .map(([key, value]) => {
                const config = METRIC_CONFIG[key] || { icon: '📈', bar: 'tg-bar-content', label: key.replace(/_/g, ' ') };
                const clamped = Math.max(0, Math.min(100, value));
                return `
                    <div class="tg-metric">
                        <div class="tg-metric-icon">${config.icon}</div>
                        <div class="tg-metric-info">
                            <div class="tg-metric-name">${config.label}</div>
                            <div class="tg-metric-bar">
                                <div class="${config.bar}" style="width: ${clamped}%"></div>
                            </div>
                        </div>
                        <div class="tg-metric-value">${Math.round(value)}</div>
                    </div>
                `;
            }).join('');

        // Build flags
        const flagsHtml = trustScoreData.flags && trustScoreData.flags.length > 0
            ? `<div class="tg-flags-section">
                <div class="tg-section-header">⚠️ Warnings</div>
                ${trustScoreData.flags.map(f => `
                    <div class="tg-flag-item">
                        <span class="tg-flag-dot"></span>
                        <span>${f}</span>
                    </div>
                `).join('')}
               </div>`
            : '';

        // Score color
        let strokeColor;
        if (score >= 80) strokeColor = '#00d9ff';
        else if (score >= 60) strokeColor = '#69f0ae';
        else if (score >= 40) strokeColor = '#ffd54f';
        else strokeColor = '#ff8a80';

        const modal = document.createElement('div');
        modal.id = 'trustguard-modal';
        modal.innerHTML = `
            <div class="tg-modal-overlay">
                <div class="tg-modal-content">
                    <div class="tg-modal-header">
                        <button class="tg-close">&times;</button>
                        <div class="tg-modal-title">
                            🛡️ TrustGuard Analysis
                            ${mlActive ? '<span class="tg-ai-tag">AI Enhanced</span>' : ''}
                        </div>
                        <div class="tg-score-ring-wrap">
                            <svg width="150" height="150" viewBox="0 0 150 150">
                                <circle class="tg-score-ring-bg" cx="75" cy="75" r="${radius}"/>
                                <circle class="tg-score-ring-progress" cx="75" cy="75" r="${radius}"
                                    stroke="${strokeColor}"
                                    stroke-dasharray="${circumference}"
                                    stroke-dashoffset="${offset}"
                                    style="filter: drop-shadow(0 0 6px ${strokeColor}80)"/>
                            </svg>
                            <div class="tg-score-ring-text">
                                <span class="tg-score-ring-value" style="color:${strokeColor}">${Math.round(score)}</span>
                                <span class="tg-score-ring-label">Trust Score</span>
                            </div>
                        </div>
                    </div>
                    <div class="tg-modal-body">
                        <div class="tg-section-header">📊 Score Breakdown</div>
                        ${metricHtml}
                        ${flagsHtml}
                        <div class="tg-adjusted-rating">
                            <div class="tg-section-header">⭐ Adjusted Rating</div>
                            <div>
                                <span class="tg-adjusted-rating-value">${trustScoreData.adjusted_rating}</span>
                                <span class="tg-adjusted-rating-max">/5</span>
                            </div>
                            <div class="tg-confidence">Confidence: ${Math.round((trustScoreData.confidence || 0) * 100)}%</div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const closeBtn = modal.querySelector('.tg-close');
        const overlay = modal.querySelector('.tg-modal-overlay');

        closeBtn.addEventListener('click', () => modal.remove());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) modal.remove();
        });

        document.body.appendChild(modal);
    }

    async function analyzeProduct() {
        if (analysisInProgress) {
            console.log('TrustGuard: Analysis already in progress');
            return;
        }

        if (!isProductPage()) {
            console.log('TrustGuard: Not a product page, skipping analysis');
            return;
        }

        const asin = extractASIN();
        if (!asin) {
            console.log('TrustGuard: No ASIN found, skipping analysis');
            return;
        }

        if (asin === currentASIN && trustScoreData) {
            console.log('TrustGuard: Already analyzed this product');
            return;
        }

        currentASIN = asin;
        analysisInProgress = true;

        console.log(`TrustGuard: Starting analysis for ASIN: ${asin}`);
        showLoadingBadge();

        try {
            const cacheKey = `tg_${asin}`;
            const cached = await chrome.storage.local.get(cacheKey);

            if (cached[cacheKey]) {
                const age = Date.now() - cached[cacheKey].timestamp;
                const CACHE_DURATION = 30 * 60 * 1000;

                if (age < CACHE_DURATION) {
                    console.log('TrustGuard: Using cached data');
                    trustScoreData = cached[cacheKey].data;
                    injectBadge(trustScoreData);
                    analysisInProgress = false;
                    return;
                }
            }

            const reviews = extractReviews();
            console.log(`TrustGuard: Extracted ${reviews.length} reviews`);

            if (reviews.length === 0) {
                console.warn('TrustGuard: No reviews found on page');
                showNoReviewsMessage();
                analysisInProgress = false;
                return;
            }

            const platform = getPlatform();
            const titleEl = document.querySelector(SELECTORS[platform].productTitle);
            const category = inferCategory(titleEl ? titleEl.innerText : '');

            const requestData = {
                product_id: hashString(asin),
                reviews: reviews,
                metadata: {
                    platform: platform,
                    category: category,
                    review_count: reviews.length,
                    url: window.location.href
                }
            };

            console.log('TrustGuard: Sending analysis request to background script');

            const response = await chrome.runtime.sendMessage({
                action: 'analyze',
                data: requestData
            });

            console.log('TrustGuard: Received response:', response);

            if (!response || !response.success) {
                throw new Error(response?.error || 'Analysis failed');
            }

            trustScoreData = response.data;

            // Compute raw average locally from the scraped reviews and save it inside the cached data
            const rawAvg = reviews.length > 0 ? (reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1) : "3.0";
            trustScoreData.original_rating = rawAvg;

            await chrome.storage.local.set({
                [cacheKey]: {
                    data: trustScoreData,
                    timestamp: Date.now()
                }
            });

            chrome.runtime.sendMessage({
                action: 'updateStats',
                data: {
                    analyzed: true,
                    flagged: trustScoreData.flags && trustScoreData.flags.length > 0
                }
            });

            injectBadge(trustScoreData);
            console.log('TrustGuard: Analysis complete');

        } catch (error) {
            console.error('TrustGuard analysis error:', error);
            injectBadge({
                trust_score: 50,
                flags: [`Analysis error: ${error.message}`],
                adjusted_rating: 0,
                confidence: 0,
                breakdown: {}
            });
        } finally {
            analysisInProgress = false;
            stopLoading();
        }
    }

    function showNoReviewsMessage() {
        const badge = createTrustBadge(50, ['No reviews found on this page'], false);
        let target = document.querySelector('#titleBlock, #title_feature_div, .B_NuCI, h1');
        if (target && target.parentNode) {
            target.parentNode.insertBefore(badge, target.nextSibling);
        }
    }

    function inferCategory(title) {
        if (!title) return 'default';
        const t = title.toLowerCase();
        if (t.includes('book') || t.includes('novel') || t.includes('kindle')) return 'books';
        if (t.includes('phone') || t.includes('laptop') || t.includes('electronic') || t.includes('computer')) return 'electronics';
        if (t.includes('shoe') || t.includes('cloth') || t.includes('fashion') || t.includes('wear')) return 'fashion';
        return 'default';
    }

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'trigger_analysis') {
            console.log("TrustGuard: Manual analysis triggered from popup");
            currentASIN = null;

            analyzeProduct().then(() => {
                const reviews = extractReviews();
                sendResponse({
                    success: true,
                    reviewCount: reviews.length,
                    asin: currentASIN
                });
            }).catch(error => {
                sendResponse({
                    success: false,
                    error: error.message
                });
            });

            return true;
        }

        if (request.action === 'getStatus') {
            sendResponse({
                asin: currentASIN,
                hasData: !!trustScoreData,
                reviewCount: extractReviews().length
            });
            return true;
        }
    });

    function initObserver() {
        if (observerInitialized) return;
        observerInitialized = true;

        console.log('TrustGuard: Initializing observers');

        const observer = new MutationObserver((mutations) => {
            let shouldAnalyze = false;

            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) {
                            const isReview = node.matches && (
                                node.matches('[data-hook="review"]') ||
                                node.matches('.review') ||
                                node.matches('._27M-vq')
                            );

                            const hasReviews = node.querySelector && (
                                node.querySelector('[data-hook="review"]') ||
                                node.querySelector('.review') ||
                                node.querySelector('._27M-vq')
                            );

                            if (isReview || hasReviews) {
                                shouldAnalyze = true;
                                break;
                            }
                        }
                    }
                }
                if (shouldAnalyze) break;
            }

            if (shouldAnalyze && !analysisInProgress) {
                console.log('TrustGuard: New reviews detected, re-analyzing...');
                setTimeout(analyzeProduct, 1500);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        let lastUrl = location.href;
        const urlObserver = new MutationObserver(() => {
            const url = location.href;
            if (url !== lastUrl) {
                console.log('TrustGuard: URL changed, resetting...');
                lastUrl = url;
                currentASIN = null;
                trustScoreData = null;
                setTimeout(analyzeProduct, 2000);
            }
        });

        urlObserver.observe(document, { subtree: true, childList: true });

        if (document.readyState === 'complete') {
            console.log('TrustGuard: Document ready, starting analysis');
            setTimeout(analyzeProduct, 1000);
        } else {
            window.addEventListener('load', () => {
                console.log('TrustGuard: Load event fired');
                setTimeout(analyzeProduct, 1000);
            });
        }
    }

    // Initialize
    initObserver();

})();
