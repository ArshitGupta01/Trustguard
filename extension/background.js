// TrustGuard Service Worker (Manifest V3)
// CRITICAL: All API calls MUST go through here, not content scripts

const API_ENDPOINT = 'http://localhost:8000/analyze';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// Keep service worker alive
chrome.runtime.onStartup.addListener(() => {
    console.log('TrustGuard: Service Worker started');
});

chrome.runtime.onInstalled.addListener(() => {
    console.log('TrustGuard: Extension installed');
    // Initialize storage
    chrome.storage.local.set({
        enabled: true,
        showOnPage: true,
        analyzedCount: 0,
        flaggedCount: 0
    });
});

// Main message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background received:', request.action);

    if (request.action === 'analyze') {
        handleAnalysis(request.data)
            .then(result => {
                console.log('Analysis success:', result);
                sendResponse({ success: true, data: result });
            })
            .catch(error => {
                console.error('Analysis error:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Keep channel open for async
    }

    if (request.action === 'getCache') {
        chrome.storage.local.get(request.key).then(data => {
            sendResponse(data);
        });
        return true;
    }

    if (request.action === 'updateStats') {
        updateStats(request.data).then(() => {
            sendResponse({ success: true });
        });
        return true;
    }
});

async function updateStats(data) {
    const stats = await chrome.storage.local.get(['analyzedCount', 'flaggedCount']);
    const updates = {};

    if (data.analyzed) {
        updates.analyzedCount = (stats.analyzedCount || 0) + 1;
    }
    if (data.flagged) {
        updates.flaggedCount = (stats.flaggedCount || 0) + 1;
    }

    await chrome.storage.local.set(updates);
}

async function handleAnalysis(data) {
    const cacheKey = `analysis_${data.product_id}`;

    try {
        // Check cache first
        const cached = await chrome.storage.local.get(cacheKey);
        if (cached[cacheKey] && (Date.now() - cached[cacheKey].timestamp) < CACHE_DURATION) {
            console.log('Returning cached result');
            return cached[cacheKey].data;
        }

        console.log('Making API request to:', API_ENDPOINT);

        // Make the actual API request from service worker (bypasses CORS)
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(data)
        });

        console.log('API Response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error ${response.status}: ${errorText}`);
        }

        const result = await response.json();
        console.log('API Result:', result);

        // Cache the result
        await chrome.storage.local.set({
            [cacheKey]: {
                data: result,
                timestamp: Date.now()
            }
        });

        return result;

    } catch (error) {
        console.error('handleAnalysis error:', error);
        throw error;
    }
}

// Handle CORS preflight for content scripts
chrome.webRequest?.onHeadersReceived?.addListener(
    (details) => {
        const headers = details.responseHeaders || [];
        headers.push({ name: 'Access-Control-Allow-Origin', value: '*' });
        headers.push({ name: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' });
        headers.push({ name: 'Access-Control-Allow-Headers', value: 'Content-Type' });
        return { responseHeaders: headers };
    },
    {
        urls: ["http://localhost:8000/*"]
    },
    ["responseHeaders", "extraHeaders"]
);
