// TrustGuard Popup Logic — v2.0

document.addEventListener('DOMContentLoaded', async () => {
    console.log('TrustGuard Popup: Loaded');

    // Load stats
    const stats = await chrome.storage.local.get(['analyzedCount', 'flaggedCount']);
    document.getElementById('analyzedCount').textContent = stats.analyzedCount || 0;
    document.getElementById('flaggedCount').textContent = stats.flaggedCount || 0;

    // Load settings
    const settings = await chrome.storage.local.get(['enabled', 'showOnPage']);
    document.getElementById('enableToggle').checked = settings.enabled !== false;
    document.getElementById('showToggle').checked = settings.showOnPage !== false;

    // Toggle handlers
    document.getElementById('enableToggle').addEventListener('change', async (e) => {
        await chrome.storage.local.set({ enabled: e.target.checked });
    });

    document.getElementById('showToggle').addEventListener('change', async (e) => {
        await chrome.storage.local.set({ showOnPage: e.target.checked });
    });

    // Check backend health
    checkBackendHealth();

    // Analyze button
    const analyzeBtn = document.getElementById('analyzeBtn');
    analyzeBtn.addEventListener('click', async () => {
        const statusDiv = document.getElementById('analysisStatus');
        statusDiv.textContent = "Analyzing...";
        statusDiv.style.color = "rgba(255,255,255,0.7)";
        analyzeBtn.classList.add('loading');
        analyzeBtn.textContent = 'Analyzing...';

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab) {
                statusDiv.textContent = "⚠ No active tab";
                statusDiv.style.color = "#ff4757";
                analyzeBtn.classList.remove('loading');
                analyzeBtn.textContent = '🔍 Analyze This Page';
                return;
            }

            console.log('Sending trigger_analysis to tab:', tab.id);

            const response = await chrome.tabs.sendMessage(tab.id, {
                action: 'trigger_analysis'
            });

            console.log('Response received:', response);

            if (response && response.success) {
                statusDiv.textContent = `✓ Found ${response.reviewCount} reviews — analysis complete!`;
                statusDiv.style.color = "#00ff88";

                // Refresh stats
                const newStats = await chrome.storage.local.get(['analyzedCount', 'flaggedCount']);
                document.getElementById('analyzedCount').textContent = newStats.analyzedCount || 0;
                document.getElementById('flaggedCount').textContent = newStats.flaggedCount || 0;
            } else {
                statusDiv.textContent = `✗ ${response?.error || 'Analysis failed'}`;
                statusDiv.style.color = "#ff4757";
            }
        } catch (error) {
            console.error('Error:', error);
            statusDiv.textContent = `Error: ${error.message}. Refresh the page.`;
            statusDiv.style.color = "#ff4757";
        } finally {
            analyzeBtn.classList.remove('loading');
            analyzeBtn.textContent = '🔍 Analyze This Page';
        }
    });
});

async function checkBackendHealth() {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const aiBadge = document.getElementById('aiBadge');
    const aiStatusText = document.getElementById('aiStatusText');

    try {
        const response = await fetch('http://127.0.0.1:8008/health', { signal: AbortSignal.timeout(3000) });
        if (response.ok) {
            const data = await response.json();
            statusDot.classList.remove('offline');
            statusText.textContent = 'Backend connected';

            if (data.model_loaded) {
                aiStatusText.textContent = 'AI Model Active';
                aiBadge.style.borderColor = 'rgba(0,255,136,0.3)';
                aiBadge.style.background = 'linear-gradient(135deg, rgba(0,255,136,0.1), rgba(0,217,255,0.1))';
                aiBadge.querySelector('.ai-dot').style.background = '#00ff88';
            } else {
                aiStatusText.textContent = 'Heuristic Mode';
                aiBadge.style.borderColor = 'rgba(255,170,0,0.3)';
                aiBadge.querySelector('.ai-dot').style.background = '#ffa502';
            }
        } else {
            throw new Error('Not OK');
        }
    } catch (e) {
        statusDot.classList.add('offline');
        statusText.textContent = 'Backend offline';
        aiStatusText.textContent = 'Backend unavailable';
        aiBadge.style.borderColor = 'rgba(255,71,87,0.2)';
        aiBadge.querySelector('.ai-dot').style.background = '#ff4757';
    }
}
