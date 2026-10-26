# TODO — UmbralXpectre

Revisado el 25/10/2026 contra el código y `git log` (`main` = `origin/main`). **No hacer push sin el OK de Lucas**:
cada push a `main` despliega en Pages.

## 00. URGENTE
- [ ] **Persistencia** (no implementado aún): migrar localStorage a IndexedDB con `idb` (ISC, Jake Archibald) + `navigator.storage.persist()` + exportar/importar JSON + migración automática desde localStorage, con prefijo por entorno (`qa.`). Sync entre dispositivos opcional más adelante; descartados Firebase (datos de salud RGPD, cuentas, backend) y FalkorDB (servidor).

## 01. Tarea futura (aparte)
- [x] ~~Esquina azul saturada (violeta/azul)~~ y ~~escalón cian→menta al 50 %~~: ya no son limitaciones. Con el principio «solo modificar lo que sabemos y podemos medir que el usuario falla» (26/10), Asistencia/Extremo solo tocan la región medida (sector entre bordes medidos × escala de fallo medida; sin bordes, ±10° provisional). Esas zonas quedan fuera, con cambio 0.
- [x] Pares dentro de la región: criterio nuevo en la simulación del perfil (≥ 1,5× / 2× el control en ΔE00, 2,78 → 4,17 / 5,57): cumple con bordes SIMULADOS y con los reales vacíos (Extremo con ganancia 2,4 y cota 1,1).
- [x] Extremo: transición de sector a 10° (Asistencia 6°). Anillo de croma baja: 1,34 ΔE00/1° (SIMULADOS, en 8,75° dentro del sector, no en la transición) y 0,93 (reales). Con 12° sale igual (1,34), así que se queda en 10°. Test: ≤ 1,5 en Extremo (Colorado acepta 1,0–1,5) y ≤ 1 en Asistencia/Mapa.
- [ ] **Mapa intermedio «en revisión»** (etiqueta en la UI; la retira Colorado). Con los bordes reales, el par l / gris baja de 6,18 a 0,24 en la simulación del perfil. Causa: no es un fallo del ángulo (θ 11,1°, w = 1, gain 0,7, sin cruce de 0°) ni del signo de S (el gris no se mueve). El mapa gira el color 30°·0,7 = 21° hasta θ ≈ 25°, y la simulación del perfil («Tu visión») no es monótona en el tono: a r 0,04 da 6,6 (0°), 3,3 (5°), 5,3 (10°), 0,9 (15°), 1,3 (20°), 0,3 (25°), 6,2 (30°) frente al gris. Con 30° completos (bordes SIMULADOS, gain 1) cae en 33° y sale bien (7,81). No se arregla: depende de esa simulación con escalones, que además conviene revisar.

- [ ] **Revisión aparte, no urgente: simulación «Tu visión» con valle no fisiológico.** El valle (≈15–25°, ΔE00 0,3–1,3 frente a 6,6 en 0° y 6,2 en 30°) es un artefacto de la matriz de atenuación interpolando entre pocos ejes (red-end 0°, l 11°). La simulación debe ser monótona y suave entre ejes medidos: interpolar la pérdida en ángulo, sin extrapolar nunca con la matriz.

- [ ] **Barra de Asistencia idéntica al original.** El barrido es a saturación plena y la región medida es de croma baja, así que la barra no cambia y parece que la asistencia no hace nada. Próxima ronda: pintar las barras a un croma dentro de la escala medida, o añadir una segunda fila de croma baja.

- [ ] **T de una línea en la métrica (26/10):** la métrica de discriminación y la exigencia adaptativa usan el mayor de T(θ) y T(θ+180°) (`lineT` en `spectrum.ts`). La asimetría se mantiene hasta que C1 (pares que no son isoluminantes para Lucas) diga otra cosa.
- [x] **Adaptativa, plan B (26/10):** pared de gamut proporcional al movimiento del canal (`GAMUT_SOFT_MOVE` 3), línea de confusión mezclada por pesos (antes la de más peso: bug), pareja reflejada con fundido en el borde del gamut (`mateFade` 0,03). El paso de croma continuo existe (`ADAPTIVE.chromaStep`) pero está apagado: subía el escalón a 2,1–2,5 ΔE00/°. Escalón con bordes 13:33/13:36: Perfil 1,16 / 1,08, Bordes 1,33 / 1,48 (asistencia / extremo); el ≤ 1 en asistencia no se alcanza. Lámina l: 1,42 (Perfil) / 1,32 (Bordes), «limitado por tope», figura ≥ 3 ΔE00.
- [x] **Lámina m en modo Bordes ≈ 0,85 en Asistencia (aceptado, 26/10):** consecuencia de «tocar solo lo medido»: con los bordes 13:33/13:36 el fondo cae fuera de la región medida y casi no se mueve (0,8 ΔE00). Perfil da 1,21. Tests: «lámina m en Bordes» y C (cada par llega o queda «limitado por tope»).

