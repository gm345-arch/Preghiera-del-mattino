// Scarica da chiesacattolica.it antifona + primo salmo delle Lodi e il Vangelo
// della Messa, e li salva in data/AAAAMMGG.json per i prossimi giorni feriali.
// Uso: node scripts/aggiorna.mjs            (oggi + 7 giorni)
//      node scripts/aggiorna.mjs 20261104   (solo quella data)
import * as cheerio from "cheerio";
import { mkdir, writeFile, readFile, readdir, unlink } from "node:fs/promises";

const BASE = "https://www.chiesacattolica.it";
const GIORNI_AVANTI = 7;
const GIORNI_DA_TENERE = 30;
const UA = "Mozilla/5.0 (compatible; PreghieraDelMattino/1.0)";

// ---------- utilità ----------
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

function dataRoma(offsetGiorni = 0) {
  const d = new Date(Date.now() + offsetGiorni * 86400000);
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const g = Object.fromEntries(p.map((x) => [x.type, x.value]));
  return `${g.year}${g.month}${g.day}`;
}
function giornoSettimana(aaaammgg) {
  const d = new Date(Date.UTC(+aaaammgg.slice(0, 4), +aaaammgg.slice(4, 6) - 1, +aaaammgg.slice(6, 8)));
  return d.getUTCDay(); // 0 = domenica
}

async function scarica(url) {
  for (let tentativo = 1; tentativo <= 3; tentativo++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "it-IT,it" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (tentativo === 3) throw new Error(`Impossibile scaricare ${url}: ${e.message}`);
      await pausa(3000 * tentativo);
    }
  }
}

// HTML -> righe di testo. Riga vuota = separazione tra strofe/paragrafi.
export function righe(html) {
  const $ = cheerio.load(html);
  $("script,style,noscript,header,footer,nav,iframe,svg").remove();
  // gli a capo nel codice HTML non contano: li trasformo in spazi (gli &nbsp; dei rientri restano)
  $("body").find("*").addBack().contents().each((_, n) => {
    if (n.type === "text") n.data = n.data.replace(/[ \t\r\n]+/g, " ");
  });
  $("br").replaceWith("\n");
  // ogni blocco va su righe sue, anche se nel codice è attaccato al testo precedente
  $("p,div,h1,h2,h3,h4,h5,h6,li,tr,section,article").each((_, el) => {
    $(el).prepend("\n\n").append("\n\n");
  });
  const testo = $("body").text()
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  return { righe: testo.split("\n").map((r) => r.replace(/\s+$/, "")), titolo: $("title").text() };
}

const vuota = (r) => r.trim() === "";
const norm = (x) => x.join(" ").toLowerCase().replace(/[^a-zà-ÿ]/g, "");
function prossimaPiena(rr, i) { while (i < rr.length && vuota(rr[i])) i++; return i; }

// Converte un elenco di righe in strofe: [[riga, riga], [riga, ...]]
function inStrofe(rr) {
  const strofe = [];
  let cur = [];
  for (const r of rr) {
    if (vuota(r)) { if (cur.length) strofe.push(cur), (cur = []); }
    else cur.push(r.replace(/^\s+/, (s) => (s.length >= 2 ? "  " : "")));
  }
  if (cur.length) strofe.push(cur);
  return strofe;
}

