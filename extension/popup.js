// TrustGuard Popup Logic

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

    // Analyze button
    document.getElementById('analyzeBtn').addEventListener('click', async () => {
        const statusDiv = document.getElementById('analysisStatus');
        const qwenDiv = document.getElementById('qwenSummary');
        qwenDiv.textContent = '';

        let seconds = 0;
        statusDiv.textContent = `Analyzing... Qwen summary pending (${seconds}s)`;
        statusDiv.style.color = "#fff";

        const timer = setInterval(() => {
            seconds += 1;
            statusDiv.textContent = `Analyzing... Qwen summary pending (${seconds}s)`;
        }, 1000);

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab) {
                statusDiv.textContent = "Error: No active tab";
                statusDiv.style.color = "#ff4757";
                return;
            }

            console.log('Sending trigger_analysis to tab:', tab.id);

            const response = await chrome.tabs.sendMessage(tab.id, {
                action: 'trigger_analysis'
            });

            console.log('Response received:', response);

            if (response && response.success) {
                clearInterval(timer);
                statusDiv.textContent = "✓ Analysis complete!";
                statusDiv.style.color = "#00ff88";

                const qwenText = response.qwen_summary;
                if (qwenText) {
                    qwenDiv.innerHTML = `<strong>Qwen Summary:</strong><br>${qwenText}`;
                } else {
                    qwenDiv.innerHTML = `<strong>Qwen Summary:</strong><br>Not available yet.`;
                }

                // Refresh stats
                const newStats = await chrome.storage.local.get(['analyzedCount', 'flaggedCount']);
                document.getElementById('analyzedCount').textContent = newStats.analyzedCount || 0;
                document.getElementById('flaggedCount').textContent = newStats.flaggedCount || 0;
            } else {
                clearInterval(timer);
                statusDiv.textContent = `✗ ${response?.error || 'Analysis failed'}`;
                statusDiv.style.color = "#ff4757";
            }
        } catch (error) {
            clearInterval(timer);
            console.error('Error:', error);
            statusDiv.textContent = `Error: ${error.message}. Try refreshing the page.`;
            statusDiv.style.color = "#ff4757";
        }
    });


});
