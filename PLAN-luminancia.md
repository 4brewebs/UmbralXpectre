# Plan: luminancia personal con la prueba de movimiento mínimo

Solo es un plan. No cambia código. Los JSON de Lucas (`/workspace/adan-json/`) se hicieron con el móvil, en exterior y con cansancio. Se usan como **perfil de referencia para tests**, no como diagnóstico.
**Fuera de alcance:** no se planifica ninguna prueba de parpadeo/HFP. Solo se adapta `motion.ts`.

## 0. Estado actual (referencias)
- Y estándar: `space.ts:13` `Y_COEF`, `luminance` `:28-30`, `killLuminance` `:32-35`. Hay 15 llamadas en `motion.ts`, `selfcheck.ts`, `session.ts`, `spectrum.ts` y `space.ts`.
- Movimiento: `MOTION_HZ = 1` (`motion.ts:5`), `STRIPES 8`, gain 0.35–3.5 (`:7-15`).
- Estímulos: `colored()` (`:213-216`) = gris 0.22 + `sat`·dirección; ref gris o eje vecino (`pairOf` `:218-224`).
- Pintado: `paintMotion` (`:682-717`), mezcla sinusoidal continua (no 4 fotogramas), sin dithering.
- `openAxes` (`:118-125`) excluye ejes cerrados; aparecen pares rojo-rojo (en Lucas: `l`↔magenta, `red-end`↔rojizo).
- Uso: `lumaFromProfile` (`spectrum.ts:35-52`), regla = control; `lumaGainAt` (`:320-330`) solo en `BAND_HALF`; `ASSIST_LUMA 0.35` (`:200`); fórmulas en `:379,:437,:573,:603`.
- Esquema `umbral.profile.v2` (`profile.ts:37,157,482,558-581`); `luminance` `:98`. LUT `basedOn` (`lut.ts:88,147`); caché cámara `camera.tsx:167` `cone:createdAt`.

## 1. Módulos nuevos
### `src/lib/color/cones.ts` (modelo de conos y predicción)
- LMS **Smith-Pokorny** (coherente con XYZ 1931); **primarios sRGB nominales**.
- `shiftedCone(type: "protan"|"deutan"|"tritan", severity)`: como Machado 2009: severity 1 = 20 nm (L hacia M protán, M hacia L deután); tritán escala S. **La `severity` de la app (p. ej. 0.737) es otra escala: no se convierte**; la predicción solo es punto de partida y el movimiento ajusta la severidad efectiva.
- `predictedLumWeights(type, severity) → {wR,wG,wB}` con V'(λ) ≈ a·L' + b·M' (S≈0), normalizado a suma 1.
- `predictedMatch(rgbTest, rgbRef, w) = Y_w(ref)/Y_w(test)`. Comprobación: protán severo `#FF0000` vs gris ⇒ 0.46–0.57×.
- `typeFromProfile(profile)`: a partir de `fit.confusionAngleDeg`, del eje `l`/`m`/`s` elevado y de `fit.severity`. Si es ambiguo: «unknown», lo que lleva a un rango ancho.

### `src/lib/color/lumweights.ts` (solver)
- Cada match i da un test lineal t_i y una ref r_i con Y_w(g_i·t_i) = Y_w(r_i) ⇒ restricción lineal `w·(g_i t_i − r_i) = 0`.
- Mínimos cuadrados con restricción `wR+wG+wB = 1`: sustituir `wB = 1−wR−wG` y resolver el sistema 2×2 ponderado (peso 1/ancho² del intervalo `low–high`). Prior hacia la predicción λ‖w−w_pred‖² con **λ ≈ 2 matches**.
- Restringir w ≥ 0. Si hay match de control (eje sano), la Y_w resultante debe dar ≈1 ± tolerancia; si no, `confidence: "low"`.
- Salida: `{weights, residuals, cond, n, source: "measured"|"predicted"|"standard"}`.

