# Preghiera del mattino

Sito che mostra ogni giorno feriale lo schema della preghiera del mattino, con antifona e primo salmo delle Lodi e Vangelo della Messa presi da chiesacattolica.it.

## Come funziona
- `.github/workflows/aggiorna.yml` gira ogni notte (circa alle 3–4 italiane): scarica i testi di oggi e dei 7 giorni successivi (solo lun–ven) e li salva in `data/AAAAMMGG.json`. Tiene gli ultimi 30 giorni.
- `index.html` legge il file del giorno e la preghiera finale da `preghiere.json`.
- Preghiera finale (`preghiere.json`): lunedì 1, martedì 2, mercoledì 3, giovedì 4; il venerdì a turno 5 → 6 → 7 (a partire da venerdì 6 novembre 2026, modificabile con `venerdi_inizio`).
- Sabato e domenica la pagina mostra solo un avviso.
- Si può aprire un giorno preciso con `?data=20261104`.

## Messa online (GitHub Pages)
1. Settings → Pages → Source: *Deploy from a branch* → `main` / root.
2. Actions → *Aggiorna liturgia* → *Run workflow* per il primo scaricamento.
3. Se un giorno il sito CEI cambia impaginazione, l'azione diventa rossa e GitHub manda una mail; nel frattempo la pagina mostra il link diretto ai testi.