// ---------- Lodi: 1ª antifona + primo salmo ----------
export function estraiLodi(html) {
  const rr = righe(html).righe.map((r) => r.replace(/[\u200b\u2009\u202f\ufeff]/g, " "));
  // "1 ant." anche se è attaccata ad altro testo sulla stessa riga (es. dopo l'inno in latino)
  const RE_ANT = /(?:^|[^0-9A-Za-zÀ-ÿ])1\s*[ª°]?\s*ant\.\s*/i;
  const RE_SALMO = /^\s*(SALMO|CANTICO)\b/i;

  // Punto fermo: la prima intestazione SALMO/CANTICO della pagina è il primo salmo delle Lodi
  let i = rr.findIndex((r) => RE_SALMO.test(r));
  if (i < 0) throw new Error("Lodi: nessun salmo trovato nella pagina");
  const h = i;

  // antifona = il testo tra l'etichetta "1 ant." e l'intestazione del salmo
  let antifona = [];
  for (let k = h - 1; k >= Math.max(0, h - 12); k--) {
    const m = rr[k].match(RE_ANT);
    if (m) {
      antifona = [rr[k].slice(m.index + m[0].length), ...rr.slice(k + 1, h)].map((r) => r.trim()).filter(Boolean);
      break;
    }
  }

  // intestazione "SALMO 85    Preghiera a Dio nell’afflizione"
  const [numero, ...t] = rr[i].trim().split(/\s{2,}|\t/);
  let titoloSalmo = t.join(" ").trim();
  i++;
  i = prossimaPiena(rr, i);
  if (!titoloSalmo && i < rr.length && !/[*†]/.test(rr[i]) && rr[i].trim().length < 80) {
    titoloSalmo = rr[i].trim(); i = prossimaPiena(rr, i + 1);
  }

  // epigrafe facoltativa: le righe prima del primo versetto (che ha sempre * o †),
  // se finiscono con una citazione tra parentesi: "(2 Cor 1, 3. 4)." oppure "(cfr. Cassiodoro)."
  let epigrafe = "";
  const primo = rr.findIndex((r, k) => k >= i && /[*†]/.test(r));
  if (primo > i && primo - i <= 8) {
    const pre = rr.slice(i, primo).filter((r) => !vuota(r)).map((r) => r.trim());
    if (pre.length && /\)\.?$/.test(pre[pre.length - 1])) { epigrafe = pre.join(" ").replace(/\s+(\()/, " $1"); i = primo; }
  }

  // corpo del salmo fino al Gloria o alla ripetizione dell'antifona
  const corpo = [];
  for (; i < rr.length; i++) {
    const m = rr[i].match(RE_ANT);
    if (m) { if (m.index > 0 && rr[i].slice(0, m.index).trim()) corpo.push(rr[i].slice(0, m.index)); break; }
    if (/^\s*Gloria al Padre/i.test(rr[i]) || /^\s*2\s*(ª|°)?\s*ant\.?/i.test(rr[i])) break;
    corpo.push(rr[i]);
  }
  const strofe = inStrofe(corpo);
  if (!strofe.length) throw new Error("Lodi: corpo del salmo vuoto");

  // l'antifona viene ripetuta dopo il salmo: la rileggo per il controllo incrociato
  let ripetuta = null;
  const j = rr.findIndex((r, k) => k >= i && RE_ANT.test(r));
  if (j >= 0) {
    ripetuta = [];
    const mj = rr[j].match(RE_ANT);
    const r0 = rr[j].slice(mj.index + mj[0].length).trim();
    if (r0) ripetuta.push(r0);
    for (let k = j + 1; k < rr.length; k++) {
      if (/^\s*(2\s*(ª|°)?\s*ant|SALMO|CANTICO|LETTURA BREVE)/i.test(rr[k])) break;
      if (!vuota(rr[k])) ripetuta.push(rr[k].trim());
    }
  }

  // se l'etichetta iniziale non si trova, uso l'antifona ripetuta dopo il salmo,
  // ma solo se è davvero il testo che sta subito prima dell'intestazione del salmo
  if (!antifona.length && ripetuta && ripetuta.length) {
    const prima = norm(rr.slice(Math.max(0, h - 10), h));
    if (!prima.endsWith(norm(ripetuta))) throw new Error("Lodi: antifona iniziale non trovata");
    antifona = ripetuta.slice();
  }
  if (!antifona.length) throw new Error("Lodi: antifona non trovata");

  return { antifona, salmo: { numero: numero.trim(), titolo: titoloSalmo, epigrafe, strofe }, _ripetuta: ripetuta };
}

// ---------- Messa: Vangelo ----------
export function estraiVangelo(html) {
  const { righe: rr, titolo } = righe(html);
  let i = rr.findIndex((r) => /^\s*Vangelo\s*$/i.test(r));
  if (i < 0) throw new Error("Messa: sezione 'Vangelo' non trovata");
  i = prossimaPiena(rr, i + 1);

  let titoloVangelo = "";
  if (!/secondo\s+\w+/i.test(rr[i])) { titoloVangelo = rr[i].trim(); i = prossimaPiena(rr, i + 1); }

  const intro = rr[i].trim(); // "Dal Vangelo secondo Luca"
  const m = intro.match(/secondo\s+([A-Za-zÀ-ÿ]+)/i);
  if (!m) throw new Error("Messa: evangelista non trovato");
  const evangelista = m[1];
  i = prossimaPiena(rr, i + 1);

  let riferimento = "";
  if (/^\s*[1-3]?\s?[A-Z][a-z]{1,3}\s*\d+/.test(rr[i]) && rr[i].trim().length < 40) {
    riferimento = rr[i].trim(); i++;
  }

  const corpo = [];
  let chiuso = false; // true se il Vangelo termina con "Parola del Signore"
  for (; i < rr.length; i++) {
    if (/^\s*Parola del Signore/i.test(rr[i])) { chiuso = true; break; }
    if (/^\s*(Sulle offerte|Preghiera sulle offerte|Credo)\s*$/i.test(rr[i])) break;
    corpo.push(rr[i].trim());
  }
  const paragrafi = inStrofe(corpo).map((s) => s.join("\n"));
  if (!paragrafi.length) throw new Error("Messa: testo del Vangelo vuoto");

  // "Liturgia del giorno 04 Novembre 2026 - SAN CARLO BORROMEO, VESCOVO - MEMORIA - sito ..."
  const parti = titolo.split(" - ").map((s) => s.trim());
  const celebrazione = parti.slice(1).filter((p) => !/sito ufficiale|chiesacattolica/i.test(p)).join(" – ");

  return { celebrazione, vangelo: { evangelista, riferimento, titolo: titoloVangelo, paragrafi }, _chiuso: chiuso };
}

