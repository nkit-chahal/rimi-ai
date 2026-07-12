import React, { useState, useEffect, useCallback } from 'react';
import { I } from '../shared/StudioIcons';
import { API } from '../shared/helpers';
import { loadRazorpay } from '../shared/loadRazorpay';
import { trackEvent } from '../../../observability';

export default function BillingPanel({ user, userRemainingCredits, currentToken, updateCreditsFromResponse, loadStudioState, activeProject }) {
    const [paymentStatus, setPaymentStatus] = useState({ loadingPackId: null, message: '', error: '' });
    const [razorpayKeyId, setRazorpayKeyId] = useState(import.meta.env.VITE_RAZORPAY_KEY_ID || '');
    const [billingTrack, setBillingTrack] = useState(() => (user?.isPro ? 'pro' : 'basic'));
    const [billingOverview, setBillingOverview] = useState({
        loading: false,
        plans: [],
        usage: null,
        payments: [],
        razorpayConfigured: false,
    });

    const fetchBillingOverview = useCallback(() => {
        if (!currentToken) return;
        setBillingOverview(prev => ({ ...prev, loading: true }));
        fetch(`${API}/api/billing/overview`, {
            headers: { 'Authorization': `Bearer ${currentToken}` },
        })
            .then(r => r.json())
            .then(d => {
                if (d.success) {
                    setBillingOverview({
                        loading: false,
                        plans: d.plans || [],
                        usage: d.usage || null,
                        payments: d.payments || [],
                        razorpayConfigured: Boolean(d.razorpayConfigured),
                    });
                    if (d.usage) {
                        updateCreditsFromResponse({
                            creditsUsed: d.usage.creditsUsed,
                            creditsLimit: d.usage.creditsLimit,
                        });
                    }
                } else {
                    throw new Error(d.error || 'Unable to load billing overview.');
                }
            })
            .catch((err) => {
                setBillingOverview(prev => ({ ...prev, loading: false }));
                setPaymentStatus({ loadingPackId: null, message: '', error: err.message || 'Unable to load billing overview.' });
            });
    }, [currentToken, updateCreditsFromResponse]);

    useEffect(() => {
        if (!currentToken) return;
        fetchBillingOverview();
        loadRazorpay().catch(() => {});
        fetch(`${API}/api/billing/razorpay-config`, {
            headers: { 'Authorization': `Bearer ${currentToken}` },
        })
            .then(r => r.json())
            .then(d => {
                if (d.success && d.keyId) {
                    setRazorpayKeyId(d.keyId);
                } else if (d.success && !d.configured) {
                    setPaymentStatus({ loadingPackId: null, message: '', error: 'Razorpay is not configured on the backend.' });
                }
            })
            .catch(() => setPaymentStatus({ loadingPackId: null, message: '', error: 'Unable to load Razorpay configuration.' }));
    }, [currentToken, fetchBillingOverview]);

    const startRazorpayCheckout = async (pack) => {
        setPaymentStatus({ loadingPackId: pack.id, message: '', error: '' });
        trackEvent('billing_checkout_started', { packId: pack.id, credits: pack.credits, amount: pack.amount });

        if (!razorpayKeyId) {
            setPaymentStatus({ loadingPackId: null, message: '', error: 'Razorpay key id is not configured.' });
            return;
        }

        try {
            const Razorpay = await loadRazorpay();
            const orderRes = await fetch(`${API}/api/create-order`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
                body: JSON.stringify({
                    receipt: `rimi_${user?.id || 'guest'}_${pack.id}_${Date.now()}`,
                    packId: pack.id,
                }),
            });
            const orderData = await orderRes.json().catch(() => ({}));
            if (!orderRes.ok || !orderData.success) {
                throw new Error(orderData.error || 'Unable to create payment order.');
            }

            const checkout = new Razorpay({
                key: orderData.key_id || razorpayKeyId,
                amount: orderData.amount,
                currency: orderData.currency,
                name: 'RIMI AI',
                description: `${pack.credits.toLocaleString()} AI credits`,
                order_id: orderData.order_id,
                prefill: {
                    name: user?.name || '',
                    email: user?.email || '',
                },
                theme: { color: '#6366f1' },
                modal: {
                    ondismiss: () => {
                        setPaymentStatus({ loadingPackId: null, message: '', error: 'Payment cancelled.' });
                    },
                },
                handler: async (response) => {
                    try {
                        setPaymentStatus({ loadingPackId: pack.id, message: 'Verifying payment...', error: '' });
                        const verifyRes = await fetch(`${API}/api/verify-payment`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
                            body: JSON.stringify({
                                razorpay_order_id: response.razorpay_order_id,
                                razorpay_payment_id: response.razorpay_payment_id,
                                razorpay_signature: response.razorpay_signature,
                            }),
                        });
                        const verifyData = await verifyRes.json().catch(() => ({}));
                        if (!verifyRes.ok || !verifyData.success) {
                            throw new Error(verifyData.error || 'Payment verification failed.');
                        }
                        setPaymentStatus({
                            loadingPackId: null,
                            message: `Payment verified for ${pack.credits.toLocaleString()} credits.`,
                            error: '',
                        });
                        trackEvent('billing_checkout_complete', {
                            packId: pack.id,
                            credits: pack.credits,
                            orderId: response.razorpay_order_id,
                        });
                        updateCreditsFromResponse(verifyData);
                        fetchBillingOverview();
                        await loadStudioState(activeProject.id);
                    } catch (err) {
                        setPaymentStatus({
                            loadingPackId: null,
                            message: '',
                            error: err.message || 'Payment verification failed.',
                        });
                    }
                },
            });

            checkout.on('payment.failed', (response) => {
                setPaymentStatus({
                    loadingPackId: null,
                    message: '',
                    error: response?.error?.description || 'Payment failed. Please try again.',
                });
            });

            checkout.open();
        } catch (err) {
            setPaymentStatus({
                loadingPackId: null,
                message: '',
                error: err.message || 'Unable to start payment.',
            });
        }
    };

    const usage = billingOverview.usage || {
        plan: user.plan || 'Free Trial',
        isPro: Boolean(user.isPro),
        tier: user.tier || (user.isPro ? 'pro' : 'normal'),
        creditsUsed: user.creditsUsed || 0,
        creditsLimit: user.creditsLimit || 0,
        creditsRemaining: userRemainingCredits,
        usagePct: user.creditsLimit ? Math.min(100, Math.round(((user.creditsUsed || 0) / user.creditsLimit) * 100)) : 0,
    };
    const plans = (billingOverview.plans || []).filter((pack) => {
        if (pack.id === 'free') return false;
        const track = (pack.track || (['pro', 'scale'].includes(pack.id) ? 'pro' : 'basic'));
        return track === billingTrack;
    });
    const currentPlanName = (usage.plan || user.plan || 'Free').toLowerCase();
    const formatDate = (value) => {
        if (!value) return 'Pending';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    return (
        <div className="st-billing-page">
            <div className="st-billing-header">
                <div>
                    <div className="st-billing-kicker">Subscription</div>
                    <h2>Credits and Billing</h2>
                    <p>Recharge AI credits through Razorpay Standard Checkout. Credits are added to your available limit after payment verification.</p>
                </div>
                <button className="st-billing-refresh" onClick={fetchBillingOverview} disabled={billingOverview.loading}>
                    <I d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" s={16} />
                    {billingOverview.loading ? 'Refreshing' : 'Refresh'}
                </button>
            </div>

            <div className="st-billing-tabs" aria-label="Billing sections">
                <button className="active">RIMI Studio</button>
                <button disabled>API</button>
                <button disabled>Enterprise</button>
            </div>

            <div className="st-billing-summary-grid">
                <section className="st-billing-usage-card">
                    <div className="st-billing-usage-row">
                        <span>Credits used</span>
                        <strong>{Number(usage.creditsUsed || 0).toLocaleString()} / {Number(usage.creditsLimit || 0).toLocaleString()} credits</strong>
                    </div>
                    <div className="st-billing-progress" aria-label={`${usage.usagePct || 0}% credits used`}>
                        <span style={{ width: `${Math.min(100, usage.usagePct || 0)}%` }} />
                    </div>
                    <div className="st-billing-usage-foot">
                        <span>{Number(usage.creditsRemaining || 0).toLocaleString()} credits remaining</span>
                        <span>{usage.usagePct || 0}% used</span>
                    </div>
                </section>

                <section className="st-billing-current-card">
                    <div>
                        <span>Current plan</span>
                        <strong>{usage.plan || 'Free Trial'}</strong>
                        <em className="st-billing-tier-pill">{usage.isPro || user?.isPro ? 'Pro tier' : 'Basic tier'}</em>
                    </div>
                    <div className={`st-billing-status ${billingOverview.razorpayConfigured ? 'ready' : 'missing'}`}>
                        <I d={billingOverview.razorpayConfigured ? 'M20 6L9 17l-5-5' : 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z'} s={14} />
                        {billingOverview.razorpayConfigured ? 'Razorpay ready' : 'Razorpay not configured'}
                    </div>
                </section>
            </div>

            {(paymentStatus.message || paymentStatus.error) && (
                <div className={`st-billing-alert ${paymentStatus.error ? 'error' : 'success'}`}>
                    {paymentStatus.error || paymentStatus.message}
                </div>
            )}

            <div className="st-billing-controls">
                <div className="st-billing-currency">
                    <span>INR</span>
                    <strong>India billing</strong>
                </div>
                <div className="st-billing-cycle st-billing-track" role="tablist" aria-label="Billing track">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={billingTrack === 'basic'}
                        className={billingTrack === 'basic' ? 'active' : ''}
                        onClick={() => setBillingTrack('basic')}
                    >
                        Basic
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={billingTrack === 'pro'}
                        className={billingTrack === 'pro' ? 'active' : ''}
                        onClick={() => setBillingTrack('pro')}
                    >
                        Pro
                    </button>
                </div>
            </div>

            {billingTrack === 'pro' && (
                <p className="st-billing-track-copy">
                    Pro unlocks GPT Image 2, Imagen 4 Ultra, Flux 2 Pro, Nano Banana 2, Seedream, Qwen Studio, and 3D Mockup.
                </p>
            )}

            <div className="st-billing-plans">
                {billingOverview.loading && plans.length === 0 ? (
                    <div className="st-billing-empty">Loading credit packs…</div>
                ) : plans.length === 0 ? (
                    <div className="st-billing-empty">Credit packs are unavailable. Try refreshing.</div>
                ) : plans.map((pack) => {
                    const isLoading = paymentStatus.loadingPackId === pack.id;
                    const amount = Number(pack.amount || 0);
                    const isCurrent = currentPlanName.includes((pack.label || '').toLowerCase());
                    const priceLabel = pack.priceLabel || (amount ? `₹${(amount / 100).toLocaleString('en-IN')}` : '₹0');
                    return (
                        <article key={pack.id} className={`st-billing-plan ${pack.badge ? 'highlighted' : ''} ${pack.track === 'pro' ? 'pro-track' : ''}`}>
                            <div className="st-billing-plan-top">
                                <div>
                                    <h3>{pack.label}</h3>
                                    <p>{pack.description}</p>
                                </div>
                                {pack.badge && <span className="st-billing-badge">{pack.badge}</span>}
                            </div>
                            <div className="st-billing-price">
                                <strong>{priceLabel}</strong>
                                <span>{amount ? 'one-time' : 'trial'}</span>
                            </div>
                            <button
                                className={`st-billing-pay ${pack.badge || pack.track === 'pro' ? 'primary' : ''}`}
                                type="button"
                                onClick={() => startRazorpayCheckout(pack)}
                                disabled={isLoading || !pack.checkoutEnabled || !billingOverview.razorpayConfigured}
                            >
                                {isLoading ? 'Processing...' : isCurrent && !pack.checkoutEnabled ? 'Current plan' : pack.checkoutEnabled ? 'Pay with Razorpay' : 'Included'}
                            </button>
                            <div className="st-billing-credit-line">
                                <strong>{Number(pack.credits || 0).toLocaleString()}</strong>
                                <span>AI credits</span>
                            </div>
                            <ul>
                                {(pack.features || []).map((feature) => (
                                    <li key={feature}><I d="M20 6L9 17l-5-5" s={14} /> {feature}</li>
                                ))}
                            </ul>
                        </article>
                    );
                })}
            </div>

            <section className="st-billing-history">
                <div className="st-billing-section-head">
                    <div>
                        <h3>Payment history</h3>
                        <p>Recent Razorpay orders and credit recharges.</p>
                    </div>
                </div>
                {billingOverview.payments?.length ? (
                    <div className="st-billing-table">
                        {billingOverview.payments.map((payment) => (
                            <div className="st-billing-row" key={payment.id}>
                                <div>
                                    <strong>{payment.packLabel}</strong>
                                    <span>{payment.orderId}</span>
                                </div>
                                <div>{Number(payment.credits || 0).toLocaleString()} credits</div>
                                <div>₹{(Number(payment.amount || 0) / 100).toLocaleString('en-IN')}</div>
                                <div><span className={`st-billing-pill ${payment.status}`}>{payment.status}</span></div>
                                <div>{formatDate(payment.paidAt || payment.createdAt)}</div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="st-billing-empty">No Razorpay payments yet.</div>
                )}
            </section>
        </div>
    );
}