## 0. Hecho (verificado en el código)
- [x] **Despliegue en GitHub Pages**, en vivo en https://4brewebs.github.io/UmbralXpectre/. El repo `4brewebs/UmbralXpectre` es público y Pages se publica con Actions (`.github/workflows/deploy.yml`). Se eliminaron Vercel, Nitro, better-auth, PGlite y la plantilla de servidor.
- [x] **Migración de React a Svelte 5** (runes, sin SvelteKit); paridad visual comprobada con Playwright (`/workspace/parity`).
- [x] Lint: `prefer-const` en `nextRand` (`session.ts`, 7a243ae). Ahora lint da 0 problemas.
- [x] `npm test` = `runSelfCheck` + `tests/*.test.ts` (node:test, 84 tests en 18 archivos).
- [x] **Luminancia, fase 1** tras `?motion=v2`:
  - `cones.ts` (Smith-Pokorny + Machado), `lumweights.ts`, perfil `umbral.profile.v3` (lee v2/v1);
  - `motion2.ts` + `MotionTestV2.svelte`.
- [x] Ajustes de seguridad v2:
  - colores a 0,65 del borde;
  - Michelson ≤ 22 % con cotas «al menos»;
  - prior de severidad 0,6;
  - ≥ 5 catch por bloque.
- [x] Botón **Quieto** (respuesta informativa; bloque poco fiable si pasa del 60 %), aviso de distancia 40/60 cm y tamaño en grados:
  - heurística de dispositivo, 1 c/°;
  - parche de 4° × 2°, aprobado por Lucas;
  - sin calibración del usuario.
- [x] Pantalla de movimiento v2: retícula acromática quitable (`MotionReticle.svelte`) y háptica de 8 ms solo en movimiento v2.
- [x] Fondo constante en movimiento v2: Y = 0,1475, la más baja alcanzable por todos los ensayos.
- [x] **jsQuestPlus vendorizado** (`src/jsQuestPlus.js`). No se copia el questplus de Python (GPL).
- [x] **QUEST+ tras `?qp=1`** en movimiento v2, bordes y calibración. Parámetros de Colorado en `QP_MOTION`, `QP_EDGES` y `QP_CALIB`:
  - movimiento: δ 0,02/0,04/0,08, β fijo (±10 %), prior log-normal σ 0,25, parada ln 1,10 o 30 ensayos;
  - bordes: «ninguno» como fallo informativo (`detect3`), parada IC < 1 ΔE00 (respaldo 8°), tope de 45 por lado;
  - calibración sí/no: γ igual a las falsas alarmas en catch, acotada a [0,02, 0,3] con ≥ 5 catch; prior 0,1–10 ΔE00; parada IC de ln α < ln 1,5 o 36 por eje; tope de 80 por sesión.
- [x] **CIEDE2000** (`deltaE.ts`), validado con los 34 pares de Sharma et al. (2005).
- [x] Bordes con QUEST+: catch obvios (tono +90° y +25 % de Y), 1 cada 6 y ≥ 2 por ronda. La fiabilidad se agrega en la sesión: «indeterminada» con < 5 catch, no fiable con > 25 % de «ninguno».
- [x] Calibración QUEST+: reanudación en otra sesión con el posterior por eje (localStorage `umbral.calib.qp.resume` y `calibrationResume` en el perfil).
- [x] **Historial completo de sesiones** en el perfil (`history`, `umbral.history.v1`, columnas si es grande).
- [x] **Ronda del 25/10 noche (aprobada por Lucas y Colorado; local, sin push):**
  - arcoíris en Bordes: la asistencia nunca va a un lado abierto (`loOpen`/`hiOpen`); con los dos abiertos usa la del perfil; profundidad en el pico con un solo borde; `tInner = max(depth, umbral de origen, edgeScale)`;
  - bordes: la búsqueda pasa del sector hasta el límite del gamut a Y constante (tope 84° por lado), con pasos geométricos fuera del sector; resultado `found` / `noEdgeToGamut` / `unexplored` (los dos últimos cuentan como abiertos); nota `peak-seen-below-source` en el archivo (registro, no bug);
  - láminas y cámara: selector Perfil/Bordes, Bordes por defecto cuando hay bordes medidos; láminas con `colorFor`;
  - huella del dispositivo (`device.ts`: UA + pantalla + dpr + gamut + refresco) en `luminance.device` y en cada sesión del historial; aviso «Usar igualmente / Repetir la prueba» al cargar el perfil en otra pantalla (perfiles anteriores: huella deducida de `hardware` + `refreshHz`);
  - calibración (escalera): rejilla hasta ≈0,006 lineal (`DESCEND` 0,85…0,0225), arranque ±1 peldaño al azar por eje, bisección con parada relativa (25 %); `fit.controlBounded` y razones «al menos» por vía mientras el control esté acotado; bordes con control acotado usan el umbral de la banda como suelo (`floorFrom: "band"`, disco a 0,8× ese umbral). El prior de QUEST+ ya bajaba a 0,1 ΔE00.

