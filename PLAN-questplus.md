# Plan: QUEST+ para elegir el siguiente estímulo

Estado: **solo plan, sin código.** Aprobado por Lucas (25/10): «Haz los ajustes de seguridad y escribe el plan de QUEST+ a la vez». Incluye la aportación de Colorado (25/10) para la prueba de movimiento v2.

## 0. Alcance
QUEST+ (Watson 2017, *J. Vision* 17(3):10) **solo sustituye la elección del siguiente estímulo** y la estimación final. No cambian: render, pares, colores de referencia, controles, catch trials, UI, avisos de seguridad ni formato de salida (salvo campos nuevos opcionales de posterior/IC). El flag v2 sigue apagado por defecto y los filtros no se tocan.

## 1. Librería
### jsQuestPlus (adoptar)
- Repo: https://github.com/kurokida/jsQuestPlus — **MIT** (verificado en `LICENSE`, © 2021 Daiichiro Kuroki). Cita: Kuroki & Pronk (2022), *Behavior Research Methods*, doi:10.3758/s13428-022-01948-8.
- npm: **`jsquest-plus`** (no `jsquestplus`), v2.1.0, `"type": "module"`, `main: src/jsQuestPlus.js` (ESM, `export default jsquest`). También trae `dist/jsQuestPlus.module.js` (ESM con `numeric` incluido) y UMD.
- Dependencia: `numeric_es6` **desde GitHub** (`github:tpronk/numeric`), no desde npm → frágil en CI (`npm ci` necesita git y red a GitHub).
- Tamaño: `dist/jsQuestPlus.module.js` 127 KB sin comprimir, ~31 KB gzip; minificado con esbuild ~23 KB gzip (casi todo es numeric.js). Paquete npm desempaquetado 1.4 MB (demos, mapas).
- Problemas: hace `console.log('jsQuestPlus Version 2.0.0')` al importar y usa `alert()` en errores de `set_prior`.
- **Decisión propuesta: vendorizar** `dist/jsQuestPlus.module.js` en `src/vendor/jsquestplus/` con su `LICENSE` y un README con versión/commit, quitando el `console.log` y cambiando `alert` por `throw` (cambio documentado, MIT lo permite). Carga perezosa (`import()`) solo al entrar en una prueba que lo use, para no engordar el bundle inicial. Alternativa: instalar `jsquest-plus` y fijar el commit de `numeric_es6`.
- Plan B si no rinde en móvil: implementación propia de ~150 líneas (rejilla + entropía esperada) usando jsQuestPlus como oráculo en tests.

### questplus (Python, solo referencia)
- https://github.com/hoechenberger/questplus — **GPL-3.0** (verificado). **No copiar código** a este repo MIT; solo leer la documentación y comparar resultados numéricos (oráculo externo, fuera del repo).

## 2. Modelo común
- Función psicométrica Weibull: `ψ(x) = γ + (1 − γ − λ)·(1 − exp(−(x/α)^β))`.
- `γ` según la tarea (fijo): 0.5 en 2AFC/dirección; en tareas con N opciones, 1/N.
- Parámetros: umbral `α` (siempre), pendiente `β` (opcional, por sujeto), lapse `λ` ∈ {0.02, 0.035, 0.05} **marginalizado** (no se reporta).
- Rejillas precalculadas una vez por prueba: tabla `P(respuesta | estímulo, parámetros)` (lo que jsQuestPlus llama `precomputed_outcome_proportions`).
- Estimación final: media posterior de `α` e IC 95 % de su marginal.
- Respuestas: ver §8.4 (movimiento: izquierda/derecha/quieto con modelo de 3 respuestas; «no sé» solo donde exista ese botón).
- Catch trials y controles: **fuera de QUEST+**, intercalados por el planificador como hoy; sirven para la confianza y para estimar el lapse.

