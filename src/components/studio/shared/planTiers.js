/** Client-side Pro tier helpers (mirrors backend/plan_tiers.py). */

export const PRO_PLANS = new Set([
  'pro',
  'scale',
  'business pro',
  'business studio',
  'enterprise pro',
]);

export function isProUser(user) {
  if (user?.isPro === true) return true;
  if (user?.tier === 'pro') return true;
  const plan = String(user?.plan || '').trim().toLowerCase();
  return PRO_PLANS.has(plan);
}

export const PRO_INSPIRE_MODELS = new Set([
  'bytedance/seedream-4.5',
  'google/nano-banana-2',
  'openai/gpt-image-2',
  'google/imagen-4-ultra',
  'black-forest-labs/flux-2-pro',
]);

export const PRO_EXTRACT_MODELS = new Set([
  'bytedance/seedream-4.5',
  'google/nano-banana-2',
  'openai/gpt-image-2',
  'google/imagen-4-ultra',
  'black-forest-labs/flux-2-pro',
]);

export function isProModel(modelId, tool = 'inspire') {
  if (tool === 'extract') return PRO_EXTRACT_MODELS.has(modelId);
  return PRO_INSPIRE_MODELS.has(modelId);
}