## 0a. Pendiente de decisión de Lucas
- [ ] **Calibración de 12 ejes con ajuste de elipse** (~70 ensayos, 1 sesión). Propuesta de Colorado; no implementar sin OK.
- [ ] **Historial en IndexedDB** (migración desde el perfil en localStorage) y exportar/importar JSON. Mientras tanto, el historial no tiene límite de tamaño: vigilar la cuota de localStorage (≈ 5 MB).
- [ ] Tamaño del parche: se queda en 4° × 2° salvo que Lucas pida otro.
- [ ] **Activar los flags por defecto** (`?motion=v2`, `?qp=1`) solo tras probar con personas reales, Lucas primero.
- [ ] Háptica en el resto de la app, con su OK zona por zona: respuestas del calibrador y de bordes, láminas, fin de bloque/prueba, conmutadores de cámara/filtro. Debe usar `navigator.vibrate` corto con detección de soporte, respetar `prefers-reduced-motion` y tener un interruptor.
- [ ] Lucas debe **rehacer su perfil con la prueba nueva**. Los JSON actuales (`tests/fixtures/perfil_*.json`) solo valen como fixtures: se hicieron en el móvil al aire libre.

## 0b. Fase 2 (luminancia personal), sin empezar
- [ ] Usar los pesos `luminance.weights` en el simulador y la asistencia, para que los colores se vean más vivos. Requiere invalidar la caché de LUT y cámara: hoy la clave es `cone:createdAt` (ver §6, causa 9).
- [ ] Reproyección de los ejes con la Y personal y recalibración de los umbrales del calibrador.

## 0c. Bugs documentados, sin arreglar
- [x] ~~**Bordes: sector de tono fijo como tope**~~: resuelto (límite analítico del gamut; `sectorOf` solo marca dónde empiezan los pasos geométricos).
- [ ] **Dos vías con un solo cono débil** (`filterModel`, `spectrum.ts`). Detalle en §4.
- [ ] Reanudación de la calibración: el perfil de la sesión reanudada solo trae el registro de esa sesión. Los umbrales sí son acumulados y el historial guarda todas las sesiones.

## 0d. Futuro
- [ ] Calibración 2AFC «qué par es distinto» con γ = 0,5 (tarea y UI nuevas).
- [ ] Refinamiento opcional del tamaño en móvil con `screen.width`/`devicePixelRatio`.
- [ ] Iconos PWA nativos: los de 192/512 son el de 180 px reescalado.
- [ ] GitHub Actions: pasar a las versiones con Node 24 (`actions/checkout`, `setup-node`, `configure-pages`, `upload-pages-artifact`, `deploy-pages`; hoy v4/v4/v5/v3/v4). Revisar también la migración de la imagen `ubuntu-latest`.
- [ ] LUT (3×33³) en el hilo principal: moverlas a un Web Worker.
- [ ] Simulación de referencia Machado/Viénot y aviso de calibración del monitor.
- [ ] Tests más finos de `src/lib/color` (`spectrum.ts`, `lut.ts`).
- Láminas: el contenido sigue como estaba (§7); solo se añadió el selector Perfil/Bordes.
- [ ] Probar en el móvil de Lucas: bordes más allá del sector, aviso de dispositivo y la rejilla nueva (más ensayos por eje en ojos sanos: ~5–8).

## Notas
- `tests/fixtures/` contiene los JSON del perfil de Lucas y son públicos en el repo; Lucas lo aceptó.
- Las líneas citadas en §1–§6 son de la revisión original y pueden haberse movido. Buscar por el nombre de la función.

