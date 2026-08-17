#!/usr/bin/env node
// Collaudo dell'app Adultopia. Nessuna dipendenza: si lancia con
//   node test.js
// Blocca le regressioni sui difetti gia' pagati una volta. Se un controllo
// fallisce, il messaggio dice cosa si era rotto la prima volta e perche'
// contava, cosi' non si perde tempo a ricostruire il contesto.

const fs = require('fs');
const path = require('path');

const BASE = __dirname;
const html = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');

let passati = 0, falliti = 0;
function verifica(nome, condizione, perche) {
  if (condizione) { passati++; console.log('  ok   ' + nome); }
  else { falliti++; console.log('  ROTTO ' + nome + '\n         ' + perche); }
}
function sezione(t) { console.log('\n' + t); }

// Estrae una funzione dal sorgente bilanciando le graffe.
function fn(nome) {
  const i = html.indexOf('function ' + nome + '(');
  if (i < 0) return null;
  let d = 0, dentro = false;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (c === '{') { d++; dentro = true; }
    else if (c === '}') { d--; if (dentro && d === 0) return html.slice(i, j + 1); }
  }
  return null;
}
// Estrae un letterale (oggetto o array) e lo fa valutare al motore.
function letterale(nome, apre, chiude) {
  const i = html.indexOf('var ' + nome + '=');
  const s = html.indexOf(apre, i);
  let d = 0;
  for (let j = s; j < html.length; j++) {
    const c = html[j];
    if (c === apre) d++;
    else if (c === chiude) { d--; if (d === 0) return html.slice(s, j + 1); }
  }
}

sezione('Sintassi');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
verifica('i tre script inline compilano', (() => {
  try { script.forEach(s => new Function(s)); return script.length === 3; } catch (e) { return false; }
})(), 'un errore di sintassi qui rende l\'app una pagina bianca');
verifica('il service worker compila', (() => {
  try { new Function(fs.readFileSync(path.join(BASE, 'sw.js'), 'utf8')); return true; } catch (e) { return false; }
})(), 'senza service worker valido non c\'e\' funzionamento offline');

sezione('Lanci gratuiti');
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => store[k] = String(v), removeItem: k => delete store[k] };
global.document = { getElementById: () => null };
const ambiente = {
  MAX_FREE_ROLLS: 3, SHARE_BONUS_ROLLS: 3,
  TRIAL_STORAGE_KEY: 'adultopia_trial_rolls', SHARE_BONUS_KEY: 'adultopia_share_bonus', STREAK_KEY: 'adultopia_streak',
  paywallUnlocked: false, trialRollsUsed: 0, paywallMostrato: 0,
  // copie in memoria del conteggio, difendono dai browser che rifiutano le scritture
  _trialMemoria: null, _bonusMemoria: null
};
const nomiFn = ['trialTodayKey', 'trialGetUsed', 'trialSetUsed', 'shareBonusGet', 'shareBonusSet', 'trialMax',
  'incrementTrialRoll', 'streakGet', 'streakDayDiff', 'streakTouch', 'streakCelebrate', 'sembraItaliano',
  'sanitizeForTTS', 'cleanTextForTTS'];
const spie = html.match(/var _IT_SPIE=[^;]+;/)[0] + html.match(/var _EN_SPIE=[^;]+;/)[0];
const preambolo = Object.entries(ambiente).map(([k, v]) => 'var ' + k + '=' + JSON.stringify(v) + ';').join('') +
  'function paywallShow(){paywallMostrato++};function updateTrialBanner(){};function conteSay(){};function streakRender(){};' + spie;
const api = new Function(preambolo + nomiFn.map(fn).filter(Boolean).join('\n') +
  'return {' + nomiFn.join(',') + ', stato:function(){return {paywallMostrato:paywallMostrato}}}')();

let tirati = 0;
for (let i = 0; i < 6; i++) if (api.incrementTrialRoll()) tirati++;
verifica('i 3 lanci promessi sono 3 giocabili', tirati === 3,
  'il controllo stava dopo l\'incremento: il terzo click bruciava il lancio senza tirare i dadi (visti 3 promessi, 2 giocabili)');
verifica('il paywall compare a lanci esauriti', api.stato().paywallMostrato > 0,
  'senza invito finale il free tier non converte');
api.shareBonusSet(1);
let extra = 0;
for (let i = 0; i < 5; i++) if (api.incrementTrialRoll()) extra++;
verifica('la condivisione regala 3 lanci', extra === 3, 'e\' l\'alternativa gratuita al paywall e il motore virale');

// Memoria del browser che rifiuta le scritture: navigazione privata, spazio
// esaurito. Le letture funzionano, le scritture no.
(() => {
  const setVero = global.localStorage.setItem;
  for (const k of Object.keys(store)) delete store[k];
  const api2 = new Function(preambolo + nomiFn.map(fn).filter(Boolean).join('\n') +
    'return {incrementTrialRoll:incrementTrialRoll}')();
  global.localStorage.setItem = () => { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; };
  let consentiti = 0;
  for (let i = 0; i < 8; i++) if (api2.incrementTrialRoll()) consentiti++;
  global.localStorage.setItem = setVero;
  verifica('a memoria bloccata i lanci restano 3', consentiti === 3,
    'le scritture fallivano in silenzio, il contatore restava a zero e bastava una finestra privata per giocare gratis all\'infinito (visti ' + consentiti + ' lanci su 8)');
})();

