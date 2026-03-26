(function () {
    'use strict';

    if (window.__tgeInjected) return;
    window.__tgeInjected = true;

    console.log("TrustGuard Extra: Enhanced Local Heuristic Detector Active");

    /* ── Platform Detection ─────────────────────────────────── */
    const HOST = location.hostname;
    const PATH = location.pathname;
    const IS_AMAZON   = HOST.includes('amazon');
    const IS_FLIPKART = HOST.includes('flipkart');
    if (!IS_AMAZON && !IS_FLIPKART) return;

    // On Flipkart, only run on product detail pages (not search/listing pages)
    // Product pages have /p/ or /itm/ in the URL path
    if (IS_FLIPKART && !(/\/p\/|\/itm\//i.test(PATH))) {
        console.log("TrustGuard Extra: Skipping Flipkart non-product page");
        return;
    }

    /* ── Score Tracker (for product verdict) ────────────────── */
    const reviewResults = { true: 0, fake: 0, unsure: 0, scores: [] };

    /* ── Heuristic Scorer — Enhanced ───────────────────────── */
    function scoreReview(text, hasVerified) {
        let score = 50;
        const reasons = [];
        const low = text.toLowerCase();
        const words = text.split(/\s+/).filter(Boolean);
        const wordCount = words.length;

        // ── 1. Length analysis ──
        if (wordCount < 6) {
            score -= 15; reasons.push("⊖ Very short review");
        } else if (wordCount > 80) {
            score += 18; reasons.push("⊕ Very detailed review");
        } else if (wordCount > 50) {
            score += 15; reasons.push("⊕ Detailed review");
        } else if (wordCount > 20) {
            score += 5;
        }

        // ── 2. Verified purchase ──
        if (hasVerified) {
            score += 25; reasons.push("⊕ Verified Purchase");
        } else {
            score -= 20; reasons.push("⊖ Not verified");
        }

        // ── 3. Excessive CAPS ──
        const caps = (text.match(/[A-Z]/g) || []).length;
        if (text.length > 20 && caps / text.length > 0.35) {
            score -= 18; reasons.push("⊖ Excessive CAPS");
        }

        // ── 4. Generic phrase density ──
        const GENERICS = [
            'good product','nice product','awesome','great product',
            'best product','love it','waste of money','worst product',
            'highly recommend','must buy','value for money','superb',
            'amazing product','excellent product','very good','very bad',
            'totally worth','don\'t buy','worst ever','best ever',
            'paisa vasool','bahut accha','bakwas','bekar'
        ];
        let genericHits = 0;
        for (const g of GENERICS) if (low.includes(g)) genericHits++;
        if (genericHits >= 3) {
            score -= 18; reasons.push("⊖ Mostly generic phrases");
        } else if (genericHits >= 2 && wordCount < 15) {
            score -= 12; reasons.push("⊖ Short with generic phrases");
        }

        // ── 5. Specific details boost ──
        const specifics = /\d+\s*(inch|inches|cm|mm|gb|mb|tb|mah|hour|hours|day|days|month|months|year|years|kg|gm|gram|watt|watts|litre|liter|ml|hz|fps|pixel|megapixel|mp)\b/i;
        if (specifics.test(text)) {
            score += 12; reasons.push("⊕ Contains specific details");
        }

        // ── 6. Sentiment extremity (all positive or all negative = suspicious) ──
        const POSITIVE = ['amazing','excellent','perfect','love','best','awesome','great','fantastic','wonderful','superb','outstanding'];
        const NEGATIVE = ['terrible','horrible','worst','hate','awful','disgusting','pathetic','useless','trash','garbage','scam'];
        let posCount = 0, negCount = 0;
        for (const w of words) {
            const lw = w.toLowerCase().replace(/[^a-z]/g, '');
            if (POSITIVE.includes(lw)) posCount++;
            if (NEGATIVE.includes(lw)) negCount++;
        }
        const sentimentTotal = posCount + negCount;
        if (sentimentTotal >= 3 && (posCount === 0 || negCount === 0)) {
            score -= 10; reasons.push("⊖ One-sided sentiment");
        }

        // ── 7. Repetition detector ──
        const wordFreq = {};
        for (const w of words) {
            const lw = w.toLowerCase().replace(/[^a-z]/g, '');
            if (lw.length > 3) wordFreq[lw] = (wordFreq[lw] || 0) + 1;
        }
        const maxRepeat = Math.max(0, ...Object.values(wordFreq));
        if (maxRepeat >= 4 && wordCount < 30) {
            score -= 12; reasons.push("⊖ Repetitive wording");
        }

        // ── 8. Emoji / exclamation spam ──
        const exclamations = (text.match(/!/g) || []).length;
        const emojiCount = (text.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}]/gu) || []).length;
        if (exclamations > 5 || emojiCount > 5) {
            score -= 8; reasons.push("⊖ Excessive emojis/exclamations");
        }

        // ── 9. Question / comparison presence (real reviews often compare) ──
        if (/\?/.test(text) || /compar|versus|vs\b|better than|worse than|similar to/i.test(text)) {
            score += 6; reasons.push("⊕ Contains comparison/question");
        }

        // ── 10. Grammar proxy (long review with no punctuation) ──
        if (wordCount > 25) {
            const periods = (text.match(/[.,;:]/g) || []).length;
            if (periods === 0) {
                score -= 8; reasons.push("⊖ No punctuation in long text");
            }
        }

        // ── Sigmoid normalisation to avoid clustering around 50 ──
        score = Math.max(0, Math.min(100, score));
        score = 100 / (1 + Math.exp(-0.08 * (score - 50)));
        score = Math.round(score);

        return { score, reasons };
    }

    /* ── SVG Icons ─────────────────────────────────────────── */
    const SVG = {
        check:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
        cross:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
        unsure: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor"/></svg>',
        shield: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    };

    /* ── Badge Creator ──────────────────────────────────────── */
    function makeBadge(result, usedAI = false) {
        const el = document.createElement('span');
        el.className = 'tge-badge';
        let label, cls, icon;

        if (result.score >= 65)      { label = 'Seems True'; cls = 'tge-true';   icon = SVG.check;  reviewResults.true++; }
        else if (result.score <= 38) { label = 'Seems Fake'; cls = 'tge-fake';   icon = SVG.cross;  reviewResults.fake++; }
        else                         { label = 'Unsure';     cls = 'tge-unsure'; icon = SVG.unsure; reviewResults.unsure++; }

        reviewResults.scores.push(result.score);
        el.classList.add(cls);

        const tips = result.reasons.length
            ? result.reasons.join('<br>')
            : 'No strong signals detected';

        const aiTag = usedAI ? `<span class="tge-score-pill" style="background:#00d2ff; color:#090a10; text-shadow:none; margin-left:4px; font-weight:900;">AI</span>` : '';

        el.innerHTML = `
            <span class="tge-icon">${icon}</span>
            <span class="tge-label">${label}</span>
            <span class="tge-score-pill">${result.score}</span>
            ${aiTag}
            <span class="tge-tip">
                <strong>Confidence Score: ${result.score}/100</strong><br>
                <span class="tge-tip-divider"></span>
                ${tips.replace(/\n-/g, '<br>- ')}
            </span>`;
        return el;
    }

    /* ── Review Evaluation Engine ───────────────────────────── */
    function evaluateAndInject(pendingReviews, platform) {
        pendingReviews.forEach(r => r.container.dataset.tgeDone = 'processing');
        
        chrome.runtime.sendMessage({
            action: 'evaluate_reviews_ai',
            data: pendingReviews.map(r => ({ text: r.text, verified: r.verified }))
        }, response => {
            let usedAI = false;
            let results = [];
            
            if (response && response.success && response.data && response.data.results) {
                results = response.data.results.map(r => ({
                    score: r.score,
                    reasons: r.flags
                }));
                usedAI = true;
                console.log(`TrustGuard Extra: Successfully evaluated ${pendingReviews.length} reviews using AI backend.`);
            } else {
                console.warn(`TrustGuard Extra: Backend AI failed or unavailable. Using local heuristic fallback.`, response?.error);
                results = pendingReviews.map(r => scoreReview(r.text, r.verified));
            }

            pendingReviews.forEach((r, i) => {
                const res = results[i] || scoreReview(r.text, r.verified);
                const badge = makeBadge(res, usedAI);
                
                // Injection logic
                if (platform === 'amazon') {
                    if (r.nameEl?.parentNode) {
                        r.nameEl.parentNode.insertBefore(badge, r.nameEl.nextSibling);
                    } else if (r.textEl?.parentNode) {
                        r.textEl.parentNode.insertBefore(badge, r.textEl);
                    } else {
                        r.container.insertBefore(badge, r.container.firstChild);
                    }
                } else if (platform === 'flipkart') {
                    let injected = false;
                    const allChildren = r.container.querySelectorAll('*');
                    for (const child of allChildren) {
                        const t = (child.textContent || '').trim();
                        if (/^[1-5](\.[0-9])?[\s\n]*(★|\*)?$/.test(t) && child.offsetWidth > 0 && child.offsetWidth < 80) {
                            child.parentNode.insertBefore(badge, child.nextSibling);
                            injected = true;
                            break;
                        }
                    }
                    if (!injected) {
                        r.container.insertBefore(badge, r.container.firstChild);
                    }
                }
                r.container.dataset.tgeDone = '1';
            });

            injectProductVerdict(usedAI);
        });
    }

    /* ── Product Genuineness Verdict (integrated with old badge) ─ */
    function injectProductVerdict(usedAI = false) {
        // Remove old verdict if exists
        const old = document.getElementById('tge-product-verdict');
        if (old) old.remove();

        const total = reviewResults.true + reviewResults.fake + reviewResults.unsure;
        if (total < 2) return; // Need at least 2 reviews

        // Genuineness % = (true×100 + unsure×50) / (total×100) × 100
        const genuineness = Math.round(
            ((reviewResults.true * 100 + reviewResults.unsure * 50) / (total * 100)) * 100
        );

        let verdict, verdictClass, verdictEmoji;
        if (genuineness >= 70) {
            verdict = 'Product Seems Genuine';
            verdictClass = 'tge-verdict-genuine';
            verdictEmoji = '🟢';
        } else if (genuineness >= 40) {
            verdict = 'Reviews are Mixed';
            verdictClass = 'tge-verdict-mixed';
            verdictEmoji = '🟡';
        } else {
            verdict = 'Product Seems Suspicious';
            verdictClass = 'tge-verdict-suspicious';
            verdictEmoji = '🔴';
        }

        const avgScore = Math.round(reviewResults.scores.reduce((a, b) => a + b, 0) / total);

        // ── Read data from the old TrustGuard badge (content.js) ──
        const oldBadge = document.getElementById('trustguard-badge');
        let apiScore = null;
        let apiScoreClass = '';
        let apiFlags = [];
        let apiAdjustedRating = null;
        let apiQwenSummary = null;

        if (oldBadge) {
            if (oldBadge.dataset.adjustedRating) {
                apiAdjustedRating = parseFloat(oldBadge.dataset.adjustedRating).toFixed(1);
            }
            
            // Extract score
            const scoreEl = oldBadge.querySelector('.tg-score');
            if (scoreEl) {
                const m = scoreEl.textContent.match(/(\d+)/);
                if (m) apiScore = parseInt(m[1]);
            }
            // Extract score class
            if (oldBadge.classList.contains('tg-excellent')) apiScoreClass = 'tge-api-excellent';
            else if (oldBadge.classList.contains('tg-good')) apiScoreClass = 'tge-api-good';
            else if (oldBadge.classList.contains('tg-caution')) apiScoreClass = 'tge-api-caution';
            else if (oldBadge.classList.contains('tg-danger')) apiScoreClass = 'tge-api-danger';
            // Extract flags
            const flagEls = oldBadge.querySelectorAll('.tg-flags li');
            flagEls.forEach(li => apiFlags.push(li.textContent.trim()));
            
            // Extract Qwen Summary
            if (oldBadge.dataset.qwenSummary) {
                apiQwenSummary = oldBadge.dataset.qwenSummary;
            }
        }

        // ── Build the unified card ──
        const card = document.createElement('div');
        card.id = 'tge-product-verdict';
        card.className = `tge-verdict ${verdictClass}`;

        // API trust score section (if available)
        const apiSection = apiScore !== null ? `
            <div class="tge-api-section ${apiScoreClass}">
                <div class="tge-api-row">
                    <span class="tge-api-label">🛡️ TrustGuard Score</span>
                    <span class="tge-api-score">${apiScore}<span class="tge-api-max">/100</span></span>
                </div>
                ${apiAdjustedRating ? `
                <div class="tge-api-row" style="margin-top: 4px;">
                    <span class="tge-api-label" style="color:#00d2ff;">⭐ Adjusted Rating</span>
                    <span class="tge-api-score" style="font-size: 22px; color:#ffffff;">${apiAdjustedRating}<span class="tge-api-max">/5</span></span>
                </div>` : ''}
                <div class="tge-api-bar-track">
                    <div class="tge-api-bar-fill" style="width:${apiScore}%"></div>
                </div>
                ${apiFlags.length > 0 ? `<div class="tge-api-flags">${apiFlags.map(f => `<span class="tge-api-flag">⚠ ${f}</span>`).join('')}</div>` : ''}
            </div>
            <div class="tge-divider"></div>
        ` : '';

        card.innerHTML = `
            <div class="tge-verdict-header">
                <span class="tge-verdict-icon">${SVG.shield}</span>
                <span class="tge-verdict-title">TrustGuard Analysis ${usedAI ? '<span class="tge-score-pill" style="margin-left:6px; background:#00d2ff; color:#090a10; text-shadow:none;">AI</span>' : ''}</span>
            </div>
            ${apiSection}
            <div class="tge-verdict-main">
                <span class="tge-verdict-emoji">${verdictEmoji}</span>
                <span class="tge-verdict-text">${verdict}</span>
            </div>
            <div class="tge-verdict-bar-track">
                <div class="tge-verdict-bar-fill" style="width:${genuineness}%"></div>
            </div>
            <div class="tge-verdict-percent">${genuineness}% Genuineness Score</div>
            <div class="tge-verdict-breakdown">
                <span class="tge-vb tge-vb-true">✓ ${reviewResults.true} True</span>
                <span class="tge-vb-dot">·</span>
                <span class="tge-vb tge-vb-fake">✗ ${reviewResults.fake} Fake</span>
                <span class="tge-vb-dot">·</span>
                <span class="tge-vb tge-vb-unsure">? ${reviewResults.unsure} Unsure</span>
                <span class="tge-vb-dot">·</span>
                <span class="tge-vb tge-vb-total">${total} Reviews</span>
            </div>
            <div class="tge-verdict-avg">Average Review Score: <strong>${avgScore}/100</strong></div>
            ${apiQwenSummary ? `
            <div class="tge-qwen-section">
                <div class="tge-qwen-header">
                    <span class="tge-qwen-icon">🤖</span>
                    <span class="tge-qwen-title">Qwen AI Summary</span>
                </div>
                <div class="tge-qwen-body">${apiQwenSummary}</div>
            </div>` : ''}
            <div class="tge-verdict-footer">Click for detailed analysis</div>
        `;

        // Floating circle button
        const circleBtn = document.createElement('div');
        circleBtn.className = 'tge-circle-btn';
        circleBtn.innerHTML = SVG.shield;
        circleBtn.style.display = 'none';
        
        let fadeTimeout;
        
        circleBtn.onclick = () => {
            circleBtn.style.display = 'none';
            card.style.display = 'block';
            card.style.animation = 'tgeVerdictSlideIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both';
            if (fadeTimeout) clearTimeout(fadeTimeout);
        };
        document.body.appendChild(circleBtn);

        // Add a close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'tge-close-btn';
        closeBtn.innerHTML = '✕';
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            card.style.display = 'none';
            circleBtn.style.display = 'flex';
            circleBtn.style.animation = 'tgeVerdictSlideIn 0.3s ease forwards';
            if (fadeTimeout) clearTimeout(fadeTimeout);
        };
        card.appendChild(closeBtn);

        // Clicking opens the detailed modal (triggers the old badge's click handler)
        card.style.cursor = 'pointer';
        card.addEventListener('click', (e) => {
            // Re-query for the badge in case it was added/removed/updated
            const badge = document.getElementById('trustguard-badge');
            if (badge) {
                console.log("TrustGuard Extra: Triggering detailed analysis modal via badge click.");
                badge.click();
            } else {
                console.warn("TrustGuard Extra: Could not find TrustGuard badge (#trustguard-badge) to trigger modal.");
                // Fallback: Notify the user or try to find anything clickable from TrustGuard
                const fallback = document.querySelector('.trustguard-badge, .badge-inner');
                if (fallback) fallback.click();
            }
        });

        // Inject as a floating popup in the body
        document.body.appendChild(card);
        
        // Auto-fade into circle after 3 seconds
        fadeTimeout = setTimeout(() => {
            if (document.body.contains(card)) {
                card.style.animation = 'tgeVerdictFadeOut 0.5s cubic-bezier(0.4, 0, 0.2, 1) forwards';
                setTimeout(() => {
                    card.style.display = 'none';
                    circleBtn.style.display = 'flex';
                    circleBtn.style.animation = 'tgeVerdictSlideIn 0.3s ease forwards';
                }, 500);
            }
        }, 3000);
        
        // Ensure old badge remains visible inline
        if (oldBadge && oldBadge.style.display === 'none') {
            oldBadge.style.display = '';
        }

        console.log(`TrustGuard Extra: Unified verdict — ${verdict} (${genuineness}%), API score: ${apiScore}`);
    }

    /* ── AMAZON review processor ────────────────────────────── */
    function processAmazon() {
        const containers = document.querySelectorAll(
            '[data-hook="review"], .review, .a-section.review'
        );
        const pendingReviews = [];
        containers.forEach(c => {
            if (c.dataset.tgeDone) return;

            const textEl = c.querySelector(
                '[data-hook="review-body"] span, .review-text-content span, .review-text'
            );
            const text = textEl?.innerText?.trim();
            if (!text || text.length < 8) return;

            const verified = !!c.querySelector('[data-hook="avp-badge"], .avp-badge')
                || c.innerText.includes('Verified Purchase');

            const nameEl = c.querySelector('.a-profile-name');
            pendingReviews.push({ text, verified, container: c, nameEl, textEl });
        });
        
        if (pendingReviews.length > 0) {
            evaluateAndInject(pendingReviews, 'amazon');
        }
    }

    /* ── FLIPKART review processor (robust, class-agnostic) ── */
    function processFlipkart() {
        // Expand "READ MORE" buttons automatically to read full content
        document.querySelectorAll('span, div, button').forEach(el => {
            const t = el.textContent || '';
            if (t.trim().toUpperCase() === 'READ MORE') {
                try { el.click(); } catch(e) {}
            }
        });

        // Heuristic scan: Find elements containing unique review metadata text
        const candidates = [];
        const textNodes = document.querySelectorAll('span, div, p');
        for (const el of textNodes) {
            if (el.children.length > 1) continue; 
            
            const txt = (el.textContent || '').trim().toLowerCase();
            if (txt === 'certified buyer' || txt === 'helpful' || txt === 'report' || txt.includes('days ago') || txt.includes('months ago')) {
                let parent = el.parentElement;
                for (let i = 0; i < 9 && parent; i++) {
                    const parentText = parent.textContent || '';
                    if (parentText.length > 40 && parentText.length < 5000) {
                        if (/[1-5][\s\n]*(★|\*)/.test(parentText) || /certified|helpful/i.test(parentText)) {
                            if (!parent.dataset.tgeDone && !candidates.includes(parent)) {
                                candidates.push(parent);
                            }
                            break;
                        }
                    }
                    parent = parent.parentElement;
                }
            }
        }

        let containers = candidates;
        console.log(`TrustGuard Extra: Heuristic found ${candidates.length} candidate review containers`);
        
        // Fallback to commonly known CSS patterns
        if (containers.length === 0) {
            containers = document.querySelectorAll(
                '.RcXBOT, ._27M-vq, ._1AtVbE, ._2wzgFH, [data-testid="review"]'
            );
            console.log(`TrustGuard Extra: Fallback CSS found ${containers.length} containers`);
        }

        const processed = new Set();
        const pendingReviews = [];
        const nodeList = containers instanceof NodeList ? Array.from(containers) : containers;

        for (const container of nodeList) {
            if (container.dataset.tgeDone) continue;

            const key = (container.textContent || '').substring(0, 100).replace(/\s+/g, ' ').trim();
            if (key.length < 10 || processed.has(key)) continue;
            processed.add(key);

            const fullText = container.innerText || container.textContent || '';
            
            // Just strip out structural buttons/metadata from the entire blob rather than splitting by \n
            const reviewText = fullText
                .replace(/(READ MORE|Helpful|Report|Thank|✓|[1-5][\s\n]*★|Certified Buyer|Share|Permalink)/gi, '')
                .replace(/\d+\s*(days|months|years)\s*ago/gi, '')
                .trim();
                
            if (reviewText.length < 15) {
                console.log("TrustGuard Extra: Skipped review (too short after stripping):", reviewText);
                continue;
            }

            const verified = /certified buyer|verified/i.test(fullText);
            pendingReviews.push({ text: reviewText, verified, container });
        }

        console.log(`TrustGuard Extra: Pushing ${pendingReviews.length} Flipkart reviews to AI backend`);
        if (pendingReviews.length > 0) {
            evaluateAndInject(pendingReviews, 'flipkart');
        } else {
            console.log("TrustGuard Extra: NO REVIEWS FOUND ON FLIPKART.");
        }
    }

    /* ── Main Runner ────────────────────────────────────────── */
    function run() {
        if (IS_AMAZON) processAmazon();
        else if (IS_FLIPKART) processFlipkart();
    }

    // Run on load + delays for lazy-loaded content
    setTimeout(run, 1500);
    setTimeout(run, 4000);
    setTimeout(run, 8000);

    // Re-run on DOM changes (infinite scroll, tab switches)
    let debounce = null;
    const observer = new MutationObserver(() => {
        clearTimeout(debounce);
        debounce = setTimeout(run, 1000);
    });
    observer.observe(document.body, { childList: true, subtree: true });

})();