## 2. Cambios por archivo
### `space.ts`
- `Y_COEF` pasa a ser por defecto; `luminance(rgb, w = Y_COEF)` y `killLuminance(rgb, w = Y_COEF)`. Así no se rompen las 15 llamadas.
- Corregir el comentario HPE `:21` (iluminante E).

### `motion.ts` (la prueba)
- `MOTION_HZ` 1 → **frecuencia = refresco/(4k)** (ciclo de 4 fotogramas, k fotogramas por fase): 60 Hz → 15 o 7.5 Hz (10 Hz imposible); 90 Hz → 11.25 o 7.5; 120 Hz → 15, 10 o 7.5. Por defecto, la opción ≈7.5 Hz según el refresco medido (basta). Paradigma **Anstis-Cavanagh de 4 fotogramas**: F1 rejilla de color, F2 rejilla de luminancia desplazada 1/4 de ciclo, F3 color invertido, F4 luminancia invertida. Reescribir `paintMotion` (`:682-717`) por fotograma, no por mezcla sinusoidal. Frecuencia espacial 0.5–1 c/grado: calcular `STRIPES` desde el ancho en CSS px, `devicePixelRatio` y una distancia de visión supuesta (pregunta abierta).
- Estímulos: sustituir `colored()` por `saturatedAlong(confusionDir, fracGamut)`: color cerca del borde del gamut sobre la línea de confusión del perfil (`fit.confusionDirectionLinearRgb`), más los colores fijos por tipo (abajo).
- Referencias: **siempre neutra** (gris o el color del eje opuesto sano). Eliminar `pickTargets` vecino-abierto (`:131-…`) y la regla anaranjada. Nunca rojo contra rojo.
- Búsqueda: QUEST (o escalera 1-arriba/1-abajo sobre log-gain con pasos de 1–2 %). Centro = `predictedMatch`, rango ±50 %, **se amplía al tocar el tope** (como edges). Fin: IC < 2–3 % o 8 inversiones; tope de ensayos.
- Dithering espacial (ordenado/azul) + temporal por debajo de 8 bits en `toSrgb8` local (pasos de 1 % en canales oscuros < 1 LSB). Opción de canvas `display-p3`/`rgba16float` si existe.
- Siempre: **un color de control en un eje no afectado** y **ensayos de igualdad** (catch, test = ref). Si el control no sale ≈1, se avisa y se aplica la predicción.
- `LUMINANCE_METHOD` (`:668`) actualizado; `orderLuminance` (`:589-666`) acepta v2 y v3.

### Configuración por tipo (tabla en `motion.ts` o `cones.ts`)
| Tipo | Tests vs gris | Contraste | Rango | Filtro |
|---|---|---|---|---|
| Protán | `#FF0000` + rojos de la banda | verde, azul | 0.3–1.1×, resolución alta | compensación ≤ 2×, añadir algo de G a los rojos |
| Deután | verdes y rojos saturados | azul | 0.8–1.2×, pasos finos | casi sin corrección; guardar siempre los pesos medidos (`source: measured`), y si están dentro del ruido del estándar el filtro usa el estándar |
| Tritán | azul/violeta, amarillo | rojo | 0.8–1.2×, más repeticiones y más tolerancia (pigmento macular) | sobre todo confirmar normal; mismos criterios de guardado que deután |
| Desconocido | los tres | — | 0.3–1.5× | ninguna hasta tener datos |

### `components/motion.tsx`
- Bucle rAF (`:39-45`): avanzar por fotograma según `refreshHz` medido (estimar con 60 rAF al inicio); si hay jitter > 20 %, avisar.
- **Seguridad**: alerta de fotosensibilidad antes de empezar; contraste Michelson de luminancia **≤ 10 %**; rejilla **≤ 25 % de la pantalla**, nunca a pantalla completa; sin inversiones de rojo saturado a pantalla completa (destello rojo WCAG 2.3.1); bloques de 20–30 s con pausas; consentimiento previo; botón de parar siempre visible; respetar `prefers-reduced-motion`. **No afirmar cumplimiento de WCAG 2.3.1**: prueba opcional con aviso.
- **Pantalla**: pedir desactivar True Tone, modo noche y brillo automático; brillo fijo. Guardar las confirmaciones en `hardware`.

