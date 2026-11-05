// Scarica da chiesacattolica.it antifona + primo salmo delle Lodi e il Vangelo
// della Messa, e li salva in data/AAAAMMGG.json per i prossimi giorni feriali.
// Uso: node scripts/aggiorna.mjs            (oggi + 7 giorni)
//      node scripts/aggiorna.mjs 20261104   (solo quella data)
import * as cheerio from "cheerio";
import { mkdir, writeFile, readdir, unlink } from "node:fs/promises";

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
  $("br").replaceWith("\n");
  $("p,div,h1,h2,h3,h4,h5,h6,li,tr,section,article").each((_, el) => {
    $(el).append("\n\n");
  });
  const testo = $("body").text()
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  return { righe: testo.split("\n").map((r) => r.replace(/\s+$/, "")), titolo: $("title").text() };
}

const vuota = (r) => r.trim() === "";
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
  const { righe: rr } = righe(html);
  const RE_ANT = /^\s*1\s*(ª|°)?\s*ant\.?\s*/i;
  const RE_SALMO = /^\s*(SALMO|CANTICO)\b/;

  let i = rr.findIndex((r) => RE_ANT.test(r));
  if (i < 0) throw new Error("Lodi: '1 ant.' non trovato");

  // testo antifona (può stare sulla stessa riga dell'etichetta o sotto)
  const antifona = [];
  const resto = rr[i].replace(RE_ANT, "").trim();
  if (resto) antifona.push(resto);
  i++;
  while (i < rr.length && !RE_SALMO.test(rr[i])) {
    if (!vuota(rr[i])) antifona.push(rr[i].trim());
    i++;
  }
  if (i >= rr.length || !antifona.length) throw new Error("Lodi: testo antifona o salmo non trovato");

  // intestazione "SALMO 85    Preghiera a Dio nell’afflizione"
  const [numero, ...t] = rr[i].trim().split(/\s{2,}|\t/);
  let titoloSalmo = t.join(" ").trim();
  i++;
  i = prossimaPiena(rr, i);
  if (!titoloSalmo && i < rr.length && !/[*†]/.test(rr[i]) && rr[i].trim().length < 80) {
    titoloSalmo = rr[i].trim(); i = prossimaPiena(rr, i + 1);
  }

  // epigrafe (citazione) facoltativa: righe fino a "(2 Cor 1, 3. 4)."
  let epigrafe = "";
  for (let k = i; k < Math.min(i + 6, rr.length); k++) {
    if (/[*†]/.test(rr[k])) break;
    if (/^\s*\(.*\)\.?\s*$/.test(rr[k]) || /\([^()]*\d[^()]*\)\.?\s*$/.test(rr[k])) {
      epigrafe = rr.slice(i, k + 1).filter((r) => !vuota(r)).map((r) => r.trim()).join(" ")
        .replace(/\s+(\()/, " $1");
      i = k + 1;
      break;
    }
  }

  // corpo del salmo fino al Gloria o alla ripetizione dell'antifona
  const corpo = [];
  for (; i < rr.length; i++) {
    if (RE_ANT.test(rr[i]) || /^\s*Gloria al Padre/i.test(rr[i]) || /^\s*2\s*(ª|°)?\s*ant\.?/i.test(rr[i])) break;
    corpo.push(rr[i]);
  }
  const strofe = inStrofe(corpo);
  if (!strofe.length) throw new Error("Lodi: corpo del salmo vuoto");

  return { antifona, salmo: { numero: numero.trim(), titolo: titoloSalmo, epigrafe, strofe } };
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
  for (; i < rr.length; i++) {
    if (/^\s*Parola del Signore/i.test(rr[i])) break;
    if (/^\s*(Sulle offerte|Preghiera sulle offerte|Credo)\s*$/i.test(rr[i])) break;
    corpo.push(rr[i].trim());
  }
  const paragrafi = inStrofe(corpo).map((s) => s.join("\n"));
  if (!paragrafi.length) throw new Error("Messa: testo del Vangelo vuoto");

  // "Liturgia del giorno 04 Novembre 2026 - SAN CARLO BORROMEO, VESCOVO - MEMORIA - sito ..."
  const parti = titolo.split(" - ").map((s) => s.trim());
  const celebrazione = parti.slice(1).filter((p) => !/sito ufficiale|chiesacattolica/i.test(p)).join(" – ");

  return { celebrazione, vangelo: { evangelista, riferimento, titolo: titoloVangelo, paragrafi } };
}

// ---------- programma principale ----------
async function aggiornaGiorno(d) {
  const urlMessa = `${BASE}/liturgia-del-giorno/?data-liturgia=${d}`;
  const urlLodi = `${BASE}/la-liturgia-delle-ore/?data-liturgia=${d}&ora=lodi-mattutine`;
  const lodi = estraiLodi(await scarica(urlLodi));
  await pausa(1500);
  const messa = estraiVangelo(await scarica(urlMessa));
  const out = { data: d, ...messa, ...lodi, fonti: { lodi: urlLodi, messa: urlMessa }, aggiornato: new Date().toISOString() };
  await writeFile(`data/${d}.json`, JSON.stringify(out, null, 2) + "\n");
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
