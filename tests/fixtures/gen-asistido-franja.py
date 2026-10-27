# Genera tests/fixtures/asistido-franja-ref.json: vectores de referencia de la Regla B (reglaB.py, validada a ciegas
# por Lucas 8/8) para el test de paridad de src/lib/color/assistband.ts.
# Uso: python3 tests/fixtures/gen-asistido-franja.py /tmp/rb.json   (rb.json = spectrumSamples() en sRGB8)
import sys, json, colorsys, numpy as np
RB_PATH_ = sys.argv[1]
sys.path.insert(0, '/workspace/parity/general'); import filtro_general as FG, reglaB as REGB
exec(open('/workspace/parity/prototipos/gen5c.py').read().split("CH=[n")[0])  # make_dots, render, s2lv, l2sv
P = json.load(open('tests/fixtures/perfil-72c787e.json')); BR = json.load(open('tests/fixtures/bordes-l-72c787e.json'))
q = REGB.PerfilB(P, BR)
def ref(u8):
    u8 = np.unique(np.asarray(u8, np.uint8).reshape(-1, 3), axis=0); c = s2lv(u8 / 255.)
    o8 = np.round(l2sv(q.filt(c)) * 255).astype(int); return [[*map(int, a), *map(int, b)] for a, b in zip(u8, o8)]
rb = json.load(open(RB_PATH_))
hsv = [[round(x * 255) for x in colorsys.hsv_to_rgb(h / 360, s, v)] for h in range(360) for s in (1, .6, .3, .12) for v in (1, .7, .45)]
clave = json.load(open('/workspace/parity/prototipos/5g/clave-SECRETA.json'))['clave']
_mn = mask_num
def mask_num(num): return np.zeros((SIZE, SIZE), np.uint8) if num is None else _mn(num)
plates = {k: ref(render(make_dots(v['numero'], v['semilla_puntos']))) for k, v in sorted(clave.items())}
out = {'fuente': 'reglaB.py (PerfilB) sobre perfil-72c787e + bordes-l-72c787e; [r,g,b, r_ref,g_ref,b_ref] en sRGB 8 bits',
       'confusionDeg': q.angulo_confusion, 'lo': q.lo, 'hi': q.hi, 'z0': q.z0, 'z1': q.z1,
       'arcoiris': ref(rb), 'hsv': ref(hsv), 'laminas5g': plates}
json.dump(out, open('tests/fixtures/asistido-franja-ref.json', 'w'), separators=(',', ':'))
print({k: len(v) for k, v in plates.items()}, len(out['hsv']))