### `profile.ts` (v2 → v3)
- `schema: "umbral.profile.v3"`; `luminance.weights: {wR,wG,wB}`, `luminance.weightsSource`, `luminance.predicted`, `luminance.type`, `luminance.refreshHz`, `luminance.cyclesPerDeg`, `luminance.checks` (control/catch), `luminance.calibratedWith: "standardY"|"personal"`.
- `parseProfile` (`:558-581`): aceptar v1/v2/v3. **Migración v2**: conservar `luminance.matches` como `legacy` (pares rojo-rojo, 1 Hz) **sin derivar pesos** (no son fiables, ver evidencia en TODO §6) → `weights` = predicción si hay tipo/severidad, si no, Y estándar. `PROFILE_STORAGE_KEY` (`:482`) a v3, leyendo antes v2.
- `umbral.edges.v1`: sigue válido; su `basedOn` apunta a v2 → aceptar `basedOn` v2/v3 por `createdAt`.

### `spectrum.ts`
- `lumaFromProfile` (`:35-52`) → `weightsFromProfile(profile)`; el brillo se aplica por color con Y_personal/Y_std, no por ángulo ni solo en banda (desaparece la dependencia de `lumaGainAt` `:320-330` y `BAND_HALF`).
- Simulador (`paintYours :379`, `edgePaint :603`): mostrar a un observador normal Y_std′ = Y_personal(rgb), oscureciendo los rojos para el protán.
- Asistencia (`steer :437`, `:573`): **corregir el signo**: compensar con factor min(2, Y_std/Y_personal) (tope 2× para protán), aplicado parcialmente (`ASSIST_LUMA` como fuerza, no como atenuación del oscurecido) y, si se recorta a 2×, añadiendo verde: ΔG = (Y_objetivo − Y_recortada)/w_G, limitado a un cambio de tono ΔE00 ≤ ~10 (valor inicial, por ajustar con usuarios). Deután/tritán ≈ sin corrección.
- `planeColor` (`:334`): al subir Y, recortar con conservación de tono, no de canal.

### `session.ts` y calibración
- Estímulos (`:151,:208`) con `killLuminance(primary, w)`; `w` = estándar en la primera pasada.

### `lut.ts`, `camera.tsx`
- `basedOn` (`lut.ts:147`) incluye `weightsHash`; la clave de caché de la LUT y la de la cámara (`camera.tsx:167`) pasan a `cone:createdAt:weightsHash`.
- `umbral.transforms.v1` → v2 con `basedOn.weights`.

### `calibrator.tsx`
- `takeLuminance` (`:89-91`): resolver pesos con `lumweights.ts` y guardar v3; mostrar w y predicción vs medida en `Brightness` (`:757`); export/import v3.

## 3. Huevo y gallina (constant-Y)
Orden propuesto:
1. Calibración de umbrales con **Y estándar** (como hoy).
2. Prueba de movimiento → pesos personales.
3. **Re-proyección** (sin repetir): reexpresar umbrales/direcciones en el plano isoluminante personal (proyectar cada estímulo guardado con `killLuminance(·, w)` y recalcular distancias), marcada `calibratedWith: "standardY+reprojected"`.
4. Con los pesos personales, calcular el contraste de luminancia de cada par en umbral: si es > ~1 %, **recalibrar ese eje**; si no, basta la reproyección.
No se itera más de una vez.

