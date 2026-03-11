# Šah 3D (by Alan Catovic)

3D šah igra u browseru — igraš bijeli protiv Stockfish AI.  
Radi na telefonu, tabletu i računaru. Bez instalacije.

---

## 🚀 Pokretanje lokalno

```
node server.mjs
```
Otvori: `http://127.0.0.1:4173`

---

## 🌐 Objava na GitHub (za dijeljenje sa djedom)

### Korak 1 — Napravi GitHub nalog
Idi na https://github.com i registruj se (besplatno).

### Korak 2 — Novi repozitorij
- Klikni zeleno dugme **"New"** (ili "+" u gornjem desnom uglu → New repository)
- **Repository name**: `sah` (ili bilo koje ime bez razmaka)
- Ostavi sve ostalo kao jeste
- Klikni **"Create repository"**

### Korak 3 — Upload fajlova
Na stranici repozitorija klikni:
**"uploading an existing file"**

Prevuci SVE fajlove iz foldera `chess-3d` u browser prozor.  
⚠️ **Moraš uploadati i foldere** — GitHub ne prihvata prazne foldere, ali ako prevučeš cijeli sadržaj foldera `chess-3d`, sve će raditi.

Alternativno, uploaduj fajl po fajl ovim redoslijedom:
1. `index.html`
2. `app.js`
3. `styles.css`
4. `stockfish-worker.js`
5. `service-worker.js`
6. `manifest.json`
7. `assets/chess-set.glb`
8. `assets/icon-192.png`
9. `assets/icon-512.png`
10. `assets/music/songs.json`
11. `assets/music/safet-isovic.mp3` ← i sve ostale MP3 pjesme

Klikni **"Commit changes"** (zeleno dugme dole).

### Korak 4 — Uključi GitHub Pages
- Idi na **Settings** (na stranici repozitorija, gore desno)
- U lijevom meniju klikni **"Pages"**
- Pod **"Source"** odaberi: **Deploy from a branch**
- Pod **"Branch"** odaberi: **main** i **/ (root)**
- Klikni **Save**

### Korak 5 — Pričekaj 2-3 minute
GitHub će ti pokazati link oblika:
```
https://TVOJE_IME.github.io/sah/
```
Taj link pošalji dedi! Otvara se direktno u mobilnom browseru.

---

## 🎵 Dodavanje novih pjesama

1. Uploadaj MP3 fajl u `assets/music/`
2. Uredi `assets/music/songs.json` i dodaj red:

```json
[
  { "name": "Safet Isović", "file": "assets/music/safet-isovic.mp3" },
  { "name": "Naziv Pjesme", "file": "assets/music/naziv-fajla.mp3" }
]
```

---

## 🎮 Kako igrati

- **Klikni** bijelu figuru → zelene točkice pokazuju gdje može ići
- **Klikni** željeno polje → figura se pomjera
- Klikni ponovo figuru za poništavanje odabira

## Težine
| Nivo | Opis |
|------|------|
| 🟢 Lako | Dobar za početnike |
| 🟡 Srednje | Izazovan (default) |
| 🔴 Teško | Pun Stockfish — jako teško |

---

## Struktura projekta
```
chess-3d/
├── index.html
├── app.js
├── styles.css
├── server.mjs          ← samo za lokalno pokretanje
├── stockfish-worker.js
├── service-worker.js
├── manifest.json
└── assets/
    ├── chess-set.glb
    ├── icon-192.png
    ├── icon-512.png
    └── music/
        ├── songs.json  ← lista pjesama (uredi ovo!)
        └── *.mp3
```
