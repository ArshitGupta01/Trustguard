// TrustGuard Content Script - DOM Scraper ONLY
// CRITICAL: No direct fetch() calls here - all API calls go through background script

(function () {
    'use strict';

    console.log("TrustGuard: Content Script Loaded & Active");

    let currentASIN = null;
    let analysisInProgress = false;
    let trustScoreData = null;
    let observerInitialized = false;

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
                '.a-icon-mini-star-filled', // Sometimes used in compact views
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
        },
        playstore: {
            reviewContainer: ['.RHo1pe'],
            reviewText: ['.h3bYgc'],
            rating: ['.iPNoBe div[aria-label]'],
            reviewerName: ['.X5079c'],
            verifiedPurchase: [], // Playstore doesn't have an AVP badge like Amazon
            reviewDate: ['.bp9SZb'],
            helpfulVotes: ['.R0iScd'],
            productTitle: ['h1.Fd93ec', '.VfPpkd-GlS6sc-PR7oYc'],
            asinFromUrl: /[?&]id=([a-zA-Z0-9._]+)/i
        },
        myntra: {
            reviewContainer: ['.user-review-main'],
            reviewText: ['.user-review-reviewText'],
            rating: ['.user-review-rating'],
            reviewerName: ['.user-review-userName'],
            verifiedPurchase: [],
            reviewDate: ['.user-review-date'],
            helpfulVotes: ['.user-review-usefulCount'],
            productTitle: ['.pdp-title', '.pdp-name'],
            asinFromUrl: /\/(\d+)\/buy/i
        }
    };

    function getPlatform() {
        const host = window.location.hostname;
        if (host.includes('amazon')) return 'amazon';
        if (host.includes('flipkart')) return 'flipkart';
        if (host.includes('play.google.com')) return 'playstore';
        if (host.includes('myntra.com')) return 'myntra';
        return null;
    }

    function extractASIN() {
        const platform = getPlatform();
        if (!platform) return null;

        try {
            const s = SELECTORS[platform];

            // Try URL regex patterns (now supports array of patterns)
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

            // Try data-asin attribute (Amazon specific)
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

            // Try query params for Flipkart
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.has('pid')) return urlParams.get('pid');

            // Try meta tags
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

    function parseRating(el, platform) {
        if (!el) return 3;
        const text = el.innerText || '';
        
        if (platform === 'playstore') {
            const ariaLabel = el.getAttribute('aria-label') || '';
            const match = ariaLabel.match(/(\d+)/);
            return match ? parseFloat(match[1]) : 3;
        }

        const match = text.match(/(\d+(\.\d+)?)/);
        return match ? parseFloat(match[1]) : 3;
    }

    function parseDate(dateText) {
        if (!dateText) return new Date().toISOString();
        try {
            // Handle various date formats
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

        // Try multiple container selectors
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

        // Fallback: Try to find reviews by text content patterns
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
                if (!text || text.length < 10) return; // Skip empty/short reviews

                reviews.push({
                    text: text,
                    rating: parseRating(ratingEl, platform),
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

    function createTrustBadge(score, flags) {
        const badge = document.createElement('div');
        badge.id = 'trustguard-badge';
        badge.className = `trustguard-badge ${getScoreClass(score)}`;

        const flagList = flags.map(f => `<li>${f}</li>`).join('');

        badge.innerHTML = `
      <div class="tg-header">
        <span class="tg-icon">🛡️</span>
        <span class="tg-title">TrustGuard</span>
        <span class="tg-score">${Math.round(score)}/100</span>
      </div>
      <div class="tg-details">
        <div class="tg-rating-bar">
          <div class="tg-rating-fill" style="width: ${score}%"></div>
        </div>
        ${flags.length > 0 ? `<ul class="tg-flags">${flagList}</ul>` : ''}
        <div class="tg-footer">Click for details</div>
      </div>
    `;

        badge.addEventListener('click', showDetailedAnalysis);
        return badge;
    }

    function getScoreClass(score) {
        if (score >= 80) return 'tg-excellent';
        if (score >= 60) return 'tg-good';
        if (score >= 40) return 'tg-caution';
        return 'tg-danger';
    }

    function injectBadge(data) {
        // Remove existing badge
        const existing = document.getElementById('trustguard-badge');
        if (existing) existing.remove();

        // Find injection point
        let target = document.querySelector('#titleBlock, #title_feature_div, .B_NuCI, [data-hook="product-title"]');

        if (!target) {
            // Fallback: Try to find title area
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

        const badge = createTrustBadge(data.trust_score, data.flags);

        // Insert after target
        if (target.parentNode) {
            target.parentNode.insertBefore(badge, target.nextSibling);
            console.log('TrustGuard: Badge injected successfully');
        }
    }

    function showDetailedAnalysis() {
        if (!trustScoreData) {
            console.warn('TrustGuard: No data to show');
            return;
        }

        // Remove existing modal
        const existingModal = document.getElementById('trustguard-modal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 'trustguard-modal';
        modal.innerHTML = `
      <div class="tg-modal-overlay">
        <div class="tg-modal-content">
          <button class="tg-close">&times;</button>
          <h2>🛡️ TrustGuard Analysis</h2>
          <div class="tg-score-circle ${getScoreClass(trustScoreData.trust_score)}">
            <span class="tg-big-score">${Math.round(trustScoreData.trust_score)}</span>
            <span class="tg-label">Trust Score</span>
          </div>
          <div class="tg-breakdown">
            <h3>Score Breakdown</h3>
            ${Object.entries(trustScoreData.breakdown || {})
                .filter(([k]) => k !== 'weights_used')
                .map(([key, value]) => `
                <div class="tg-metric">
                  <span class="tg-metric-name">${key.replace(/_/g, ' ')}</span>
                  <div class="tg-metric-bar">
                    <div style="width: ${Math.max(0, Math.min(100, value))}%"></div>
                  </div>
                  <span class="tg-metric-value">${Math.round(value)}</span>
                </div>
              `).join('')}
          </div>
          ${trustScoreData.flags && trustScoreData.flags.length > 0 ? `
            <div class="tg-flags-section">
              <h3>⚠️ Warnings</h3>
              <ul>${trustScoreData.flags.map(f => `<li>${f}</li>`).join('')}</ul>
            </div>
          ` : ''}
          <div class="tg-adjusted-rating">
            <h3>Adjusted Rating</h3>
            <p>Based on authentic reviews: <strong>${trustScoreData.adjusted_rating}/5</strong></p>
            <p class="tg-confidence">Confidence: ${Math.round((trustScoreData.confidence || 0) * 100)}%</p>
          </div>
        </div>
      </div>
    `;

        // Close handlers
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

        try {
            // Check local cache first
            const cacheKey = `tg_${asin}`;
            const cached = await chrome.storage.local.get(cacheKey);

            if (cached[cacheKey]) {
                const age = Date.now() - cached[cacheKey].timestamp;
                const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

                if (age < CACHE_DURATION) {
                    console.log('TrustGuard: Using cached data');
                    trustScoreData = cached[cacheKey].data;
                    injectBadge(trustScoreData);
                    analysisInProgress = false;
                    return;
                }
            }

            // Scroll to load more reviews if needed (but don't wait too long)
            if (reviews.length < 20) {
                console.log('TrustGuard: Few reviews found, attempting to scroll...');
                await scrollForReviews();
                // Re-extract reviews after scrolling
                const moreReviews = extractReviews();
                if (moreReviews.length > reviews.length) {
                    console.log(`TrustGuard: Scrolled and found ${moreReviews.length} reviews`);
                    reviews.splice(0, reviews.length, ...moreReviews);
                }
            }

            if (reviews.length === 0) {
                console.warn('TrustGuard: No reviews found on page');
                showNoReviewsMessage();
                analysisInProgress = false;
                return;
            }

            // Prepare data
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

            // Send message to background script for API call
            const response = await chrome.runtime.sendMessage({
                action: 'analyze',
                data: requestData
            });

            console.log('TrustGuard: Received response:', response);

            if (!response || !response.success) {
                throw new Error(response?.error || 'Analysis failed');
            }

            trustScoreData = response.data;

            // Cache result
            await chrome.storage.local.set({
                [cacheKey]: {
                    data: trustScoreData,
                    timestamp: Date.now()
                }
            });

            // Update stats
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
        }
    }

    function showNoReviewsMessage() {
        const badge = createTrustBadge(50, ['No reviews found on this page']);
        let target = document.querySelector('#titleBlock, #title_feature_div, .B_NuCI, h1');
        if (target && target.parentNode) {
            target.parentNode.insertBefore(badge, target.nextSibling);
        }
    }

    function inferCategory(title) {
        if (!title) return 'default';
        const t = title.toLowerCase();
        if (t.includes('book') || t.includes('novel') || t.includes('kindle')) return 'books';
        if (t.includes('phone') || t.includes('laptop') || t.includes('electronic') || t.includes('computer') || t.includes('camera')) return 'electronics';
        if (t.includes('shoe') || t.includes('cloth') || t.includes('fashion') || t.includes('wear')) return 'fashion';
        if (t.includes('app') || t.includes('game') || t.includes('software') || t.includes('messenger') || t.includes('tool')) return 'software';
        return 'default';
    }

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'trigger_analysis') {
            console.log("TrustGuard: Manual analysis triggered from popup");

            // Reset current ASIN to force re-analysis
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

            return true; // Keep channel open
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

        // Watch for review section loading
        const observer = new MutationObserver((mutations) => {
            let shouldAnalyze = false;

            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) { // Element node
                            // Check if it's a review or contains reviews
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
                setTimeout(analyzeProduct, 1500); // Delay to let DOM settle
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Handle URL changes (SPA navigation)
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

        // Initial analysis
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

    async function scrollForReviews() {
        return new Promise((resolve) => {
            const platform = getPlatform();
            if (platform === 'amazon') {
                // For Amazon, the "Top reviews" are usually enough for initial score,
                // but we can try to scroll to the review section
                const reviewHeader = document.querySelector('#reviews-medley-footer');
                if (reviewHeader) {
                    reviewHeader.scrollIntoView({ behavior: 'smooth' });
                }
            } else {
                window.scrollTo({
                    top: document.body.scrollHeight / 2,
                    behavior: 'smooth'
                });
            }

            setTimeout(() => {
                window.scrollTo({
                    top: document.body.scrollHeight,
                    behavior: 'smooth'
                });
                setTimeout(resolve, 1500); // Wait for lazy load
            }, 1000);
        });
    }

    // Initialize
    initObserver();

})();
