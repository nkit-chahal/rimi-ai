const RAZORPAY_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

let loadPromise = null;

/** Load Razorpay checkout.js on demand (billing / pay only). */
export function loadRazorpay() {
    if (typeof window !== 'undefined' && window.Razorpay) {
        return Promise.resolve(window.Razorpay);
    }

    if (!loadPromise) {
        loadPromise = new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${RAZORPAY_SCRIPT}"]`);
            if (existing) {
                const onReady = () => {
                    if (window.Razorpay) resolve(window.Razorpay);
                    else reject(new Error('Razorpay checkout is unavailable.'));
                };
                existing.addEventListener('load', onReady, { once: true });
                existing.addEventListener('error', () => reject(new Error('Failed to load Razorpay checkout.')), { once: true });
                if (window.Razorpay) onReady();
                return;
            }

            const script = document.createElement('script');
            script.src = RAZORPAY_SCRIPT;
            script.async = true;
            script.onload = () => {
                if (window.Razorpay) resolve(window.Razorpay);
                else reject(new Error('Razorpay checkout is unavailable.'));
            };
            script.onerror = () => {
                loadPromise = null;
                reject(new Error('Failed to load Razorpay checkout.'));
            };
            document.head.appendChild(script);
        });
    }

    return loadPromise;
}
