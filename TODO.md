# TODO — UmbralXpectre

## 0. Despliegue
- **Destino: GitHub Pages** (SPA estática, `.github/workflows/deploy.yml`). Eliminados Vercel, Nitro, better-auth, PGlite y plantilla de servidor.
- Pendiente: crear repo público, Settings > Pages > Source: GitHub Actions, y push a `main`.
- Iconos PWA 192/512 son reescalados del de 180 px: sustituir por iconos nativos.
- Sin tests reales (`npm test` es placeholder); `runSelfCheck` sigue sin usarse.

## 1. Revisión de Colorado
- **(ALTA)** Ejes L y M no son independientes tras `killLuminance` (`src/lib/color/space.ts:96-100`, `:225-231`; `src/lib/color/profile.ts:618-635`). Para protán/deután colapsan en la misma línea, `elevatedCount=2`, y no se calcula ángulo de confusión. Propuesta: ejes DKL y puntuar L/M como una sola línea de confusión.
- **(MEDIA)** `ABS_CLOSE=0.02` (`src/lib/color/session.ts:35`) demasiado alto; bajar a ~0.006 con dithering o canvas `display-p3`/`rgba16float`.
- **(MEDIA)** `--color-border #3a3832` contraste 1,50:1; WCAG 1.4.11 exige 3:1. Propuesta `#6b665c`.
- **(BAJA)** `muted` sobre `stage` 3,32:1 < 4,5:1; APCA de botones accent Lc 58 (justo); comentario HPE `space.ts:21` dice D65 pero la matriz es para iluminante E.

## 2. Revisión anterior
- ~~`npm test` falla~~ → ahora es un placeholder que pasa; falta escribir tests reales.
- No hay tests de `src/lib/color`; `runSelfCheck` (`selfcheck.ts`) nunca se llama.
- Lint: `client.server.ts` eliminado (auth); queda `prefer-const` `session.ts:144` (único error) y 2 warnings de hooks (camera.tsx:232, edges.tsx:80).
- Hooks: cleanup de `videoRef` en `src/components/camera.tsx:232` (la cámara puede quedar encendida); dependencia faltante en `src/components/edges.tsx:80`.
- LUTs (3×33³) en el hilo principal → mover a Web Worker.
- Añadir simulación de referencia Machado/Viénot.
- Aviso de calibración del monitor.

## 3. Bug bordes (B)
Causas:
- Sector fijo como tope: `edges.ts:121-125`.
- `finishAtEnd` marca `toEnd` al llegar al límite del sector.
- Reinicio al pico: `edges.ts:367-370`.
- `edgeNotches` (`spectrum.ts:475`) descarta la banda si un lado no se encontró; `spectrum.ts:489` descarta >170.
- `depthCeiling` (`edges.ts:220-224`) = `max(2·floor, source·1.35)` con `'at-least'` sin seguir.
- Paso de 4° y sonda 2×control iguales dentro y fuera de la franja.

Estrategia:
- La franja del perfil solo como semilla; tope = gamut analítico (t_max por canal lineal manteniendo luminancia).
- Tres estados: encontrado / sin borde hasta gamut / pendiente.
- Bracketing geométrico ×1,5-2 + escalera 2-abajo/1-arriba o QUEST; parar con IC < ΔE00 0,5-1 o 6-8 inversiones.
- Pasos en ΔE00/OKLab; par intra-franja fijo (2-3× umbral normal) independiente del perfil; controles.
- No tirar lo avanzado; lado abierto como borde provisional.

## 4. Bug dos vías (A)
- `filterModel` (`spectrum.ts:279-293`) elige un solo `weak`/`catcher`.
- `activeBand` (`spectrum.ts:307-318`) y `edgePaint` (`spectrum.ts:547-551`): “gana el mayor”.
- `l` y `m` colapsan tras `redFacing`; con `s` elevada `blue` queda `null` y `correctColor` (`spectrum.ts:393`) no cambia nada.
- Estrategia: `weak`/`catcher` por banda; componer vías (daltonización multilínea por mínimos cuadrados conservando luminancia) o fusionar si están en la misma línea, con severidad máxima.

## 5. Riesgos
- `modelCache`/`ringCache` indexados por `axes`.
- LUT y cámara cachean por `cone:createdAt`.
- Esquema `umbral.edges.v1` → `v2` (migración).
- `motion.ts` tiene su propia lógica de franjas (`openAxes`, `pickTargets`).

## 6. Luminancia y animaciones

