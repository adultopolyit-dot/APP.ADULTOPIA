# APP.ADULTOPIA

Sorgente della PWA giocabile su **app.adultopia.it** (companion digitale del gioco da tavolo Adultopia, con narratore vocale AI).

## Stato

`index.html` e' un singolo file self-contained (HTML + CSS + JS inline, niente build step). Si deploya cosi' com'e' su Netlify.

Questa versione e' stata ricostruita dal deploy live (il sorgente non era versionato in git) e include il **fix latenza del narratore**: cache audio TTS in memoria + IndexedDB, con prewarm in background delle 40 caselle per la voce attiva. Le frasi gia' generate non vengono piu' riscaricate da OpenAI a ogni occorrenza.

## Narratore

- TTS via OpenAI `tts-1` (`speed 0.95`) attraverso Netlify Function `/.netlify/functions/openai` (endpoint `audio/speech`).
- Voci italiane selezionabili. Comandi vocali via Web Speech `SpeechRecognition`.
- La Netlify Function richiede `OPENAI_API_KEY` nelle env del deploy.

## Cache audio (fix latenza)

- `cachedTTS(text, voice)`: wrapper cache-first attorno a `callOpenAITTS`. Chiave `version|voce|testo`.
- `prewarmBoardNarration(voice)`: riscalda in background le narrazioni fisse delle caselle (`FULL_TEXT`) per la voce attiva. Throttled, salta cio' che e' gia' in cache.
- Store: `_ttsMemCache` (sessione) + IndexedDB `adultopia-tts/clips` (persistente fra sessioni).
- Per invalidare la cache: bump di `TTS_CACHE_VERSION`.
