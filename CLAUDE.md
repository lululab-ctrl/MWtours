# MW Photo Tours · tours.mw.photography

Live site for MW Photo Tours expeditions. GitHub Pages serves the `main` branch of this repo at
https://tours.mw.photography (see `CNAME`). **Every push to `main` goes live within 1–2 minutes**, so
commit finished work straight to `main`; there is no build step.

## Layout
- `index.html`: landing page ("Which expedition are you joining?"), lists the tours from `tours.json`.
- `tours.json`: one entry per expedition: `path` (folder), `slug` (the id inside that page's
  `<script id="vault">`), `title`/`place` in `en` and `he`, `start`/`end` (YYYY-MM-DD), `cover`.
- `<tour>/index.html` (`manas-kaziranga/`, `iberian-lynx/`, `pyrenees/`): one expedition each, with its
  own `img/`, `map/`, `photos/`. The trip content is encrypted in `<script id="vault">` with the
  expedition code (PBKDF2 + AES-GCM); never try to read or guess codes, and never write a code into a file.
- `assets/members.js`: loaded by every tour. Traveler name on the code screen, Supabase sync of lists and
  progress, group photo uploads on the Field cards. When you change it, bump `?v=` in the three tour pages.
- `admin/`: Matan's admin (Supabase login): connect an expedition once with its code, see the code,
  add the traveler list (only a name on it can join: first, middle or last name, then the code; an empty
  list means no one can join; the first sign-in needs a connection, there is no code-only way in),
  shared photos. Tapping a traveler's name opens `<tour>/?as=<member or list id>` (also before they joined): that traveler's view,
  read only (`assets/viewas.js` keeps their lists in that tab so the admin's own are untouched).
- `assets/`: favicon set (same as the MWP site), logo, contour image.
- Supabase project `uiydebfzuxnxjqcnrylv`. Setup and updates are plain `.txt` files (not `.sql`).

## Rules
- Keep all three tours on the same interface: a UI change to one tour goes into the others too
  (only the vault, the map data and the photos differ between them).
- Per-traveler trip: the vault may hold `personal: [{names, patch}]`. The page applies the first entry whose
  name's words all appear in the signed-in traveler's name (from `mw-tour-<slug>-member`): the patch merges into
  the trip (objects merge, arrays/values replace, null removes, `days` keyed by day number). Manas & Kaziranga
  uses it for each traveler's return flight; everyone there starts in Delhi.
- The Flights block never shows a photo beside it (even if the vault has one); keep it that way in new tours.
- A new expedition: copy an existing tour folder as the template, give it its own vault/maps/photos,
  add it to `tours.json` with its `slug`, then Matan connects it once in `/admin`.
- Pages are Hebrew-first with English; check both and phone width before pushing.
