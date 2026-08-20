// Netlify Function - Proxy per OpenAI API
// La chiave API viene letta dalle Environment Variables di Netlify

// Questa function spende soldi veri a ogni chiamata (voce del narratore e
// sfide AI). Con Access-Control-Allow-Origin a stella qualunque sito poteva
// usarla come proxy OpenAI gratuito a spese nostre: bastava conoscere l'URL.
// Ora l'origine viene controllata e la risposta CORS torna solo a chi e' di
// casa. Chi chiama senza intestazione Origin (stesso dominio, o server a
// server) passa comunque, per non rompere nulla di legittimo.
const ORIGINI_AMMESSE = [
  'https://app.adultopia.it',
  'https://adultopia.it',
  'https://www.adultopia.it'
];
function origineAmmessa(origin) {
  if (!origin) return true;                                  // nessun Origin: non e' un browser di terze parti
  if (ORIGINI_AMMESSE.includes(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(origin)) return true;  // deploy draft
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return true;           // sviluppo locale
  return false;
}

exports.handler = async (event, context) => {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';

  if (!origineAmmessa(origin)) {
    console.warn('Origine rifiutata sul proxy OpenAI:', origin);
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Origine non autorizzata' })
    };
  }

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'Content-Type': 'application/json'
  };

  // Preflight: il browser chiede il permesso prima della POST vera.
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Solo POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // Leggi API key dalle environment variables
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'API key not configured' })
    };
  }

  try {
    const body = JSON.parse(event.body);
    const endpoint = body.endpoint || 'chat/completions';

    // Provider alternativo per la sola voce: ElevenLabs, se attivato via env.
    // TTS_PROVIDER=elevenlabs + ELEVEN_API_KEY (+ ELEVEN_VOICE_MAP JSON che
    // mappa onyx/echo/nova/shimmer a voice_id, o ELEVEN_VOICE_ID unico).
    // La risposta ha la stessa forma { audio: base64 }: il client non cambia.
    // Quando si attiva va alzata TTS_CACHE_VERSION nell'app, o le clip
    // OpenAI in cache si mescolano alle nuove.
    if (endpoint === 'audio/speech' && process.env.TTS_PROVIDER === 'elevenlabs' && process.env.ELEVEN_API_KEY) {
      let voiceId = process.env.ELEVEN_VOICE_ID || '';
      try {
        const mappa = JSON.parse(process.env.ELEVEN_VOICE_MAP || '{}');
        if (mappa[body.voice]) voiceId = mappa[body.voice];
      } catch (e) { /* mappa malformata: resta il voice_id unico */ }
      if (voiceId) {
        const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId + '?output_format=mp3_44100_128', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'xi-api-key': process.env.ELEVEN_API_KEY },
          body: JSON.stringify({
            text: body.input,
            model_id: process.env.ELEVEN_MODEL || 'eleven_flash_v2_5',
            language_code: 'it'
          })
        });
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          return { statusCode: 200, headers, body: JSON.stringify({ audio: buf.toString('base64') }) };
        }
        // ElevenLabs giu' o crediti finiti: si continua con OpenAI qui sotto,
        // il narratore non deve mai restare muto.
        console.warn('ElevenLabs KO (' + r.status + '), fallback OpenAI');
      }
    }
    
    // Determina l'URL OpenAI
    let url = `https://api.openai.com/v1/${endpoint}`;
    
    // Rimuovi endpoint dal body prima di inoltrare
    delete body.endpoint;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    // Per TTS: controlla response.ok PRIMA di trattarlo come audio.
    // Se OpenAI ritorna errore (quota esaurita, key invalida, rate limit),
    // il body e' JSON con { error: { message, type, code } }: dobbiamo
    // propagarlo al client cosi' il narratore sa che c'e' un problema,
    // invece di ricevere un "audio" MP3-non-valido che fallisce in silenzio.
    if (endpoint === 'audio/speech') {
      if (!response.ok) {
        // Leggi come testo per parsare l'errore JSON di OpenAI
        const errText = await response.text();
        let errJson;
        try { errJson = JSON.parse(errText); } catch {}
        return {
          statusCode: response.status,
          headers,
          body: JSON.stringify({
            error: errJson?.error?.message || `OpenAI TTS error ${response.status}`,
            code: errJson?.error?.code || 'tts_error'
          })
        };
      }
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ audio: base64 })
      };
    }

    // Per altri endpoint, ritorna JSON
    const data = await response.json();
    return {
      statusCode: response.status,
      headers,
      body: JSON.stringify(data)
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
