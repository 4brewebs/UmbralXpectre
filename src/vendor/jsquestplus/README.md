# jsQuestPlus (vendorizado)

- Origen: npm `jsquest-plus` 2.1.0, fichero `dist/jsQuestPlus.module.js` (ESM con numeric.js incluido).
- Repo: https://github.com/kurokida/jsQuestPlus (HEAD `92a1d2191ab06373d96c163443b435e1de8b76e1` el 25/10/2026).
- Licencia: MIT © 2021 Daiichiro Kuroki (`LICENSE`). numeric.js: MIT, Sébastien Loisel.
- Cambios locales: quitado `console.log('jsQuestPlus Version 2.0.0')` al importar; `alert(...)` → `throw new Error(...)`; quitados `console.error`; cabecera `@ts-nocheck`. Nada más.
- Se carga perezosamente con `import()` desde `src/lib/color/questplus.ts`, solo en pruebas con QUEST+.
- Referencias: Watson (2017), *J. Vision* 17(3):10, doi:10.1167/17.3.10. Kuroki & Pronk (2022), *Behav. Res. Methods*, doi:10.3758/s13428-022-01948-8.
- No se usa ni se copia código de `questplus` (Python, GPL-3.0).
