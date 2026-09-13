# Don't Fall Arena

Olti burchakli plitalardan qurilgan arena. Plitalar ostingizda yorilib, qulab tushadi; arena
halqasi borgan sari torayadi. Vazifa oddiy: **oxirgi bo'lib qolmang — oxirgi bo'lib qoling.**

Hech qanday build, hech qanday kutubxona — faqat vanilla JavaScript (ES modullari), Canvas 2D va
WebAudio. Barcha grafika va ovoz kod ichida sintez qilinadi.

## Ishga tushirish

```bash
npm start          # node tools/serve.mjs  →  http://localhost:8080
# onlayn rejim uchun relay server (python, bog'liqliksiz):
python3 server/main.py            # ws://localhost:8081/ws
# yoki istalgan statik server bilan:
python3 -m http.server 8080
```

Brauzerda `index.html` ni oching. Telefonda ham ishlaydi (chap barmoq — joyistik, o'ng — sakrash).

`tools/serve.mjs` ishlatilsa, `/ws` so'rovlari avtomatik relay serverga tunnel qilinadi —
shunda onlayn rejim same-origin ishlaydi (relay yo'q bo'lsa brauzer `8081` portini o'zi sinab ko'radi).

## O'yin qoidalari

- **Harakat** — plita ustida turganingizda u asta-sekin bosim ostida yoriladi (`CRACKED` → `FALLING` → `GONE`).
- **Sakrash (dash)** — qisqa "parvoz": 1–2 teshikdan o'tib ketadi, havoda qulay boshlagan bo'lsangiz ham
  qutqarib qoladi. Qayta zaryad ~1.75 s.
- **Urish** — dash paytida raqibga tegsangiz, uni kuchli otadi; jar ohangida urib tushirsangiz,
  o'lim sizga yoziladi.
- **Halqa torayadi** — har ~9 soniyada tashqi halqa qulaydi; markazga intiling.
- **Zilzila** — arena o'zi ham tasodifiy plitalarni yoradi, vaqt o'tgani sari kuchayadi.
- **Raund** — bitta o'yinchi qolguncha yoki vaqt tugaguncha. Match — tanlangan raund g'alabasigacha.

### Plita turlari

| Turi | Rangi | Xususiyati |
| --- | --- | --- |
| Oddiy | yashil | o'rtacha chidamli |
| Po'lat | kulrang | ikki barobar chidamli — xavfsiz orol |
| Muz | moviy-to'q | silliq: tormoz deyarli yo'q |
| Mo'rt | to'q sariq | bosishingiz bilan qulaydi |

### Kuchlar (plitalarda paydo bo'ladi)

- **✷ Zilzila** — atrofdagi plitalarni darhol yoradi.
- **❄ Muzlatish** — 5 s oyoq ostingizdagi plitalar butun qoladi, qo'shnilar tiklanadi.
- **⚡ Chaqqonlik** — 6 s tezlik va tezroq dash.
- **✦ Arvoh** — 5 s yorilgan va qulayotgan plitalarda yura olasiz.
- **⬢ Titan** — 6 s urilishda raqibni ikki barobar uzoqqa otadi, o'zingiz og'ir.

## Lobbi va meta-qatlam

Menyu referens-uslubda qurilgan: to'q-ko'k fon, statistika "pill"lari, rank nishoni, mavsum
baneri, yashil/ko'k katta tugmalar va rangli karta-to'r.

- **Profil** (`localStorage`): XP, RP, rank (Bronza → Afsona), daraja, o'yinlar/vaqt statistikasi.
- **Mavsum**: `Mavsum 1 • SURVIVAL` — tugash sanasi `src/config.js` da; lobbi kunlar sonini ko'rsatadi.
- **Kunlik**: har kuni +100 XP bonus va 3 ta kunlik topshiriq (omon qolish / urib tushirish / kuch).
- **Vazifalar**: umrbod achievement'lar, progress-bar va XP mukofoti bilan.
- **Reyting**: lokal leaderboard (siz + raqiblar ghostlari).
- **Kollektsiya**: daraja ochiladigan arena mavzulari (plitalar rangi o'zgaradi).
- **Skinlar**: daraja ochiladigan o'yinchi ranglari.
- **Til**: pastdagi `UZ` pilli orqali UZ ⇄ EN (butun lobbi, HUD va natijalar tarjima qilinadi).

Har bir matchdan keyin XP/RP hisoblanadi: g'alaba +120 XP, raund g'alabasi +40, ochko va urib
tushirishlar ustiga. Daraja oshganda yangi mavzu/skinlar ochiladi va toast chiqadi.

## Onlayn o'yin (relay server)

Lobbidagi **ONLAYN O'YNASH** tugmasi onlayn bo'limini ochadi: relay serverga ulanish,
xona yaratish (4 belgili kod), kod orqali qo'shilish, ochiq xonalar ro'yxati,
8 o'rinli roster, chat va host uchun **O'YINNI BOSHLASH**.

Relay server **Python** da, 4 ta faylda yozilgan va uchinchi taraflar bog'liqligini
talab qilmaydi (faqat standart kutubxona: `asyncio`, `sqlite3`, `hashlib`…):

```
server/
  protocol.py  — xabar turlari, validatsiya, xona kodlari, limitlar
  rooms.py     — Player/Room/RoomManager: xonalar, slotlar, relay marshruti
  store.py     — sqlite statistika: o'yinlar, g'alabalar, leaderboard
  main.py      — asyncio server: WebSocket (RFC6455, qo'lda) + HTTP /health /rooms /stats
```

Model: **host brauzeri simulyatsiyani o'zi yuritadi** va holatni relay orqali oqizadi
(plitalar delta'si + 15 Hz snapshot), mehmonlar esa faqat input yuboradi va snapshot'lardan
interpolyatsiya qiladi. Server o'yin qoidalarini bilmaydi — faqat xonalar, relay va statistika.
Natijalar `store.py` ga yoziladi (`/stats` leaderboard).

```bash
python3 server/main.py --host 0.0.0.0 --port 8081   # ARENA_PORT env ham ishlaydi
python3 tests/test_server.py                        # relay protokol testi
node tools/check-online.mjs 8080                    # tunnel + relay end-to-end
```

Mehmon manzilini qo'lda berish: `?server=wss://...` yoki `localStorage['arena.server']`.

## Animatsiyalar

- har raund boshida plitalar halqa bo'ylab **paydo bo'ladi** (easeOutBack, ring-stagger)
- o'yinchilar tezlik bo'yicha **squash & stretch**; qulashda aylanib cho'kish
- tushish changi (dust), kuch olganda **yorug'lik nuri (beam)** + uchqunlar
- match tugaganda **konfetti**; bump/fell paytida qisqa **hit-stop**
- halqa qulaganda kamera **zoom-punch** + ekran silkinishi
- lobbi: kartalar va pill'lar pog'onali kirish animatsiyasi, tugmalarda shine sweep

## Boshqaruv

| Harakat | 1-o'yinchi | 2-o'yinchi |
| --- | --- | --- |
| Yurish | `WASD` yoki `↑←↓→` | `↑←↓→` |
| Sakrash | `SPACE` / `SHIFT` / `F` | `ENTER` / o'ng `SHIFT` |
| Pauza | `ESC` yoki `P` | — |
| Ovoz | `M` | — |
| Qayta boshlash | `R` | — |

Menyudan raqiblar soni (1–5), qiyinlik (Oson → Dahshat), arena hajmi va g'alabagacha raundlar
sonini tanlash mumkin. Sozlamalar `localStorage` da saqlanadi.

## Arxitektura

Simulyatsiya va ko'rinish to'liq ajratilgan: mantiq modullari DOM ga tegmaydi, shuning uchun
ular brauzersiz (headless) test qilinadi.

```
src/
  config.js   — barcha balans konstantalari (materiallar, kuchlar, taymerlar)
  rng.js      — seed'li PRNG + easing funksiyalar
  hex.js      — olti burchakli koordinata matematikasi (axial ↔ pixel)
  arena.js    — plitalar hayoti: bosim, yorilish, qulash, halqa torayishi, zilzila
  player.js   — fizika: harakat, ishqalanish, dash, qulash/qutulish, to'qnashuvlar
  bots.js     — AI: xavfsizlik bahosi, nishon tanlash, panika va dash qarorlari
  match.js    — raund/match state machine, ochko hisobi, kuchlar spawn'i
  render.js   — Canvas 2D: 2.5D plitalar, zarrachalar, ekran silkinishi, kamera
  audio.js    — WebAudio sintezatori (SFX + ambient drone)
  input.js    — klaviatura + sensor joyistik
  profile.js  — localStorage profil: XP/RP, rank, kunlik topshiriqlar, achievement'lar
  ui.js       — DOM: ko'p ekranli lobbi (i18n UZ/EN), HUD, natija ekranlari
  net.js      — onlayn klient: WebSocket, host snapshot oqimi, guest interpolyatsiya
  main.js     — boot, o'yin sikli (fixed timestep), hodisalar marshruti
server/
  protocol.py — onlayn protokol: xabar turlari, validatsiya, limitlar
  rooms.py    — xonalar/slotlar/relay marshruti (server mantiqi)
  store.py    — sqlite: o'yinchilar statistikasi va leaderboard
  main.py     — asyncio WS+HTTP relay server (bog'liqliksuz)
tools/
  serve.mjs   — bog'liqliksuz statik server + /ws tunneli relay'ga
  check-online.mjs — tunnel + relay end-to-end tekshiruvi
tests/
  sim.mjs     — headless simulyatsiya testlari (butun match'lar o'ynaladi)
  dom.mjs     — jsdom'da to'liq UI sikli (menyu → raund → match → menyu)
  net.mjs     — host/guest snapshot-determinizm testi (socketsiz)
  test_server.py — python relay server protokol testi
  shot.mjs    — renderni PNG ga olib, ko'z bilan tekshirish uchun (dev)
```

Hodisalar oqimi: `match.update()` → `match.drainEvents()` → `main.js` uni `render.js`
(zarrachalar/silkinish), `audio.js` (SFX) va `ui.js` (killfeed, toast) ga tarqatadi.

## Testlar

```bash
npm test                 # headless simulyatsiya: hex matematika + butun match'lar
npm run test:dom         # jsdom: menyu, HUD, pauza, natija ekranlari, onlayn ekran
npm run test:net         # host/guest relay determinizmi (socketsiz)
npm run test:shot        # tests/shots/*.png — render skrinshotlari (@napi-rs/canvas kerak)
npm run test:online      # serve.mjs /ws tunneli + python relay (serverlar ishlab turganda)
python3 tests/test_server.py   # python relay protokol testi
```

`npm test` hech qanday o'rnatishni talab qilmaydi.

## Litsenziya

Bu loyiha o'yin-maydoni: istalgan maqsadda erkin foydalaning.
