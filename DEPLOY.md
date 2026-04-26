# SENTINEL v3.2 — Axonia Deployment Guide

## What's in this build

```
sentinel-axonia/
├── public/
│   └── index.html          ← Full frontend (auth + 7-tab dashboard)
├── api/
│   ├── adsb.js             ← ADS-B proxy (OpenSky → ADS-B Exchange → curated)
│   ├── analyze.js          ← AI analysis via your Anthropic API key
│   ├── auth.js             ← API key generation + validation
│   ├── watchlists.js       ← Per-user CRUD watchlists
│   └── markets.js          ← Yahoo Finance proxy (server-side, no CORS)
├── lib/
│   └── auth.js             ← HMAC-signed stateless key system
├── package.json
└── vercel.json             ← Routing + env var config
```

---

## Step 1 — Install dependencies

```bash
cd sentinel-axonia
npm install
```

---

## Step 2 — Set environment variables in Vercel

```bash
# Your Anthropic API key (enables AI signal analysis)
vercel env add ANTHROPIC_API_KEY
# Paste: sk-ant-api03-...

# ADS-B Exchange key (optional — free at adsbexchange.com/data)
vercel env add ADSB_EXCHANGE_KEY
# Paste your key, or press Enter to skip (OpenSky fallback will be used)

# Master salt for API key signing (generate a random string)
vercel env add SENTINEL_MASTER_SALT
# Paste: any long random string, e.g. "axonia-sentinel-prod-2025-xkj9mq"
```

---

## Step 3 — Deploy to Vercel

```bash
# First deploy (creates project)
vercel

# Production deploy
vercel --prod
```

Vercel will give you a URL like `https://sentinel-axonia.vercel.app`.

---

## Step 4 — Point sentinel.axonia.us to Vercel

In your DNS provider (Cloudflare recommended):

```
Type    Name        Value
CNAME   sentinel    cname.vercel-dns.com
```

Then in Vercel dashboard → Project Settings → Domains → Add `sentinel.axonia.us`.

---

## Step 5 — Set your production API base URL

In `public/index.html`, find this line near the bottom:

```javascript
const API_BASE = window.SENTINEL_API_BASE || '';
```

Change it to:

```javascript
const API_BASE = window.SENTINEL_API_BASE || 'https://sentinel.axonia.us';
```

Then redeploy: `vercel --prod`

---

## Step 6 — Generate your first API key

Once deployed, generate a key for yourself:

```bash
curl -X POST https://sentinel.axonia.us/api/auth?action=generate \
  -H "Content-Type: application/json" \
  -d '{"username":"axonia-admin","email":"admin@axonia.us","tier":"pro"}'
```

Response:
```json
{
  "apiKey": "sk1_xxxxxx_xxxxxx",
  "username": "axonia-admin",
  "tier": "pro"
}
```

Use this key to log into SENTINEL at `https://sentinel.axonia.us`.

---

## ADS-B data sources (cascade order)

| Priority | Source | Coverage | Key needed |
|----------|--------|---------|------------|
| 1st | ADS-B Exchange | Best military coverage | Yes (free at adsbexchange.com) |
| 2nd | OpenSky Network | Good global coverage | No (free, no key) |
| 3rd | SENTINEL Curated | 12 hand-picked tracks | No |

The frontend also tries OpenSky directly from the browser (sometimes works without CORS proxy). When a backend is configured, `/api/adsb` handles the cascade server-side.

---

## Making auth production-ready (optional upgrade)

The current auth system uses **stateless HMAC-signed keys** — valid without a database. For per-user key management with revocation, add Vercel KV:

```bash
vercel integrations add storage
# Select KV (powered by Upstash)
```

Then in `lib/auth.js`, replace the `validateKey` stub with:

```javascript
import { kv } from '@vercel/kv';

export async function validateKey(key) {
  const parts = key.split('_');
  if (parts.length < 4 || parts[0] !== 'sk1') return null;
  const keyId = `${parts[1]}_${parts[2]}`;
  const userData = await kv.get(`key:${keyId}`);
  if (!userData) return null;
  // Verify HMAC
  const payload = `${keyId}:${userData.username}:${userData.tier}`;
  const expected = crypto.createHmac('sha256', process.env.SENTINEL_MASTER_SALT).update(payload).digest('base64url');
  if (parts[3] !== expected) return null;
  return userData;
}
```

And in `watchlists.js`, replace the in-memory `STORE` Map with `kv.get`/`kv.set` calls for persistence across cold starts.

---

## Local development

```bash
vercel dev
# Runs at http://localhost:3000
# Uses env vars from .vercel/project.json (set by `vercel env pull`)
```

To pull env vars locally:
```bash
vercel env pull .env.local
```

---

## Tier system

| Tier | Rate limit | Notes |
|------|-----------|-------|
| standard | 100 req/hr | Default |
| pro | 1000 req/hr | For power users |
| enterprise | Unlimited | For Axonia internal |

Generate keys with tier: `"tier": "enterprise"` in the POST body.