## 3. Por prueba
### 3.1 Calibración de umbrales (`session.ts`)
- Dominio: `s ∈ [0, s_max]` a lo largo de la dirección isoluminante de cada eje, `s_max` = borde del gamut (`maxScale`). Rejilla logarítmica de ~40 puntos.
- Parámetros: `α` (umbral, 40 valores log), `β` ∈ {2, 3.5, 5} opcional, `λ` marginalizado.
- Respuesta: «distintos/iguales». Con el diseño actual (sí/no), `γ` = tasa de falsas alarmas estimada con los pares iguales (catch), acotada a [0.02, 0.2]; si se pasa a 2AFC, `γ` = 0.5.
- Prior: log-normal centrada en el umbral normal (control) para S/L/M; si hay perfil previo, en su umbral, con σ ancha.
- Parada: IC 95 % de `α` < 0.5–1 ΔE00 equivalente en el punto de umbral, o 30 ensayos por eje.
- Catch: pares iguales como ahora (mismo ritmo).

### 3.2 Bordes (`edges.ts`), refinamiento tras el bracketing
- El bracketing geométrico (×1.5–2) del plan de bordes sigue igual; QUEST+ empieza **después**, dentro del intervalo encontrado.
- Dominio: ángulo de tono (°) dentro del intervalo, paso 1°, a escala fija.
- Parámetros: posición del borde `α` (°), `β` opcional y `λ` marginalizado.
- Respuesta: elegir el disco distinto entre N → `γ` = 1/N.
- Prior: uniforme dentro del intervalo del bracketing.
- Parada: IC 95 % < ΔE00 0.5–1 convertido a grados en ese tono, o 20 ensayos por lado.
- Catch: el par intra-franja fijo y los controles actuales.

### 3.3 Movimiento v2 (`motion2.ts`), con la aportación de Colorado
- **Espacio de parámetros: severity ∈ [0, 1], paso 0.05** (21 valores), más pendiente por sujeto `β` ∈ {1.5, 2.5, 4} y lapse `λ` ∈ [0.02, 0.05] marginalizado. Cada severity se traduce a umbral con `cones.ts`: brillo relativo predicho del color `e(sev) = predictedMatch(color, gris, predictedLumWeights(tipo, sev))`. Así un único posterior sirve para todos los colores del mismo tipo.
- Tritán y desconocido: el parámetro es directamente `e` por color (la severity no mueve la luminancia en tritán).
- **Estímulo:** ganancia de luminancia del rojo (y de los otros colores de prueba) frente al gris. Rango de partida 0.3–1.1× en protán y 0.8–1.2× en deután/tritán, rejilla log de 1–2 %.
- Respuesta: izquierda/derecha/quieto con el modelo de 3 respuestas de §8.4 (logísticas opuestas en `log(e_estímulo / e(sev))` y «quieto» como resto), sin γ = 0.5.
- **Prior:** centrado en severity 0.6 con peso ≈ 2 igualaciones (las mismas que el prior λ = 2 de `lumweights.ts`), sobre todo el rango 0..1.
- **Seguridad, comprobada antes de presentar CADA estímulo** (no solo al construir la rejilla):
  - contraste de Michelson en Y estándar ≤ 22 % en cualquier fotograma (constante entre 20 y 25 %);
  - colores al 60–70 % del camino hacia el borde del gamut (hoy 0.65);
  - área ≤ 25 % de la pantalla, bloques cortos (20–30 s) con pausa, frecuencia = refresco/(4k).
  - Si QUEST+ propone un estímulo fuera del tope, se recorta al tope. Si la posterior queda pegada al tope, el resultado es una cota («al menos», `atLeast`), como ya hace la escalera.
  - Ojo: con el rojo al 65 % y el tope del 22 %, la ganancia presentable queda en ≈ 0.64–1.56×, así que el extremo bajo protán (0.3×) no se presenta: se cubre con la cota.
- Parada: IC 95 % de `e` < 2–3 %, o tope de ensayos por color (30).
- **Controles: ≥ 4–5 por bloque (hoy 5)** y tolerancia del 10 % sobre la predicción. Catch: > 25 % fallados ⇒ confianza baja (igual que ahora).
- Salida: igualaciones → `lumweights.ts` → perfil v3, como ahora. Se añaden `posteriorSeverity` (media e IC) y `method: "quest+"`.

## 4. Validación
- Tests unitarios con **observadores simulados**: normal, protán (sev 0.3/0.6/1), deután (0.3/0.6/1) y tritán. Responden con la Weibull de parámetros conocidos más lapse.
  - Criterio: convergencia al valor puesto (|error| < IC en ≥ 90 % de 50 semillas) en menos de N ensayos.
  - Comparar el número de ensayos con la escalera actual (objetivo: −30 %).
  - Casos extremos: sujeto pegado al tope → cota «al menos»; respuestas aleatorias → confianza baja.