verifica('il salvataggio fallito avvisa l\'utente', /_salvataggioRotto/.test(html) && /non sta salvando la partita/.test(html),
  'in navigazione privata la scrittura lancia e l\'errore veniva ingoiato: la coppia chiudeva l\'app convinta di poter riprendere');
verifica('l\'avviso non si ripete a ogni mossa', /if\(!_salvataggioRotto\)\{\n_salvataggioRotto=true;/.test(html),
  'si salva a ogni mossa: un avviso per volta sarebbe peggio del problema');

verifica('le richieste di sblocco hanno una scadenza', /function fetchConScadenza/.test(html) &&
  (html.match(/fetchConScadenza\('\/\.netlify\/functions\/verify/g) || []).length >= 3,
  'con la richiesta appesa il bottone restava su "..." per sempre: chi aveva gia\' pagato non capiva ne\' poteva riprovare');

verifica('nessuna chiamata di rete resta appesa per sempre', !/await fetch\('\/\.netlify/.test(html) && /return fetchConScadenza\(url/.test(html),
  'una richiesta appesa lasciava girare le rotelle o zittiva il narratore: ogni chiamata AI passa da una scadenza');

sezione('Streak');
const ymd = d => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
const ieri = new Date(); ieri.setDate(ieri.getDate() - 1);
store[ambiente.STREAK_KEY] = JSON.stringify({ last: ymd(ieri), n: 4, best: 4 });
verifica('giocando ieri e oggi la striscia sale', api.streakTouch().n === 5, 'e\' il motivo per riaprire domani');
const treGiorniFa = new Date(); treGiorniFa.setDate(treGiorniFa.getDate() - 3);
store[ambiente.STREAK_KEY] = JSON.stringify({ last: ymd(treGiorniFa), n: 9, best: 9 });
const rotta = api.streakTouch();
verifica('saltando giorni la striscia riparte ma il record resta', rotta.n === 1 && rotta.best === 9, 'il record e\' la memoria del risultato migliore');
verifica('due lanci nella stessa sera non raddoppiano', api.streakTouch().n === 1, 'conta le serate, non i lanci');

sezione('Voce');
verifica('l\'italiano passa', api.sembraItaliano('Chiudete gli occhi e respirate insieme lentamente.'), 'la guardia non deve scartare frasi buone');
verifica('l\'inglese viene scartato', !api.sembraItaliano('Slowly touch each other and feel what they have been missing.'),
  'il modello a volte ignora l\'istruzione: meglio il silenzio di una frase in inglese');
verifica('taglio latest-wins presente', /function cutSpeech\(\)\{\nspeechGen\+\+/.test(html),
  'senza contatore di generazione due frasi partivano insieme (sovrapposizione) o parlava la vecchia');
verifica('controlli dopo ogni await', (html.match(/if\(myGen!==speechGen\)return/g) || []).length >= 4,
  'fra richiesta TTS e suono ci sono tre await: senza controlli nasce la race');
verifica('la cache ha una scadenza', /_ttsDBrotto/.test(html) && /function conScadenza/.test(html),
  'IndexedDB puo\' appendersi per sempre e zittiva del tutto il narratore');
verifica('canale ambient separato', /function speakAmbient/.test(html) && /function speakQuandoLibera/.test(html),
  'i commenti tagliavano a meta\' le istruzioni della sfida');
verifica('prova leggera, sblocco completo', /paywallUnlocked \? primoLancio\.concat\(resto\) : primoLancio\.slice\(\)/.test(html),
  'si generavano 84 clip a chi ne poteva sentire una manciata');

sezione('Dizione sul testo pronunciato');
const dati = new Function(
  'var FULL_TEXT=' + letterale('FULL_TEXT', '{', '}') + ';' +
  'var DETAILS=' + letterale('DETAILS', '{', '}') + ';' +
  'var chC=' + letterale('chC', '[', ']') + ';' +
  'var csC=' + letterale('csC', '[', ']') + ';' +
  'return {FULL_TEXT,DETAILS,chC,csC}')();
const parlato = [...Object.values(dati.FULL_TEXT), ...Object.values(dati.DETAILS),
  ...dati.chC.map(c => c.txt), ...dati.csC.map(c => c.txt)].filter(t => typeof t === 'string' && t.trim());
const sporche = parlato.filter(t => {
  const n = api.cleanTextForTTS(api.sanitizeForTTS(t));
  return /[^\w\sàèéìòùÀÈÉÌÒÙ.,!?:;'-]/.test(n) || /\b[A-ZÀ-Þ]{3,}\b/.test(n) || /\b\d+\s?(min|sec)\b/i.test(n);
});
verifica(parlato.length + ' frasi pronunciate, nessuna storpiata', sporche.length === 0,
  'simboli, maiuscole e abbreviazioni venivano compitati male: ' + sporche.slice(0, 2).join(' | '));
verifica('gli articoli sono corretti', api.sanitizeForTTS('Solletico 1 minuto') === 'Solletico un minuto',
  'il narratore diceva "uno minuto" invece di "un minuto"');

sezione('Interfaccia');
const bottoni = [...html.matchAll(/<button onclick="([a-zA-Z]+)\(\)"[^>]*>([^<A-Za-z][^<]*)<\/button>/g)].map(m => ({ f: m[1], i: m[2].trim() }));
const perIcona = {};
bottoni.forEach(b => (perIcona[b.i] = perIcona[b.i] || new Set()).add(b.f));
const ambigue = Object.entries(perIcona).filter(([, s]) => s.size > 1);
verifica('nessuna icona con due significati', ambigue.length === 0,
  'la casa apriva sia l\'uscita sia le costruzioni: ' + ambigue.map(([i]) => i).join(' '));
verifica('bottoni icona etichettati', !/<button onclick="(showBuild|showTrade|showTmM|showHist|showHelp|saveAndExit|showSettings)\(\)"(?![^>]*aria-label)/.test(html),
  'senza aria-label sono invisibili a chi usa uno screen reader');
verifica('Esc non chiude i modali di gioco', /MODALI_CHIUDIBILI/.test(html) && !/MODALI_CHIUDIBILI=\[[^\]]*challengeM/.test(html),
  'chiudere la sfida con un tasto sarebbe un modo per saltare le regole');
verifica('i nomi non vengono troncati a 5', /n.length>12\?n.substring\(0,11\)/.test(html),
  'Francesca diventava "Franc" mentre la voce diceva il nome intero');
verifica('i nomi vengono ripuliti dal markup', /function nomePulito/.test(html) && /nomePulito\(E\('pn'\+i\)\.value\)/.test(html),
  'un nome come "Fra<b>" apriva un tag e sballava la struttura della pagina');
verifica('anche i salvataggi vecchi vengono ripuliti', /p\.name=nomePulito\(p\.name\)/.test(html),
  'i nomi con markup restavano salvati e tornavano a ogni partita ripresa');
verifica('il salvataggio viene validato prima di essere usato', /function salvataggioUsabile/.test(html),
  'un salvataggio incompleto apriva la schermata di gioco e poi crollava');

sezione('Timer');
verifica('il tempo si legge dall\'orologio, non dai battiti', /var scadenza=Date\.now\(\)\+sec\*1000/.test(html),
  'scalando un contatore a ogni battito, col telefono bloccato un massaggio da 3 minuti non finiva entro 10 (i browser rallentano i contatori in secondo piano)');
verifica('il timer si ricalcola al ritorno in primo piano', /visibilitychange',window\._timerRisveglio/.test(html),
  'riaccendendo lo schermo il numero mostrato restava quello vecchio fino al battito successivo');
verifica('nessun timer conta a battiti', !/if\(--rem<=0\)/.test(html),
  'ogni contatore che scala a battiti si allunga col telefono bloccato: vale per le sfide e per le mani legate');
verifica('anche il timer in sottofondo usa l\'orologio', /function startBgTimer[\s\S]{0,200}var scadenza=Date\.now\(\)/.test(html),
  'le mani legate durano 2-3 minuti mentre la partita continua: e\' il timer piu\' esposto alle pause del telefono');
(() => {
  // Orologio finto: lo schermo si blocca dopo 5s e i battiti passano a uno al minuto.
  const battiti = [];
  for (let t = 1000; t <= 5000; t += 1000) battiti.push(t);
  for (let t = 65000; t <= 600000; t += 60000) battiti.push(t);
  const scadenza = 180 * 1000;
  let fine = null;
  for (const b of battiti) { if (Math.max(0, Math.round((scadenza - b) / 1000)) <= 0) { fine = b; break; } }
  verifica('un massaggio da 3 minuti finisce entro 4 anche col telefono bloccato',
    fine !== null && fine <= 240000,
    'col vecchio conteggio non finiva entro 10 minuti simulati');
})();

sezione('Peso e prestazioni');
verifica('niente immagini base64 nell\'HTML', !/data:image\/(png|jpe?g);base64/.test(html),
  'il logo inline pesava 91 KB, il 28% del file');
verifica('la musica non si scarica all\'avvio', /id="bgMusic" loop preload="none"/.test(html),
  '7,6 MB scaricati a ogni apertura anche da chi non accende mai la musica');
verifica('HTML sotto i 260 KB', html.length < 260 * 1024, 'ora e\' ' + Math.round(html.length / 1024) + ' KB');

sezione('Sicurezza');
const proxy = fs.readFileSync(path.join(BASE, 'functions/openai.js'), 'utf8');
verifica('il proxy OpenAI controlla l\'origine', /function origineAmmessa/.test(proxy) && /statusCode: 403/.test(proxy),
  'con origine libera qualsiasi sito poteva generare AI a spese nostre');

console.log('\n' + '-'.repeat(52));
console.log(passati + ' controlli superati, ' + falliti + ' rotti');
process.exit(falliti ? 1 : 0);