### Cómo se modela
- Luminancia = Y fotópica CIE/sRGB para todos: `space.ts:13` `Y_COEF = [0.2126729, 0.7151522, 0.072175]`, `space.ts:28-30` `luminance()`; `ANCHOR = 0.22` (`space.ts:11`).
- `killLuminance` (`space.ts:32-35`) resta Y a cada canal; todas las direcciones de búsqueda son “constant-Y” (`space.ts:4`, `session.ts:2`, `:151`, `:208`; `selfcheck.ts:28,94`). El perfil lo declara: `profile.ts:163` `space: "linear sRGB, constant CIE Y, anchor 0.22"`.
- **Consecuencia (ALTA):** los estímulos “isoluminantes” lo son para V(λ) del observador estándar, no para un protán. Para Lucas los rojos se ven más oscuros → (a) el test de umbrales tiene una pista de brillo que contamina los umbrales (puede separar por brillo, no por color); (b) el simulador/asistencia parten de una Y que no es la suya.

### Prueba que sí mide su luminancia: movimiento mínimo
- `motion.ts` + `components/motion.tsx`: movimiento mínimo a 1 Hz (`MOTION_HZ`, `motion.ts:5`), 8 franjas; método en `motion.ts:668`.
- Pares: `pairOf` (`motion.ts:218-224`): test = color×`gain`; referencia = gris `ANCHOR` para `control`/`extremo`, o el eje abierto vecino.
- Ganancia limitada: `MIN_GAIN 0.35`, `MAX_GAIN 3.5` (`motion.ts:11-12`); escalera seek/down/up/bisect, `TRIAL_CAP 48`.
- Solo se prueban ejes “abiertos” (`openAxes`, `motion.ts:118-125`: `threshold >= floor*1.6`, sin `upper-bound`/`closed`). Si L/M colapsaron o el rojo quedó `closed`/`upper-bound`, **el rojo afectado no se mide**.
- Guardado: `calibrator.tsx:89-91` → `attachLuminance` (`motion.ts:680`) → `profile.luminance`; `orderLuminance` (`motion.ts:589-666`) puede reetiquetar `bound` como `"unconverged"` si no hubo “quieto” ni cruce ≤ 0,12.

### Cómo lo usan los filtros
- `lumaFromProfile` (`spectrum.ts:35-52`): necesita una regla `control` convergida; **si no la hay devuelve `[]` y se ignora toda la luminancia medida**. Divide por la regla y descarta |gain−1| < 0,015. Las mediciones `unconverged` se recuperan solo si el bracket es ≤ 0,12 (`matchGain`, `:54-64`).
- `lumaGainAt` (`spectrum.ts:320-330`): solo aplica dentro de `BAND_HALF` del eje medido; fuera, gain = 1.
- Además solo actúa si `activeBand` encuentra banda (`hit`); fuera de banda no hay corrección de brillo.
- Simulador: `paintYours` `spectrum.ts:379` `y2 = y / (1 + (gain - 1) * hit.w)`; `edgePaint` `:603` igual.
- Asistencia: `steer` `spectrum.ts:436-437` `y2 = extreme ? y : y / (1 + (gain - 1) * hit.w * ASSIST_LUMA)` con `ASSIST_LUMA = 0.35` (`:200`), igual en `:572-573`. Extremo ignora el brillo.

### Posibles bugs / por qué “el rojo no baja lo suficiente”
1. **(ALTA)** Modelo base V(λ) estándar para todos; no hay curva de luminancia protán (p. ej. Y_protán ≈ más peso en M, menos en L). Propuesta: usar `fit.luminance` medido para reponderar `Y_COEF` (al menos un coeficiente R efectivo) y generar los estímulos isoluminantes para el usuario.
2. **(ALTA)** Rojo afectado excluido de la prueba de movimiento si su eje está cerrado/`upper-bound` o colapsado con M (`motion.ts:118-125`).
3. **(ALTA)** Sin regla `control` convergida → `lumaFromProfile` = `[]` y nada de brillo (`spectrum.ts:37-38`).
4. **(MEDIA)** Normalización por la regla (`gain / ruler.gain`, `spectrum.ts:44`): si la regla (color “sano” vs gris) también está sesgada por la Y protán, la pérdida del rojo se cancela en parte.
5. **(MEDIA)** `MAX_GAIN 3.5`: protanomalía severa en rojo extremo puede requerir más; el resultado queda tope/`lower` y se usa como si fuera exacto.
6. **(MEDIA)** Atenuación espacial: solo dentro de `BAND_HALF` y ponderado por `hit.w`; rojos fuera del centro de banda apenas se oscurecen.
7. **(MEDIA)** Asistencia: aplica solo el 35 % (`ASSIST_LUMA`) y en la **misma dirección que el simulador** (oscurece). Para compensar debería aclarar (multiplicar por gain) o no tocar; revisar el signo/intención.
8. **(BAJA)** `planeColor` (`spectrum.ts:334`) recorta Y a [0,1] y al cubo: ganancias altas se saturan.
9. **(BAJA)** Las LUT cachean por `cone:createdAt`; añadir `luminance` no cambia la clave → posible LUT sin brillo actualizado.