## 1. Revisión de Colorado (abierta; comprobado el 25/10: nada de esto ha cambiado en el código)
- **(ALTA)** Ejes L y M no son independientes tras `killLuminance` (`src/lib/color/space.ts:96-100`, `:225-231`; `src/lib/color/profile.ts:618-635`). Para protán/deután colapsan en la misma línea, `elevatedCount=2`, y no se calcula ángulo de confusión. Propuesta: ejes DKL y puntuar L/M como una sola línea de confusión.
- **(MEDIA)** `ABS_CLOSE=0.02` (`src/lib/color/session.ts:35`) demasiado alto; bajar a ~0.006 con dithering o canvas `display-p3`/`rgba16float`.
- **(MEDIA)** `--color-border #3a3832` contraste 1,50:1; WCAG 1.4.11 exige 3:1. Propuesta `#6b665c`.
- **(BAJA)** `muted` sobre `stage` 3,32:1 < 4,5:1; APCA de botones accent Lc 58 (justo); ~~comentario HPE `space.ts:21` dice D65~~ (corregido en fase 1).

## 2. Revisión anterior
- ~~`npm test` falla~~ → ahora ejecuta `runSelfCheck` (pasa).
- ~~`runSelfCheck` nunca se llama~~ → `npm test`. Los tests más finos de `src/lib/color` pasan a §0d.
- ~~Lint: `prefer-const` en `session.ts`~~ (7a243ae); los warnings de hooks de React desaparecieron con Svelte.
- ~~Hooks: cleanup de `videoRef` / dependencia faltante en edges~~ → resuelto en la versión Svelte (`AssistCamera.svelte` para la cámara al desmontar, verificado).
- LUT en un Worker, simulación de referencia y aviso de monitor: ver §0d.

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
- `motion.ts` + `components/motion.tsx` (hoy `MotionTest.svelte`): movimiento mínimo a 1 Hz (`MOTION_HZ`, `motion.ts:5`), 8 franjas; método en `motion.ts:668`.
- Pares: `pairOf` (`motion.ts:218-224`): test = color×`gain`; referencia = gris `ANCHOR` para `control`/`extremo`, o el eje abierto vecino.
- Ganancia limitada: `MIN_GAIN 0.35`, `MAX_GAIN 3.5` (`motion.ts:11-12`); escalera seek/down/up/bisect, `TRIAL_CAP 48`.
- Solo se prueban ejes “abiertos” (`openAxes`, `motion.ts:118-125`: `threshold >= floor*1.6`, sin `upper-bound`/`closed`). Si L/M colapsaron o el rojo quedó `closed`/`upper-bound`, **el rojo afectado no se mide**.
- Guardado: `calibrator.tsx:89-91` (hoy `Calibrator.svelte`, `takeLuminance`) → `attachLuminance` (`motion.ts:680`) → `profile.luminance`; `orderLuminance` (`motion.ts:589-666`) puede reetiquetar `bound` como `"unconverged"` si no hubo “quieto” ni cruce ≤ 0,12.

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

### Evidencia en los JSON de Lucas (`/workspace/adan-json/`, copiados en `tests/fixtures/`)
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

## 7. Láminas (revisión de Colorado, 25/10) — DESCARTADO: Lucas decide dejarlas como están; son material visual para probar y enseñar los filtros, no un test — ahora en src/components/Plates.svelte y plates.ts
- [ALTA] El contorno se lee por el tamaño de los puntos (antes plates.tsx:105-134): aplicar la regla estricta en las tres pasadas o usar la misma distribución de radios dentro y fuera.
- [ALTA] Fuga de luminancia en protán y deután (antes :93): el ruido es aditivo ±0,028; pasar a un factor multiplicativo k ∈ [0,7, 1,3] con 3-5 niveles y conseguir ΔY < 0,3 σ.
- [ALTA] El 42 "oculto" se coloca en el umbral entero (antes :69) y se ve con s alto: ponerlo a ~0,7× el umbral o donde ΔE00 (Machado) < 1,5.
- [MEDIA] Añadir láminas diagnósticas (cifra oculta y de transformación) sobre las líneas de confusión de Brettel/Viénot para separar protán de deután.
- [MEDIA] Usar 2-3 tonos por región en lugar de 2.
- [MEDIA] Fijar colorSpace:"srgb" en el canvas y rellenar con un gris de la misma Y que el ANCHOR (sRGB ≈ 130) para evitar halos.
- [BAJA] El control es demasiado fácil.


## 8. QUEST+: notas abiertas
- Coste en simulación (PLAN-questplus §10): la calibración con parada ln 1,5 necesita ~160–190 ensayos en 2,5–3 sesiones de 80.
- La 12 ejes (§0a) lo reduciría a ~70 en 1 sesión.
