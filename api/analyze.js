// api/analyze.js
// SENTINEL AI Signal Analysis — powered by Anthropic Claude
// Takes raw signal text/headlines and returns structured threat analysis

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing X-API-Key' });
  const { validateKey } = await import('../lib/auth.js');
  const user = validateKey(apiKey);
  if (!user) return res.status(403).json({ error: 'Invalid API key' });

  const { signals, mode = 'analyze' } = req.body || {};
  if (!signals || !Array.isArray(signals)) {
    return res.status(400).json({ error: 'signals array required in body' });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: 'Anthropic API not configured' });

  const MODES = {
    analyze: {
      systemPrompt: `You are SENTINEL AI, an OSINT military intelligence analyst for the Axonia platform. 
Analyze the provided signals and return a JSON object with:
- summary: 2-3 sentence executive summary of the current threat picture
- globalThreatScore: integer 0-100
- topThreats: array of up to 5 objects: { region, score, trend (up/down/stable), summary }
- keyEntities: array of up to 10 objects: { name, type (country/vessel/unit/person/location), significance }
- recommendations: array of up to 3 strings (what to watch)
- confidence: "HIGH" | "MEDIUM" | "LOW"
Return ONLY valid JSON. No markdown, no preamble.`,
      userPrompt: (sigs) => `Analyze these OSINT signals:\n\n${sigs.map((s, i) => `${i + 1}. [${s.source}] ${s.text}`).join('\n\n')}`,
    },
    classify: {
      systemPrompt: `You are SENTINEL AI, a military OSINT classifier. 
For each signal provided, return a JSON array of objects with:
- index: signal index (0-based)
- category: "MILITARY" | "MARITIME" | "CYBER" | "POLITICAL" | "ECONOMIC" | "OTHER"
- severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO"
- tags: array of up to 5 relevant tags (e.g. "ISR", "RED SEA", "RUSSIA", "DRONE STRIKE")
- threatScore: integer 0-100
- summary: one sentence
Return ONLY valid JSON array. No markdown.`,
      userPrompt: (sigs) => sigs.map((s, i) => `${i}: [${s.source}] ${s.text}`).join('\n'),
    },
    brief: {
      systemPrompt: `You are SENTINEL AI. Generate a concise intelligence brief in JSON format:
- title: string (e.g. "SENTINEL SITREP — 0600Z 25 APR 2025")
- classification: "UNCLASSIFIED // OSINT SOURCES"  
- situation: string (2-3 sentences, current global threat situation)
- keyDevelopments: array of up to 5 strings
- watchItems: array of up to 3 strings (emerging concerns)
- threatMatrix: object with keys EUROPE, MIDDLE_EAST, PACIFIC, MARITIME, CYBER — each integer 0-100
Return ONLY valid JSON.`,
      userPrompt: (sigs) => `Generate intelligence brief from these signals:\n${sigs.map(s => `• [${s.source}] ${s.text}`).join('\n')}`,
    },
  };

  const modeConfig = MODES[mode] || MODES.analyze;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: modeConfig.systemPrompt,
        messages: [{ role: 'user', content: modeConfig.userPrompt(signals) }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', err);
      return res.status(502).json({ error: 'AI analysis failed', detail: err });
    }

    const data = await response.json();
    const rawText = data.content?.[0]?.text || '{}';

    // Parse JSON response
    let parsed;
    try {
      parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    } catch {
      parsed = { raw: rawText };
    }

    return res.status(200).json({
      mode,
      result: parsed,
      model: data.model,
      usage: data.usage,
      timestamp: new Date().toISOString(),
      user: user.username,
    });
  } catch (e) {
    console.error('Analysis error:', e);
    return res.status(500).json({ error: 'Internal error', message: e.message });
  }
}