### Campos del JSON de perfil a comparar
- `fit.space`, `fit.controlAbs`, `axes[].{id, angleDeg, threshold, thresholdKind, closed, role}`.
- `luminance.{method, temporalHz, count, sampleCount, reading}`.
- `luminance.matches[].{axisId, hue, role, kind (cruce|extremo|control|edge), gain, low, high, width, span, bound (estimate|lower|unconverged), referenceHue, reversals, trials}`.
- `luminance.matches[].samples[].{gain, yRatio, sign, answer, tooBright, test, reference}`.
- Comprobar: ¿hay `control` convergido? ¿hay match del rojo (`l`/`red-end`)? ¿`gain` en 3,5 o `bound` ≠ `estimate`?

### Evidencia en los JSON de Lucas (`/workspace/adan-json/`)
- `perfil_56KB.json`: `umbral.profile.v2`, `createdAt` 2026-10-25T09:54:28Z. Sin `fit.space`. `fit.controlAbs 0.024`, `elevatedCount 1`, `severity 0.737`, `confusionAngleDeg 11.1`, `timesControl 3.8` ('at-least'). Móvil Android, gamut sRGB.
  - Ejes: `l` 11.1° T 0.0608 (estimate); `red-end` 0° T 0.0796 (estimate); `m` −156.7° T 0.0322; `control` −37° («anaranjado») T 0.024; `s` y `blue-end` cerrados (upper-bound).
  - `luminance.matches` (4, 38 muestras, todas `estimate`; ninguna `unconverged`; ninguna en el tope 0,35/3,5):
    - `l:cruce` rojizo vs **magenta**: gain 0.97 [0.94–1.00], 2 inv., 11 ensayos.
    - `m:-:cruce` cian vs **rojo extremo**: 0.87 [0.84–0.90], 2 inv., 9 ensayos.
    - `red-end:cruce` rojo extremo vs **rojizo**: 1.04 [0.98–1.10], 3 inv., 11 ensayos.
    - `control` anaranjado vs gris: 1.06 [1.00–1.12], 1 inv., 7 ensayos (convergido).
  - **No hay ningún rojo medido contra gris**: el rojo extremo (`extremo`) no se probó contra gris; los rojos solo se comparan entre sí.
- `perfil_7KB.json`: `umbral.edges.v1` (12:14:36Z), cono `l`, franja 3.1°–11.1°, profundidad 0.0618 (techo 0.0821), 16 ensayos. Sin luminancia.
- `perfil_563KB.json`: `umbral.transforms.v1`, LUT 33³; `simulate` cambia 4068 nodos. Sin luminancia.

Repetición del cálculo (código real en `/workspace/adancopy`, con tsx):
- `lumaFromProfile` → `l` 11.1°: **0.915**; `m:-` −177.4°: 0.821; `red-end` 0°: **0.981** (todos < 1, es decir «se ven igual o más claros»).
- Cambio de Y (salida/entrada): `#FF0000`, `#CC0000`, `#B22222`, `#FF4040`, `#E0301E` (θ≈0°): simulador **1.000**, asistencia **1.000** (no se toca). `#C03060` (θ 11.1°): simulador **1.093** (lo **aclara** un 9 %), asistencia 1.031.

Conclusión: se confirma que el brillo de los rojos afectados no se aplica; el simulador llega a aclararlos. Causas activas:
1. Modelo con V(λ) estándar (causa 1): activa.
2. Pares relativos rojo-contra-rojo (l↔magenta, red-end↔rojizo) + regla anaranjada (también sesgada para un protán) → la pérdida se cancela (causa 4, agravada). **Nueva (ALTA):** medir siempre `l`/`red-end` contra gris (kind `extremo`) y usar una regla verde/azul.
3. Fuera de banda/lejos del eje no se aplica (causa 6): rojos puros a 0° salen sin cambio.
4. Asistencia al 35 % y en la dirección que no compensa (causa 7): activa (1.031).
- No activas: sin regla (3), tope 3,5 (5), rojo excluido (2), `unconverged`.

### Plan
- Plan de implementación (prueba de movimiento a 7.5–15 Hz de 4 fotogramas, pesos personales w_R/w_G/w_B en profile.v3, migración, filtros): ver `/workspace/adan/PLAN-luminancia.md`.
- Prueba de parpadeo/HFP: **descartada por ahora**; solo se adapta `motion.ts`.
