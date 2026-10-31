# ParkWatch Quartier v2.0

Mobile PWA zur Dokumentation von Park-Verstößen (StVO/TBNR) – offline-first, Daten nur lokal (IndexedDB).
Reines Static-Hosting, kein Server, kein Build-Schritt zur Laufzeit.

## Veröffentlichen über GitHub Pages
1. github.com → **New repository** → Name `parkwatch` → **Public** → Create.
2. **Add file → Upload files** → den *Inhalt* des entpackten ZIP (nicht den Ordner selbst) hineinziehen. `index.html` muss im Repo-Root liegen; Ordner `vendor/`, `icons/`, `tools/` und die Datei `.nojekyll` mit hochladen (Versteckte Dateien ggf. anzeigen). **Commit changes**.
   (Mehr als 100 Dateien auf einmal gehen im Browser nicht – hier sind es ca. 40.)
3. **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch `main` / `/ (root)` → Save.**
4. 1–2 Minuten warten → `https://<dein-github-name>.github.io/parkwatch/`.
5. iPhone: in **Safari** öffnen → Teilen → **Zum Home-Bildschirm** → danach NUR noch diese Home-Bildschirm-App benutzen (eigener Speicher, getrennt von Safari-Tabs).
6. Beim ersten Start: Standort **Beim Verwenden der App** erlauben, Kamera erlauben. Einmal online öffnen und ~10 s warten (OCR-Dateien werden für den Offline-Betrieb nachgeladen).

## Updates einspielen
Dateien im Repo ersetzen (Add file → Upload files, gleiche Namen überschreiben). Danach in `sw.js` die Zeile `const VERSION = 'pw-v2.0.0'` hochzählen (z. B. `pw-v2.0.1`), sonst liefert der Cache die alte Version. App 2× komplett schließen und neu öffnen.

## Datenschutz-Modell
- Gespeichert werden nur **geschwärzte** Fotos (max. 1600 px). Das Originalfoto liegt ausschließlich im **Entwurf** (lokal) und wird beim Speichern/„Neu" gelöscht.
- Kennzeichen-Text nur lokal; „CSV anonym" und Druckbericht enthalten ihn nicht.
- Externe Aufrufe: OpenStreetMap-Kacheln + Nominatim (Koordinaten werden dorthin übermittelt), optional Anthropic-API (nur wenn in Einstellungen aktiviert; sendet das geschwärzte Foto).
- Repo ist öffentlich → der **Code** ist öffentlich, die **Daten** nicht (liegen nur im Browser des Geräts).

## Datensicherung
iOS kann Website-Daten löschen (Speicherdruck, „Verlauf löschen"). Regelmäßig **Bericht → Backup (JSON)** sichern.

## Tatbestandskatalog
`data.js` → `TATBESTAENDE`. `verified:true` = TBNR + Betrag gegen BKat (weg.li, Stand Quelle 22.08.2024, Beträge ab 09.11.2021) abgeglichen.
`verified:false` (aktuell: TBNR 112396) = vor Behördenkontakt prüfen. Ergänzen/Korrigieren unter https://www.weg.li/charges.
