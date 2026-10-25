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
- Respuestas «no sé»: no actualizan la posterior (o se tratan como respuesta al azar, a decidir; ver §8).
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
- Respuesta: dirección izquierda/derecha → `γ` = 0.5. Probabilidad de responder «más claro» = función monótona de `log(e_estímulo / e(sev))`, usando la Weibull simétrica en log-ganancia.
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

## 8. Preguntas abiertas
**Colorado**
1. ¿Pendiente `β` libre por sujeto o fija por prueba? ¿Qué rango?
2. Calibración: ¿pasar a 2AFC (`γ` = 0.5) o mantener sí/no con `γ` estimado de los catch?
3. ¿Qué hacemos con «no sé»: ignorarlo o tratarlo como respuesta al azar?
4. ¿Equivalencia ΔE00 → parada en bordes y calibración: 0.5 o 1?
5. Protán 0.3–1.1× frente al tope del 22 % (≈ 0.64×): ¿aceptamos la cota «al menos» o subimos la saturación hacia el 70 %?

**Lucas**
1. ¿Vendorizar (propuesta) o instalar desde npm con la dependencia de GitHub?
2. ¿Orden de implantación: movimiento v2 → bordes → calibración?
3. ¿Mantener la escalera actual como alternativa (flag) durante la transición?