- Cada estímulo propuesto pasa el comprobador de seguridad (test que recorre 1000 propuestas).
- Oráculo: comparar posteriores con jsQuestPlus original (sin vendorizar) y, fuera del repo, con questplus de Python.

## 5. Presupuesto de rendimiento (móvil)
- Coste por ensayo ≈ `|estímulos| × |parámetros| × |respuestas|`.
- Movimiento: 60 × 21 × 3 × 4 × 2 ≈ 30 k operaciones; calibración: 40 × 40 × 3 × 4 × 2 ≈ 38 k. Objetivo < 5 ms por ensayo en un móvil medio y < 2 MB de tablas.
- Precomputar las tablas de verosimilitud al empezar la prueba (< 100 ms), o en un Web Worker si pasa de 50 ms.
- Si no cabe: bajar la rejilla de estímulos (evaluar solo 15 candidatos alrededor del mínimo de entropía) o fijar `β`.
- Medir en CI con un benchmark (`tests/questplus.bench.ts`) y anotar en el README.

## 6. Pasos (un commit por paso, todo verde)
1. `docs`: este plan (hecho).
2. `chore`: vendorizar jsQuestPlus (MIT + README de origen, sin `console.log`/`alert`) y añadir un test de humo que replique el ejemplo de Watson {1,1,2}.
3. `feat`: `src/lib/color/questplus.ts`, un envoltorio tipado (rejillas, Weibull con γ/λ, posterior, IC, siguiente estímulo) con observadores simulados en los tests.
4. `feat`: motion v2 con QUEST+ tras el flag (`?motion=v2&qp=1`). Comprobador de seguridad en cada estímulo, controles ≥ 5 por bloque y salida igual.
5. `feat`: bordes, con QUEST+ en el refinamiento tras el bracketing.
6. `feat`: calibración con QUEST+ por eje (tras flag), sin cambiar pares ni catch.
7. `test`: benchmark móvil y comparación de ensayos frente a la escalera.
8. `docs`: TODO/PLAN y resultados.

## 7. Riesgos
- Dependencia de GitHub (`numeric_es6`) y un mantenimiento lento (última publicación en julio de 2025) → por eso se vendoriza.
- Un prior mal centrado o una pendiente errónea pueden sesgar el resultado → `β` libre, prior ancho y comprobación con simulaciones.
- Lapses de atención en móvil → `λ` marginalizado y catch trials.
- El tope de seguridad trunca el dominio → cotas «al menos» en lugar de valores falsos.
- Rendimiento en móviles antiguos → Worker y rejillas reducidas.
- La pista de brillo en la calibración (constant-Y estándar) no la arregla QUEST+ → sigue siendo la fase 2 de luminancia.

