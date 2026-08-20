// Salva l'iscrizione alle notifiche di un dispositivo.
// Niente dipendenze npm: Netlify Blobs via HTTP, come remove-device.js.
//
// Tutte le iscrizioni stanno in UNA sola chiave ('tutte'): con i volumi di
// Adultopia e' una lettura e una scrittura per salvataggio, invece di una
// lettura in massa a ogni invio. Vedi la regola sui crediti Netlify.

function getBlobsConfig() {
  const ctx = process.env.NETLIFY_BLOBS_CONTEXT;
  if (!ctx) return null;
  try { return JSON.parse(Buffer.from(ctx, 'base64').toString()); } catch (e) { return null; }
}

async function blobGet(store, key) {
  const config = getBlobsConfig();
  if (!config) return null;
  const url = `${config.apiURL}/${config.siteID}/${store}/${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${config.token}` } });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

async function blobSet(store, key, data) {
  const config = getBlobsConfig();
  if (!config) return false;
  const url = `${config.apiURL}/${config.siteID}/${store}/${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.ok;
  } catch (e) { return false; }
}

const ORIGINI_AMMESSE = ['https://app.adultopia.it', 'https://adultopia.it', 'https://www.adultopia.it'];
function origineAmmessa(origin) {
  if (!origin) return true;
  if (ORIGINI_AMMESSE.includes(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(origin)) return true;
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return true;
  return false;
}

// Chiave stabile per dispositivo: l'endpoint e' lungo e contiene caratteri
// scomodi, l'hash no. Serve anche a non riscrivere due volte lo stesso.
function idDa(endpoint) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(endpoint).digest('hex').substring(0, 24);
}

exports.handler = async (event) => {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  if (!origineAmmessa(origin)) {
    return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Origine non autorizzata' }) };
  }
  const headers = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const sub = body.subscription;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Iscrizione incompleta' }) };
    }
    // Endpoint fasullo: si accettano solo i push service veri dei browser.
    if (!/^https:\/\/[a-z0-9.-]+\.(googleapis\.com|mozilla\.com|windows\.com|apple\.com)\//i.test(sub.endpoint)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Endpoint non riconosciuto' }) };
    }

    const tutte = (await blobGet('push-subs', 'tutte')) || {};
    const id = idDa(sub.endpoint);
    const nuova = !tutte[id];
    tutte[id] = {
      endpoint: sub.endpoint,
      keys: sub.keys,
      salvata: new Date().toISOString(),
      lingua: (body.lingua || 'it').substring(0, 5)
    };
    await blobSet('push-subs', 'tutte', tutte);

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, nuova, totale: Object.keys(tutte).length }) };
  } catch (e) {
    console.error('push-save:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Errore salvataggio' }) };
  }
};
