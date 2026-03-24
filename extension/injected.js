// TrustGuard Injected Script (Optional - for advanced page integration)

(function () {
    'use strict';

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.data.type && event.data.type === 'TRUSTGUARD_REQUEST') {
            // Handle requests from content script if needed
        }
    });
})();
