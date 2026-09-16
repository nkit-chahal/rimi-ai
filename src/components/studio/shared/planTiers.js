/** Client-side Pro tier helpers (mirrors backend/plan_tiers.py). */

export const PRO_PLANS = new Set([
  'pro',
  'scale',
  'business pro',
  'business studio',
  'enterprise pro',
]);

export function isProUser(user) {
  if (!user) return false;
  // Pro is a dated window on the server (users.pro_until) and the plan label outlives
  // it, so a lapsed account still reads as plan 'Pro'. Trust isPro/tier whenever the
  // payload carries them; the label is only a fallback for older cached sessions.
  if (typeof user.isPro === 'boolean') return user.isPro;
  if (user.tier) return user.tier === 'pro';
  const plan = String(user.plan || '').trim().toLowerCase();
  return PRO_PLANS.has(plan);
}

export const PRO_INSPIRE_MODELS = new Set([
  'bytedance/seedream-4.5',
  'google/nano-banana-2',
  'openai/gpt-image-2',
  'black-forest-labs/flux-2-pro',
]);

export const PRO_EXTRACT_MODELS = new Set([
  'bytedance/seedream-4.5',
  'google/nano-banana-2',
  'openai/gpt-image-2',
  'black-forest-labs/flux-2-pro',
]);

export function isProModel(modelId, tool = 'inspire') {
  if (tool === 'extract') return PRO_EXTRACT_MODELS.has(modelId);
  return PRO_INSPIRE_MODELS.has(modelId);
}
