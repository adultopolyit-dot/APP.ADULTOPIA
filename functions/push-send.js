// Manda la notifica a tutti i dispositivi iscritti. Protetta da ADMIN_TOKEN.
//
// Push SENZA payload: il protocollo cifrerebbe il testo (aes128gcm) e servirebbe
// una libreria. Qui basta la sveglia: il testo lo sceglie il service worker fra
// i suoi. Meno codice, nessuna dipendenza, stessa resa per un promemoria.
//
// Env richieste: VAPID_PUBLIC, VAPID_PRIVATE_PKCS8, ADMIN_TOKEN.

const crypto = require('crypto');

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

const b64u = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// JWT VAPID firmato ES256. La firma va in formato raw r||s (64 byte):
// col DER di default i push service rispondono 401.
function jwtVapid(aud) {
  const pk8 = process.env.VAPID_PRIVATE_PKCS8;
  if (!pk8) throw new Error('VAPID_PRIVATE_PKCS8 mancante');
  const key = crypto.createPrivateKey({
    key: Buffer.from(pk8, 'base64'), format: 'der', type: 'pkcs8'
  });
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64u(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 11 * 3600,   // sotto le 24h imposte dal protocollo
    sub: 'mailto:info@adultopia.it'
  }));
  const firma = crypto.sign('sha256', Buffer.from(header + '.' + payload), {
    key, dsaEncoding: 'ieee-p1363'
  });
  return header + '.' + payload + '.' + b64u(firma);
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  const token = (event.headers && (event.headers['x-admin-token'] || event.headers['X-Admin-Token'])) || '';
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Non autorizzato' }) };
  }

  try {
    const tutte = (await blobGet('push-subs', 'tutte')) || {};
    const ids = Object.keys(tutte);
    if (!ids.length) return { statusCode: 200, headers, body: JSON.stringify({ inviate: 0, iscritti: 0 }) };

    const pub = process.env.VAPID_PUBLIC;
    let inviate = 0, scadute = 0, errori = 0;
    const cacheJwt = {};

    for (const id of ids) {
      const sub = tutte[id];
      try {
        const aud = new URL(sub.endpoint).origin;
        if (!cacheJwt[aud]) cacheJwt[aud] = jwtVapid(aud);   // un JWT per push service, non per iscritto
        const res = await fetch(sub.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `vapid t=${cacheJwt[aud]}, k=${pub}`,
            TTL: '86400',
            'Content-Length': '0'
          }
        });
        if (res.status === 404 || res.status === 410) {
          // Iscrizione morta (app disinstallata, permesso revocato): si pota.
          delete tutte[id]; scadute++;
        } else if (res.ok) {
          inviate++;
        } else {
          errori++;
          console.warn('push', res.status, (await res.text()).substring(0, 120));
        }
      } catch (e) { errori++; }
    }

    if (scadute) await blobSet('push-subs', 'tutte', tutte);
    return { statusCode: 200, headers, body: JSON.stringify({ inviate, scadute, errori, iscritti: Object.keys(tutte).length }) };
  } catch (e) {
    console.error('push-send:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
