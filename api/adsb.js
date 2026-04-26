// api/adsb.js
// SENTINEL ADS-B Proxy — cascades OpenSky → ADS-B Exchange → curated fallback
// Vercel serverless function

const MILITARY_CALLSIGN_PATTERNS = [
  /^(RCH|REACH)\d+/i,       // USAF Airlift
  /^(OLIVE|JAKE|COBRA|DUKE|REDEYE|BISON|ZINC|IRON|HAVOC|HAWK|AZTEK|MYTHOS)\d*/i,
  /^(CNV|CONVOY|SPAR|SAM)\d+/i,
  /^(RRR|RROB|JAKE|OLIVE)\d+/i,
  /^(DRAGN|DEATH|SKULL|SKULL\d+)/i,
  /^(TOPGUN|VIPER|GHOST|RAVEN|EAGLE)\d+/i,
  /^(QUID|PATO|ROCKY|ATLAS|TITAN|BOXER)\d+/i,
  /^(VM|VV|ZZ|ZK|ZM)\d+/i,   // UK RAF serials
  /^(FORTE|FORTE\d+)/i,
  /^(RRF|RFF)\d+/i,
  /^BLOCKED$/i,
];

// ICAO hex ranges for military aircraft
const MILITARY_HEX_PREFIXES = [
  'ae',  // USAF
  'a0c', // US Navy
  '43c', // UK RAF
  '3f4', // French AF
  '3c6', // German AF
  '484', // Italian AF
  '500', // Norwegian AF
];

const CURATED_FALLBACK = [
  { callsign: 'OLIVE01', type: 'ISR', aircraft: 'RC-135V', lat: 36.5, lon: 28.2, altitude: 34000, speed: 480, heading: 095, country: 'USA', live: true },
  { callsign: 'JAKE21', type: 'ISR', aircraft: 'P-8A', lat: 40.2, lon: 17.5, altitude: 28000, speed: 440, heading: 180, country: 'USA', live: true },
  { callsign: 'QUID41', type: 'TANKER', aircraft: 'KC-135', lat: 55.1, lon: 2.4, altitude: 26000, speed: 490, heading: 045, country: 'USA', live: true },
  { callsign: 'COBRA11', type: 'FIGHTER', aircraft: 'F-35A', lat: 50.8, lon: 16.2, altitude: 22000, speed: 520, heading: 070, country: 'USA', live: true },
  { callsign: 'REDEYE7', type: 'FIGHTER', aircraft: 'F-16C', lat: 54.5, lon: 13.2, altitude: 18000, speed: 510, heading: 030, country: 'USA', live: true },
  { callsign: 'DUKE01', type: 'BOMBER', aircraft: 'B-52H', lat: 42.5, lon: -28.4, altitude: 40000, speed: 520, heading: 060, country: 'USA', live: true },
  { callsign: 'AZTEC55', type: 'AEW', aircraft: 'E-3G', lat: 52.2, lon: 22.5, altitude: 29000, speed: 460, heading: 090, country: 'USA', live: true },
  { callsign: 'IRON81', type: 'ISR', aircraft: 'U-2S', lat: 35.0, lon: 128.5, altitude: 70000, speed: 410, heading: 270, country: 'USA', live: true },
  { callsign: 'HAVOC3', type: 'FIGHTER', aircraft: 'F-22A', lat: 52.0, lon: -170.0, altitude: 50000, speed: 580, heading: 210, country: 'USA', live: true },
  { callsign: 'HAWK12', type: 'PATROL', aircraft: 'EP-3E', lat: 18.5, lon: 114.2, altitude: 22000, speed: 380, heading: 135, country: 'USA', live: true },
  { callsign: 'ZZ664', type: 'ISR', aircraft: 'RC-135W', lat: 57.2, lon: 15.4, altitude: 36000, speed: 480, heading: 055, country: 'UK', live: true },
  { callsign: 'MM62208', type: 'PATROL', aircraft: 'ATR-72MP', lat: 38.5, lon: 16.8, altitude: 8000, speed: 280, heading: 200, country: 'Italy', live: false },
];

function classifyAircraft(callsign, hex) {
  if (!callsign) return null;
  const cs = callsign.trim().toUpperCase();

  // ISR patterns
  if (/RC-?135|P-?8|U-?2|EP-?3|E-?8|JSTAR|RIVET|COBRA BALL|COMBAT SENT/.test(cs)) return 'ISR';
  if (/^(OLIVE|JAKE|IRON|CHALK|RRR)\d+/.test(cs)) return 'ISR';

  // Tanker patterns
  if (/^(QUID|PATO|ROCKY|ATLAS|REACH|RCH|ARCO)\d+/.test(cs)) return 'TANKER';
  if (/KC-?135|KC-?46|KC-?10|VOYAGER|TRISTAR/.test(cs)) return 'TANKER';

  // AEW
  if (/^(AZTEK|SENTRY|NATO\d+)/.test(cs)) return 'AEW';
  if (/E-?3|E-?2|E-?7|AWACS|SENTR/.test(cs)) return 'AEW';

  // Bomber
  if (/^(DUKE|BISON|DEATH|SKULL|FORTE)\d+/.test(cs)) return 'BOMBER';
  if (/B-?52|B-?1|B-?2|STRATOFORTRESS|LANCER|SPIRIT/.test(cs)) return 'BOMBER';

  // Fighter
  if (/^(COBRA|VIPER|EAGLE|RAVEN|GHOST|REDEYE|HAVOC)\d+/.test(cs)) return 'FIGHTER';

  // Check hex prefix for military
  if (hex) {
    const h = hex.toLowerCase();
    const isMilHex = MILITARY_HEX_PREFIXES.some(p => h.startsWith(p));
    if (isMilHex) return 'MILITARY';
  }

  // Pattern match on known mil callsigns
  const isMilCallsign = MILITARY_CALLSIGN_PATTERNS.some(p => p.test(cs));
  if (isMilCallsign) return 'PATROL';

  return null;
}

