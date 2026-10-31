styles.css neu erzeugen (nur nötig, wenn Tailwind-Klassen in index.html/app.js/data.js geändert werden):
  npm i -D tailwindcss@3.4.17
  npx tailwindcss -c tools/tailwind.config.js -i tools/styles.src.css -o styles.css --minify
(Pfade in tools/tailwind.config.js ggf. von ../site/ auf ./ ändern.)