## 4. Pasos pequeños y seguros
1. ✅ `space.ts`: parámetro `w` opcional (sin cambio de comportamiento) + tests.
2. ✅ `cones.ts` + tests de predicción (protán severo `#FF0000` 0.46–0.57×; normal ≈ 1).
3. ✅ `lumweights.ts` + tests sintéticos (recuperar w conocidos con ruido; suma 1; w ≥ 0).
4. ✅ `profile.ts` v3 + migración v2 + fixtures con los JSON de Lucas (copiados a `tests/fixtures`).
5. ✅ (en `motion2.ts`) `motion.ts` nuevo motor (4 fotogramas, objetivos por tipo, QUEST, rango auto), detrás de un flag; la UI vieja sigue.
6. ✅ (en `MotionTestV2.svelte`) `motion.tsx`: refresco, seguridad, avisos de pantalla.
7. `spectrum.ts`: pesos en simulador/asistencia (signo y tope 2×).
8. `lut.ts`/`camera.tsx`: claves de caché y transforms v2.
9. Re-proyección de la calibración.
10. Quitar el flag y el código 1 Hz.

## 5. Tests
- ~~Arreglar antes `npm test` (glob inexistente, TODO §2) y llamar a `runSelfCheck`.~~ Hecho.
- Unitarios: `luminance` con w; `predictedMatch`; solver (casos degenerados: un solo match, colinealidad → regularización); QUEST converge con observador simulado (protán/deután/tritán/normal); se amplía el rango al tocar el tope; no hay pares rojo-rojo en los objetivos; siempre hay control y catch.
- Migración: v1/v2 → v3; `perfil_56KB.json` ⇒ `weights` = predicción, `legacy` conservado; `edges.v1` sigue cargando.
- Filtro: protán ⇒ `#FF0000` se oscurece en el simulador y se aclara (≤ 2×) en la asistencia; normal ⇒ identidad.
- `paintMotion`: 4 fotogramas, fase 90°, media de luminancia constante, contraste ≤ límite.

## 6. Riesgos
- Acoplamiento constant-Y (§3); `motion.ts` tiene su propia lógica de franjas (TODO §5).
- La frecuencia temporal real depende del refresco y del jank del móvil; a 7.5–15 Hz pocos fotogramas por fase.
- Los c/grado dependen de la distancia de visión (en móvil, no controlada).
- El gamut sRGB del móvil limita la saturación; con 8 bits los pasos de 1 % necesitan dithering.
- Brillo automático y True Tone invalidan la medición; no se pueden detectar desde la web, solo se puede pedir confirmación.
- Cambiar w cambia LUT/cachés/edges ya guardados.

## 7. Preguntas abiertas
**Colorado:** respondidas (ver §8).
- ~~Smith-Pokorny o Stockman-Sharpe; nm por severity~~ → SP; Machado 20 nm; no convertir severity.
- ~~Espectros de primarios~~ → sRGB nominal.
- ~~λ~~ → ≈2 matches.
- ~~Seguridad a 10 Hz~~ → Michelson ≤10 %, área ≤25 %, bloques 20–30 s.
- ~~G añadido~~ → ΔG con tope ΔE00 ≤ ~10.
- ~~Reproyectar o recalibrar~~ → criterio del contraste de luminancia > ~1 %.
- ~~Pesos deután/tritán~~ → guardar siempre; el filtro usa el estándar si están dentro del ruido.

**Lucas:**
- Repetir en interior, descansado, con brillo fijo y sin True Tone/modo noche; ¿qué dispositivo y a qué distancia?
- ¿Tolera rejillas a 10 Hz (fotosensibilidad, mareo)?
- ¿Prefiere que la asistencia aclare los rojos (hasta 2×) o solo que el simulador lo muestre?