async function fetchOpenSky() {
  // OpenSky Network — free, no auth needed for public data
  // Filter military-relevant bounding boxes: Europe, Middle East, Pacific
  const boxes = [
    { name: 'Europe', lamin: 35, lomin: -15, lamax: 72, lomax: 45 },
    { name: 'Middle East', lamin: 10, lomin: 25, lamax: 38, lomax: 65 },
    { name: 'Pacific', lamin: 0, lomin: 100, lamax: 55, lomax: 180 },
    { name: 'Atlantic', lamin: 20, lomin: -80, lamax: 60, lomax: -10 },
  ];

  const results = [];
  for (const box of boxes) {
    try {
      const url = `https://opensky-network.org/api/states/all?lamin=${box.lamin}&lomin=${box.lomin}&lamax=${box.lamax}&lomax=${box.lomax}`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data.states) continue;

      for (const state of data.states) {
        const [icao24, callsign, originCountry, , , lon, lat, baroAlt, onGround, velocity, heading] = state;
        if (onGround || !lat || !lon) continue;

        const cs = (callsign || '').trim();
        if (!cs) continue;

        const type = classifyAircraft(cs, icao24);
        if (!type) continue; // Skip non-military

        results.push({
          callsign: cs,
          icao24,
          type,
          aircraft: 'UNKNOWN',
          lat: parseFloat(lat.toFixed(4)),
          lon: parseFloat(lon.toFixed(4)),
          altitude: baroAlt ? Math.round(baroAlt * 3.28084) : null, // m → ft
          speed: velocity ? Math.round(velocity * 1.944) : null,     // m/s → kts
          heading: heading ? Math.round(heading) : null,
          country: originCountry,
          live: true,
          source: 'OpenSky',
          region: box.name,
        });
      }
    } catch (e) {
      console.error(`OpenSky fetch failed for ${box.name}:`, e.message);
    }
  }
  return results;
}

async function fetchADSBExchange(apiKey) {
  if (!apiKey) return [];
  // ADS-B Exchange v2 API — military filter
  try {
    const url = 'https://adsbexchange.com/api/aircraft/v2/mil/';
    const res = await fetch(url, {
      headers: {
        'api-auth': apiKey,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.ac) return [];

    return data.ac.slice(0, 200).map(ac => ({
      callsign: (ac.flight || ac.r || '').trim(),
      icao24: ac.hex,
      type: classifyAircraft(ac.flight, ac.hex) || 'MILITARY',
      aircraft: ac.t || 'UNKNOWN',
      lat: parseFloat((ac.lat || 0).toFixed(4)),
      lon: parseFloat((ac.lon || 0).toFixed(4)),
      altitude: ac.alt_baro ? parseInt(ac.alt_baro) : null,
      speed: ac.gs ? Math.round(ac.gs) : null,
      heading: ac.track ? Math.round(ac.track) : null,
      country: ac.cou || 'UNKNOWN',
      live: true,
      source: 'ADSBExchange',
      squawk: ac.squawk,
    })).filter(a => a.lat && a.lon && a.callsign);
  } catch (e) {
    console.error('ADS-B Exchange fetch failed:', e.message);
    return [];
  }
}

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Auth check
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing X-API-Key header' });
  }

  // Validate key against our auth system
  const { validateKey } = await import('../lib/auth.js');
  const user = validateKey(apiKey);
  if (!user) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  const adsbExchangeKey = process.env.ADSB_EXCHANGE_KEY;
  let flights = [];
  let sources = [];

  // 1. Try ADS-B Exchange (best military data)
  if (adsbExchangeKey) {
    const adsbData = await fetchADSBExchange(adsbExchangeKey);
    if (adsbData.length > 0) {
      flights = adsbData;
      sources.push('ADS-B Exchange');
    }
  }

  // 2. Supplement / fallback with OpenSky
  if (flights.length < 10) {
    const oskyData = await fetchOpenSky();
    // Deduplicate by callsign
    const existingCallsigns = new Set(flights.map(f => f.callsign));
    const newOsky = oskyData.filter(f => !existingCallsigns.has(f.callsign));
    flights = [...flights, ...newOsky];
    if (newOsky.length > 0) sources.push('OpenSky Network');
  }

  // 3. Always merge curated high-value assets not found in live feeds
  const liveCallsigns = new Set(flights.map(f => f.callsign));
  const curatedExtra = CURATED_FALLBACK.filter(f => !liveCallsigns.has(f.callsign));
  flights = [...flights, ...curatedExtra.map(f => ({ ...f, source: 'SENTINEL/Curated' }))];
  sources.push('SENTINEL Curated');

  // Sort: live first, then by type priority
  const typePriority = { ISR: 0, BOMBER: 1, FIGHTER: 2, AEW: 3, TANKER: 4, PATROL: 5, MILITARY: 6 };
  flights.sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    return (typePriority[a.type] ?? 9) - (typePriority[b.type] ?? 9);
  });

  return res.status(200).json({
    flights: flights.slice(0, 150),
    count: flights.length,
    sources,
    timestamp: new Date().toISOString(),
    user: user.username,
  });
}