// ---------- programma principale ----------

// Doppio controllo: restituisce l'elenco dei problemi trovati (vuoto = tutto ok)
export function controlla(lodi, messa) {
  const p = [];
  const a = lodi.antifona, s = lodi.salmo, tutte = s.strofe.flat();
  if (!/^SALMO\b/i.test(s.numero)) p.push(`il primo brano è "${s.numero}" e non un salmo`);
  if (a.length > 6 || a.join(" ").length > 400) p.push("antifona troppo lunga");
  if (a.some((r) => /\bant\.|^SALMO|^CANTICO|[*†]/i.test(r))) p.push("nell'antifona c'è testo di altre parti");
  if (lodi._ripetuta && lodi._ripetuta.length && norm(lodi._ripetuta) !== norm(a))
    p.push("l'antifona ripetuta dopo il salmo è diversa da quella iniziale");
  if (!tutte.some((r) => r.includes("*"))) p.push("il salmo non ha i versetti con l'asterisco");
  if (tutte.length < 4) p.push("salmo troppo corto");
  if (tutte.some((r) => /^(\d\s*ant\.|SALMO|CANTICO|LETTURA BREVE|Gloria al Padre)/i.test(r.trim())))
    p.push("nel salmo c'è testo di altre parti");
  const v = messa.vangelo, testo = v.paragrafi.join(" ");
  if (!["Matteo", "Marco", "Luca", "Giovanni"].includes(v.evangelista)) p.push(`evangelista strano: "${v.evangelista}"`);
  if (!messa._chiuso) p.push("non ho trovato la fine del Vangelo («Parola del Signore»)");
  if (testo.length < 200 || testo.length > 12000) p.push("lunghezza del Vangelo strana");
  if (/Acclamazione al Vangelo|Sulle offerte|Parola di Dio\.|Alleluia, alleluia/i.test(testo)) p.push("nel Vangelo c'è testo di altre parti");
  return p;
}

async function aggiornaGiorno(d) {
  const file = `data/${d}.json`;
  try {
    const vecchio = JSON.parse(await readFile(file, "utf8"));
    if (vecchio.bloccato) { console.log(`= ${d}  bloccato a mano, non lo tocco`); return; }
  } catch {}
  const urlMessa = `${BASE}/liturgia-del-giorno/?data-liturgia=${d}`;
  const urlLodi = `${BASE}/la-liturgia-delle-ore/?data-liturgia=${d}&ora=lodi-mattutine`;
  let lodi, messa;
  try {
    lodi = estraiLodi(await scarica(urlLodi));
    await pausa(1500);
    messa = estraiVangelo(await scarica(urlMessa));
    const problemi = controlla(lodi, messa);
    if (problemi.length) throw new Error("controllo fallito: " + problemi.join("; "));
  } catch (e) {
    // meglio nessun testo (il sito mostra il link alla CEI) che un testo sbagliato
    await unlink(file).catch(() => {});
    throw e;
  }
  delete lodi._ripetuta; delete messa._chiuso;
  const out = { data: d, ...messa, ...lodi, bloccato: false, fonti: { lodi: urlLodi, messa: urlMessa }, aggiornato: new Date().toISOString() };
  await writeFile(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`✓ ${d}  ${lodi.salmo.numero} · Vangelo secondo ${messa.vangelo.evangelista} ${messa.vangelo.riferimento}`);
}

async function pulisci() {
  const limite = dataRoma(-GIORNI_DA_TENERE);
  for (const f of await readdir("data")) {
    if (/^\d{8}\.json$/.test(f) && f.slice(0, 8) < limite) await unlink(`data/${f}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await mkdir("data", { recursive: true });
  const date = process.argv[2]
    ? [process.argv[2]]
    : Array.from({ length: GIORNI_AVANTI + 1 }, (_, k) => dataRoma(k));
  let errori = 0;
  for (const d of date) {
    const g = giornoSettimana(d);
    if (g === 0 || g === 6) continue; // sabato e domenica non servono
    try { await aggiornaGiorno(d); } catch (e) { errori++; console.error(`✗ ${d}: ${e.message}`); }
    await pausa(1500);
  }
  await pulisci();
  if (errori) process.exitCode = 1; // l'azione diventa rossa e GitHub ti manda una mail
}