## 8. Decisiones de Colorado (25/10)
Prevalecen sobre lo dicho en §2–§6 donde haya diferencia.
1. **Cota por el tope de seguridad:** se acepta. Se guarda `gain ≤ 0.64×` con un flag (`atLeast`); la saturación se queda en el 65 %. Si un color queda recortado, la compensación (fase 2) usa la cota y avisa de que la severidad real puede ser mayor.
2. **Pendiente:** libre pero estrecha, con 3–5 valores en escala logarítmica entre 0.5× y 2× la nominal, marginalizada (no se reporta).
3. **Calibración:** pasa a **2AFC con γ = 0.5** (sustituye el sí/no con γ estimado de §3.1).
4. **Respuestas (corregido por Colorado):**
   - **Movimiento v2:** tres respuestas, izquierda/derecha/**quieto**; no hay «no sé». «Quieto» **no es azar**: indica casi equiluminancia y es informativo.
     - Modelo QUEST+ de 3 respuestas: P(izquierda) y P(derecha) son logísticas opuestas centradas en el punto nulo, con la pendiente del sujeto; P(quieto) es el resto, que tiene su máximo en el nulo.
     - Parámetro extra: semiancho de la banda de «quieto» ±δ, con 3 valores y marginalizado. Sale con lapse, pendiente y δ marginalizados; se estima el punto nulo.
     - jsQuestPlus admite más de 2 respuestas pasando una función por respuesta (`psych_func` es un array y `responses = 0..PF.length−1`, verificado en `src/jsQuestPlus.js`).
     - Para el movimiento se descarta 2AFC/γ = 0.5; solo se usaría si algún día se fuerza izquierda/derecha.
     - Fiabilidad: si «quieto» pasa del 60 % de los ensayos de un bloque, contando los catch de movimiento evidente, el bloque se marca poco fiable.
   - **Calibración:** 2AFC con γ = 0.5 (decisión 3).
   - **«No sé»:** solo donde exista ese botón; ahí cuenta como elección al azar que actualiza la estimación, y más del 30 % en un bloque lo marca poco fiable.
5. **Parada:** IC 95 % < 1 ΔE00 (o su equivalente en cada prueba), con un máximo de **40 ensayos** por eje/color como tope de fatiga (sustituye los 20/30 de §3).

## 9. Preguntas abiertas
**Lucas**
1. ¿Vendorizar (propuesta) o instalar desde npm con la dependencia de GitHub?
2. ¿Orden de implantación: movimiento v2 → bordes → calibración?
3. ¿Mantener la escalera actual como alternativa (flag) durante la transición?

## 10. Estado actual del código (25/10, sin cambios)
- `MotionTestV2.svelte` ofrece «Izquierda / **Quieto** / Derecha»; en el motor (`motion2.ts`) la respuesta es `"still"`.
- En la escalera, `"still"` es informativo: inversión en el valor actual (cerca del nulo) y paso reducido. No se trata como azar.
- En los catch (movimiento evidente), «Quieto» cuenta como fallo (atención).
- Regla del 60 % implementada: cada bloque guarda `{trials, still, unreliable}` en `luminance.checks.blocks`; con algún bloque poco fiable la confianza pasa a `"low"`.
- Aviso de distancia visible en la preparación y en las pausas: móvil (`pointer: coarse` y lado corto < 600 px CSS) 40 cm «un antebrazo», PC 60 cm «un brazo extendido». Periodo de la red calculado para 1 ciclo/grado (Colorado) con px CSS ≈ 0.16 mm en móvil y ≈ 0.26 mm en PC; sin ventana fija en cm (los cm CSS no son físicos). Se guardan c/°, tamaño en grados (`stimulusDeg`) y la heurística (`sizingHeuristic`). Se guardan `viewingCm`, `deviceType` y `cssPxPerMm` en el perfil v3.
- Sin calibración del usuario (decisión de Lucas, 25/10): ni tarjeta ni ajuste de tamaño. Los estímulos se dimensionan con tipo de dispositivo + distancia supuesta + densidad heurística; basta porque el mínimo de movimiento (Anstis & Cavanagh 1983) es robusto entre 0.5 y 2 ciclos/grado, y el error de la heurística (±15 %) deja 1 c/° dentro de ese rango.
- Estímulo: parche central de 4° × 2° (`PATCH_DEG`), área ≤ 25 % de la pantalla. Restricciones de Colorado (`SCREEN` en `motion2.ts`):
  - fijación: punto acromático de 0.15° (Weber −15 %) en un hueco circular de 0.5° a la luminancia media; sin brazos de cruz sobre la red;
  - apertura elíptica inscrita en 4° × 2° con ventana coseno RADIAL de 0.25° en todo el contorno, mezclada en lineal hacia el gris medio (nunca sube el contraste; el tope de Michelson se mantiene);
  - margen ≥ máx(1°, un periodo) entre el parche y cualquier decoración;
  - pantalla de prueba a pantalla completa, fondo uniforme a la luminancia media de la red del ensayo, todo acromático (sin modo oscuro); líneas Weber ≤ 15 %, texto ≤ 30 %;
  - dirección real equilibrada por parejas de ensayos (una a cada lado, orden aleatorio);
  - 0.5 s de gris neutro entre ensayos (ISI), respuestas desactivadas durante el ISI.
- Retícula decorativa (`MotionReticle.svelte`, quitable con `SHOW_RETICLE = false`, fuera de la lógica de medida): anillo de 1 px con marcas radiales cada 15°, anillo de progreso simétrico (arriba y abajo a la vez) que avanza con easing solo en el ISI, rótulos monoespaciados arriba (Hz, c/°) y uno centrado abajo (bloque · ensayo); sin barra de escala. Instrucciones y botones a Weber 35 % (`uiWeber`), todo gris dentro del margen de Weber. Háptica de 8 ms en móvil al responder (sin `prefers-reduced-motion`).
- Pendiente: modelo de 3 respuestas en QUEST+.

### Resultados (observadores simulados, 6 semillas)

| Prueba | QUEST+ | Escalera |
|---|---|---|
| Movimiento normal | 37,4 ens/objetivo, 97 % ±5 % | 11,3, 90 % |
| Movimiento protan 0,6 | 35,7, 100 % | 11,3, 90 % |
| Movimiento deutan 0,6 | 29,4, 100 % | 11,3, 90 % |
| Movimiento tritan 1 | 37,1, 95 % | 10,7, 74 % |
| Bordes (borde 9°, 20 semillas) | 72,8 ens/ronda, 20/20 ±3° | 34,1, 17/20 |
| Calibración 2AFC (solo motor) | 32,7 (normal) – 40 (tope) ens/eje, 24/24 ×1,35 | — (tarea distinta) |

Conclusión: QUEST+ es más exacto pero gasta 2–3× más ensayos con las reglas de parada actuales
(IC < ln 1,06 / < 1° / < ABS_CLOSE). La escalera sigue por defecto. Ajustar la parada es pregunta abierta.

Calibración: el motor 2AFC (γ = 0,5, decisión 3) existe en `calibqp.ts`, pero NO está cableado:
la UI actual es sí/no ("igual/distinto") y 2AFC exige una tarea nueva, en conflicto con
"sin cambiar pares ni catch". Pendiente de decisión.

### Respuestas de Colorado aplicadas (2026-10-25)

1. Parada: movimiento IC < ln 1,10 o 30 ensayos; bordes IC < 2° o 45. β fijo al nominal si el sesgo simulado es < 3 %:
   movimiento −0,08 % (fijo, 16,5 ens/objetivo frente a 22,4 con β marginal); bordes −0,9 % (fijo).
2. Calibración: tarea sí/no sin cambios de pares ni catch; γ = falsas alarmas en catch acotada a [0,02, 0,3] con ≥ 5 catch
   (antes, γ = 0,05 provisional); QUEST+ cableado tras `?qp=1`. Futuro: 2AFC «qué par es distinto», γ = 0,5.
3. Movimiento: δ ∈ {0,02, 0,04, 0,08} en ln ganancia; β ∈ {0,5, 1, 2}× nominal; prior log-normal σ = 0,25 centrado en la predicción.
   Calibración: prior uniforme en log ΔE00 0,3–10, β = 3. CIEDE2000 real (`deltaE.ts`), validado con los 34 pares de Sharma et al. (2005).
4. Fondo constante en la Y más baja alcanzable por todos los ensayos: Y = 0,1475 (límite: ref ≤ 0,18 con e = E_MAX); la red se centra en él.
5. Fijación Weber −15 %: se mantiene.
6. Bordes: «Ninguno» = fallo de detección informativo (modelo de 3 respuestas `detect3`); disco equivocado = lapsus.
   1 ΔE00 se convierte a ángulo por bisección en θ (≈ 8–12° a la escala de los discos) y se guarda con el IC.
   Catch obvios (tono +90°) cada 6 ensayos QUEST+; > 25 % «ninguno» ⇒ ronda no fiable. Sin regla del 30 %.

### Últimas respuestas de Colorado aplicadas (2026-10-25, 2.ª ronda)

1. Bordes: parada con IC < 1 ΔE00 medido en ΔE00 punto a punto (respaldo: 8° fijos si no se puede convertir); el IC se guarda en grados y en ΔE00; tope 45 por lado.
2. Calibración: tope de 80 ensayos por sesión (antes 160). Los ejes abiertos al llegar al tope quedan como estimación
   y su posterior QUEST+ (registro de ensayos + probabilidades por punto de la rejilla) se guarda en `localStorage`
   (`umbral.calib.qp.resume`) y en el perfil (`calibrationResume`, `quest.resumable` por eje). La siguiente sesión con `?qp=1`
   reanuda solo esos ejes; los cerrados se conservan. La escalera mantiene 160.
3. Calibración 30/eje, γ = 0,05 hasta 5 catch, lapse 0,02–0,05: confirmados.
4. Catch obvios de bordes: 1 de cada 6, con +25 % de Y en el disco distinto además del tono +90° (≥ 20 % pedido).
5. Fondo Y = 0,1475 constante; tope de contraste sin cambios.
6. β fijo aceptado con tolerancia de sesgo ±10 %.

### Respuestas de Colorado aplicadas (2026-10-25, 4.ª ronda)

1. Prior de calibración desde 0,1 ΔE00 (antes 0,3). Resimulado: el normal seguía con 7/36 ejes fuera de ×1,35 (> 5),
   así que el tope por eje sube a 36. Nota: el normal no cambia con 36 (sus ejes paran por IC < 1 ΔE00 antes del tope).
2. Fiabilidad de bordes por sesión: se suman los catch de todas las rondas QUEST+ (`sessionReliability`); 1 catch cada 6
   y al menos 1 por ronda (si QUEST+ cierra sin ninguno, se muestra uno antes de la profundidad); < 5 catch ⇒ «indeterminada»;
   > 25 % «ninguno» ⇒ «no fiable». Se muestra en el resultado solo si hay rondas QUEST+.
3. Observador simulado de calibración (solo tests, no datos fisiológicos): normal casi circular 1 : 1,5; daltónico con el semieje
   mayor en su línea de confusión = base × (1 + 4s/(1 − s)), tope ×10; menor = base (1,5 ΔE00). Protan/deutan s = 0,6 (×7), tritan s = 0,5 (×5).
4. Historial completo en el perfil (`history`, formato `umbral.history.v1`, `src/lib/color/history.ts`): por sesión id, tipo, fecha,
   dispositivo, distancia, grados del estímulo, Y de fondo, versión y método del motor y ensayos en bruto; > 8 kB se guardan en
   columnas («columns-v1», sin pérdida). Campo opcional: perfiles v3 previos siguen valiendo sin migrar.

### Respuestas de Colorado aplicadas (2026-10-25, 5.ª ronda)

1. Bordes: mínimo 2 catch por ronda (`catchPerRound`); la sesión sigue necesitando 5 para dejar de ser «indeterminada».
2. Calibración: parada relativa, IC 95 % de ln α con ln(hi/lo) < ln 1,5, o 36 ensayos por eje; se quita el criterio absoluto de 1 ΔE00 (bordes sin cambios).
3. El plano del observador simulado se documenta como aproximación (RGB lineal isoluminante, no contraste de cono).
- **Pendiente de Lucas (no implementado):** calibración de 12 ejes con ajuste de elipse; migración del historial a IndexedDB y exportar/importar.

### Benchmark (observadores simulados)

| Prueba | QUEST+ (config. final) | QUEST+ β marginal | Escalera |
|---|---|---|---|
| Movimiento normal (6 semillas) | 16,6 ens/obj, 90 % ±5 % | 22,3, 100 % | 9,4, 80 % |
| Movimiento protan 0,6 | 16,5, 87 % | 22,3, 87 % | 9,4, 80 % |
| Movimiento deutan 0,6 | 16,3, 83 % | 22,8, 100 % | 9,4, 80 % |
| Movimiento tritan 1 | 16,5, 90 % | 22,4, 95 % | 9,0, 81 % |
| Bordes, borde 9° (20 semillas, parada 1 ΔE00, ≥ 2 catch/ronda) | 19,6 ens/ronda, 20/20 ±3°, sesgo +1,8 % | 24,3, sesgo −1,0 % | 35,8, 18/20 |
| Bordes, sesión de 3 rondas (10 semillas) | 6,0 catch/sesión; atento 0/10 «indeterminada», 0/10 «no fiable»; desatento 9/10 «no fiable» | — | — |
| Calibración normal (6 semillas, parada ln 1,5 / 36, tope 80 + reanudar) | 181 ens en 3,0 sesiones, 35/36 ejes ×1,35 | — | 48,5, 2/19 «estimate» |
| Calibración protan / deutan / tritan | 161 / 171 / 173 ens en 2,5 / 2,8 / 2,8 sesiones; 29/30, 29/30, 35/36 | — | 55,3 / 55,0 / 49,7; 6/27, 2/22, 5/22 |