## 8. Revisión de Colorado (25/10)
- Frecuencia = refresco/(4k): 60 Hz → 15/7.5; 90 Hz → 11.25/7.5; 120 Hz → 15/10/7.5. 10 Hz imposible a 60 Hz. Por defecto según el refresco medido; 7.5 Hz basta.
- Modelo de conos: Smith-Pokorny. Desplazamiento Machado 2009 (severity 1 = 20 nm; protán L→M, deután M→L; tritán escala S). No convertir la `severity` de la app; la predicción es solo el punto de partida y el movimiento ajusta la severidad efectiva.
- Primarios: sRGB nominales. Prior λ ≈ 2 matches.
- Seguridad: Michelson ≤ 10 %; área ≤ 25 %, nunca a pantalla completa; sin inversiones de rojo saturado a pantalla completa; bloques de 20–30 s con pausas; consentimiento previo; botón de parar visible; no afirmar cumplimiento de WCAG 2.3.1 (prueba opcional con aviso).
- Verde añadido al recortar a 2×: ΔG = (Y_objetivo − Y_recortada)/w_G, con tope ΔE00 ≤ ~10 (por ajustar).
- Reproyectar o recalibrar: contraste de luminancia personal del par en umbral > ~1 % → recalibrar ese eje.
- Deután/tritán: guardar siempre los pesos medidos (`source: measured`); si están dentro del ruido del estándar, el filtro usa el estándar pero conserva los datos.
- Confirmados: §3 (orden), pasos pequeños detrás de flag, arreglar `npm test` primero.

## 9. Decisiones de Lucas (25/10)
- Fase 1 (prioridad): solo la medición de brillo fiable con la prueba de movimiento adaptada y los pesos personales en profile.v3. El filtro de asistencia NO cambia en esta fase.
- Fase 2: el filtro de asistencia usa los pesos medidos para compensar el brillo, de modo que los colores que el usuario no distingue por longitud de onda se puedan separar por brillo y se vean más vivos de lo que percibe (con el límite de 2× y la ayuda de G de la §8).
- Lucas repetirá su perfil cuando la prueba nueva esté lista, no antes. Los JSON actuales solo son fixtures de prueba.
- 25/10: la reproyección y recalibración de umbrales (§3 puntos 3-4, paso 9) pasa a la fase 2 junto con los filtros. La fase 1 son los pasos 1-6 de §4.

## 10. Fase 1 hecha (25/10)
Pasos 1–6 implementados, un commit por paso; filtros sin cambios (los filtros siguen leyendo `luminance.matches` antiguas).
- Flag: `?motion=v2` o `localStorage["umbral-motion"]="v2"` (`?motion=v1` lo fuerza apagado). Por defecto, la prueba antigua a 1 Hz.
- `predictedMatch` = brillo relativo del test con Y estándar igualada (protán severo `#FF0000` ≈ 0.46); la ganancia que iguala es su inversa (`predictedGain`).
- Machado 20 nm ≙ dicromacia; con la plantilla de Govardovskii (picos 559/530 nm) el desplazamiento se reescala a la separación L–M (29 nm).
- Las igualaciones nuevas van a `luminance.measuredMatches` (no a `matches`, que quedan como legado 1 Hz con `legacyMatches: true`).
- Pendiente fase 2: pasos 7–9.

## 11. Ajustes de seguridad (25/10, decisión de Lucas)
- Colores de prueba a 0.65 del camino gris → borde del gamut (`SATURATION`), no en el borde (el rojo pasa a ≈ `[1, 0.21, 0.21]` lineal).
- Tope duro: contraste de Michelson en Y estándar ≤ 22 % (`MAX_MICHELSON`) en cualquier fotograma ⇒ brillo relativo e ∈ [0.639, 1.564]. Si la escalera pide más, se recorta y el color queda como cota (`bound: "at-least"`, `atLeast`, `atLeastSide`), visible en la UI («al menos» / «como mucho») y fuera del ajuste de pesos.
- Distancia de visión: 40 cm; 60 cm si la diagonal estimada > 10" (px CSS / densidad supuesta: 96 sin táctil, 150 táctil con DPR ≥ 3, 132 táctil resto). Se guarda en `luminance.viewingCm`.
- La predicción parte de severity 0.6 (`PREDICTION_SEVERITY`); el rango cubre severity 0..1 y se ensancha al tocar límites (sin pasar el tope).
- Mínimo 5 catch trials por bloque (`MIN_CATCHES_PER_BLOCK`), también en el último; > 25 % fallados ⇒ confianza baja.
- Área ≤ 25 % y bloques de 25 s sin cambios.
