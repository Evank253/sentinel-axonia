// api/watchlists.js
// SENTINEL Watchlists — per-user saved watchlists stored in Vercel KV (or file fallback)

// Watchlist schema:
// {
//   id: string,
//   userId: string,
//   name: string,
//   type: 'callsigns' | 'vessels' | 'countries' | 'keywords' | 'mixed',
//   items: string[],
//   alerts: boolean,
//   createdAt: string,
//   updatedAt: string,
// }

import crypto from 'crypto';

// In-memory store for Vercel (replace with KV in production)
// In a real deployment: import { kv } from '@vercel/kv';
const STORE = new Map();

function getStoreKey(userId) {
  return `watchlists:${userId}`;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing X-API-Key' });
  const { validateKey } = await import('../lib/auth.js');
  const user = validateKey(apiKey);
  if (!user) return res.status(403).json({ error: 'Invalid API key' });

  const storeKey = getStoreKey(user.keyId);

  // ── GET ALL WATCHLISTS ─────────────────────────────────────
  if (req.method === 'GET' && !req.query.id) {
    const lists = STORE.get(storeKey) || [];
    return res.status(200).json({ watchlists: lists, count: lists.length });
  }

  // ── GET SINGLE WATCHLIST ───────────────────────────────────
  if (req.method === 'GET' && req.query.id) {
    const lists = STORE.get(storeKey) || [];
    const list = lists.find(l => l.id === req.query.id);
    if (!list) return res.status(404).json({ error: 'Watchlist not found' });
    return res.status(200).json(list);
  }

  // ── CREATE WATCHLIST ───────────────────────────────────────
  if (req.method === 'POST') {
    const { name, type = 'mixed', items = [], alerts = false } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });

    const lists = STORE.get(storeKey) || [];
    if (lists.length >= 20) return res.status(429).json({ error: 'Max 20 watchlists per user' });

    const newList = {
      id: crypto.randomBytes(8).toString('hex'),
      userId: user.keyId,
      name,
      type,
      items: items.slice(0, 100), // max 100 items
      alerts,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    lists.push(newList);
    STORE.set(storeKey, lists);

    return res.status(201).json(newList);
  }

  // ── UPDATE WATCHLIST ───────────────────────────────────────
  if (req.method === 'PUT') {
    const { id, name, items, alerts, type } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });

    const lists = STORE.get(storeKey) || [];
    const idx = lists.findIndex(l => l.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Watchlist not found' });

    if (name !== undefined) lists[idx].name = name;
    if (items !== undefined) lists[idx].items = items.slice(0, 100);
    if (alerts !== undefined) lists[idx].alerts = alerts;
    if (type !== undefined) lists[idx].type = type;
    lists[idx].updatedAt = new Date().toISOString();

    STORE.set(storeKey, lists);
    return res.status(200).json(lists[idx]);
  }

  // ── ADD ITEM TO WATCHLIST ──────────────────────────────────
  if (req.method === 'PATCH') {
    const { id, item, action: act = 'add' } = req.body || {};
    if (!id || !item) return res.status(400).json({ error: 'id and item required' });

    const lists = STORE.get(storeKey) || [];
    const idx = lists.findIndex(l => l.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Watchlist not found' });

    if (act === 'add') {
      if (!lists[idx].items.includes(item)) {
        lists[idx].items.push(item);
      }
    } else if (act === 'remove') {
      lists[idx].items = lists[idx].items.filter(i => i !== item);
    }
    lists[idx].updatedAt = new Date().toISOString();
    STORE.set(storeKey, lists);
    return res.status(200).json(lists[idx]);
  }

  // ── DELETE WATCHLIST ───────────────────────────────────────
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id query param required' });

    const lists = STORE.get(storeKey) || [];
    const filtered = lists.filter(l => l.id !== id);
    STORE.set(storeKey, filtered);

    return res.status(200).json({ success: true, deleted: id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
