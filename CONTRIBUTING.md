# Cómo contribuir

`main` es producción (se publica en la raíz de Pages) y está protegida: solo entra por pull request.
`develop` es QA (se publica en `/qa/`).

1. Crea una rama de trabajo desde `develop`: `git switch develop && git pull && git switch -c feat/lo-que-sea`.
2. Un commit por cambio, en castellano: `tipo: descripción` (`feat`, `fix`, `docs`, `refactor`, `test`, `chore`).
3. Antes de abrir el PR, todo en verde: `npm run check`, `npm run lint`, `npm test`, `npm run build`.
4. Abre un PR de tu rama a `develop`. Al fusionarlo, QA se publica en https://4brewebs.github.io/UmbralXpectre/qa/.
5. Valida en QA (datos aparte, prefijo `qa.`; insignia con rama y commit).
6. Cuando QA esté bien, abre un PR de `develop` a `main`. Al fusionarlo se publica producción.

Nada de force-push a `main` ni a `develop`.
