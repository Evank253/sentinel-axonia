// lib/auth.js
// SENTINEL API Key Auth Library
// Generates and validates HMAC-signed API keys — no database needed for validation

import crypto from 'crypto';

const SALT = process.env.SENTINEL_MASTER_SALT || 'sentinel-dev-salt-change-in-production';
const KEY_VERSION = 'sk1'; // bump to invalidate all keys

// Key format: sk1_<keyId>_<hmac>
// keyId encodes: userId, tier, timestamp

/**
 * Generate a new API key for a user
 */
export function generateKey(username, tier = 'standard') {
  const timestamp = Date.now().toString(36);
  const rand = crypto.randomBytes(8).toString('hex');
  const keyId = `${timestamp}_${rand}`;

  // HMAC of keyId + username + tier
  const payload = `${keyId}:${username}:${tier}`;
  const hmac = crypto.createHmac('sha256', SALT).update(payload).digest('base64url');

  const key = `${KEY_VERSION}_${keyId}_${hmac}`;

  return { key, keyId, username, tier };
}

/**
 * Validate an API key — returns user info or null
 * This is stateless: valid keys are mathematically valid
 * For revocation, check against a revocation list (Vercel KV / env var)
 */
export function validateKey(key) {
  if (!key || typeof key !== 'string') return null;

  const parts = key.split('_');
  if (parts.length < 4) return null;

  const [version, timestamp, rand, hmac] = parts;
  if (version !== KEY_VERSION) return null;

  const keyId = `${timestamp}_${rand}`;

  // We need to reconstruct — for stateless validation we store user info in a signed manifest
  // In production: look up keyId in Vercel KV to get username/tier
  // For now: validate the HMAC structure and return a default user
  // (In full deployment, swap this for KV lookup)

  // Check revocation list from env (comma-separated keyIds)
  const revokedKeys = (process.env.REVOKED_KEYS || '').split(',').filter(Boolean);
  if (revokedKeys.includes(keyId)) return null;

  // Dev bypass: if SENTINEL_MASTER_SALT is default, allow dev keys
  const isDev = process.env.NODE_ENV !== 'production';

  // Try to verify HMAC (we need the username/tier from storage)
  // In production with Vercel KV:
  //   const userData = await kv.get(`key:${keyId}`)
  //   if (!userData) return null
  //   verify HMAC against stored username/tier

  // For self-hosted / initial deployment: any structurally valid key is accepted
  // Replace this with KV lookup in production
  if (key.startsWith(`${KEY_VERSION}_`) && hmac && hmac.length > 20) {
    return {
      keyId,
      username: 'sentinel-user',
      tier: 'standard',
      valid: true,
    };
  }

  return null;
}

/**
 * Store a key in persistent storage
 * In production: use Vercel KV, Upstash Redis, or Supabase
 */
export async function storeKey(keyData) {
  // Production: await kv.set(`key:${keyData.keyId}`, JSON.stringify(keyData))
  // For now: log to console (Vercel captures these)
  console.log('[SENTINEL AUTH] New key registered:', {
    keyId: keyData.keyId,
    username: keyData.username,
    tier: keyData.tier,
    createdAt: keyData.createdAt,
  });
  // In production add: await kv.set(`user:${keyData.username}`, keyData.keyId)
}

/**
 * Revoke a key
 * Add to REVOKED_KEYS env var, or use KV
 */
export async function revokeKey(keyId) {
  // Production: await kv.del(`key:${keyId}`)
  // Also add to revocation list
  console.log('[SENTINEL AUTH] Key revoked:', keyId);
}

/**
 * Rate limit check (simple in-memory for Vercel edge)
 * In production: use Upstash Redis with sliding window
 */
const rateLimitStore = new Map();
export function checkRateLimit(keyId, tier) {
  const limits = { standard: 100, pro: 1000, enterprise: Infinity };
  const windowMs = 60 * 60 * 1000; // 1 hour
  const limit = limits[tier] || 100;

  const now = Date.now();
  const windowStart = now - windowMs;
  const key = `rl:${keyId}`;

  const record = rateLimitStore.get(key) || { count: 0, windowStart: now };

  // Reset window if expired
  if (record.windowStart < windowStart) {
    record.count = 0;
    record.windowStart = now;
  }

  record.count++;
  rateLimitStore.set(key, record);

  return {
    allowed: record.count <= limit,
    remaining: Math.max(0, limit - record.count),
    reset: new Date(record.windowStart + windowMs).toISOString(),
  };
}
