"""Prepara las imágenes de marca de la portada (WebP + JPG de respaldo).

Uso: python3 scripts/marca-imagenes.py /ruta/portada-umbral.jpg /ruta/cabecera-umbral.jpg
Necesita numpy, scipy y pillow. Proceso automático (sin retoque a mano):
  1. Puntos (componentes conexas) más grandes que 1,5× la mediana o con luminancia fuera de ±25 %
     de la mediana: su luminancia se iguala a la mediana, para que ninguno destaque ni insinúe figuras.
  2. El punto rojo de la izquierda (componente más saturada en rojo) gana luminancia y un borde claro.
  3. La imagen se atenúa (fondo) y se exporta en un tamaño razonable.
El texto de la marca (crema, poco saturado) no se toca.
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

OUT = "public/marca"


def process(path: str, width: int, name: str, red: bool):
    im = Image.open(path).convert("RGB")
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32) / 255
    lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    Y = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    mx, mn = a.max(2), a.min(2)
    sat = (mx - mn) / np.maximum(mx, 1e-6)
    dots = (Y > 0.02) & (sat > 0.18)
    lab, n = ndimage.label(dots)
    idx = np.arange(1, n + 1)
    area = ndimage.sum(np.ones_like(Y), lab, idx)
    meanY = ndimage.mean(Y, lab, idx)
    big = area > 8
    medA, medY = np.median(area[big]), np.median(meanY[big])
    out = lin.copy()
    fix = big & ((area > 1.5 * medA) | (meanY < 0.75 * medY) | (meanY > 1.25 * medY))
    # Rojo: componente con más (R − G) media entre las de la mitad izquierda.
    r_g = ndimage.mean(a[..., 0] - a[..., 1], lab, idx)
    cx = np.array([c[1] for c in ndimage.center_of_mass(dots, lab, idx)])
    red_ids = []
    if red:
        cand = np.where(big & (cx < a.shape[1] * 0.45) & (r_g > 0.25))[0]
        red_ids = list(cand[np.argsort(-r_g[cand])][:3] + 1)
    gain = np.ones(n + 1, dtype=np.float32)
    gain[1:][fix] = medY / np.maximum(meanY[fix], 1e-6)
    for i in red_ids:
        gain[i] = max(1.0, 1.6 * medY / meanY[i - 1])
    if red:
        gain[1:][big & (area > 1.5 * medA)] = np.minimum(gain[1:][big & (area > 1.5 * medA)], 0.45)
        for i in red_ids:
            gain[i] = max(1.0, 1.6 * medY / meanY[i - 1])
    out *= gain[lab][..., None]
    for i in red_ids:
        m = lab == i
        ring = ndimage.binary_dilation(m, iterations=2) & ~m
        out[ring] = out[ring] * 0.3 + np.array([0.85, 0.80, 0.72]) * 0.7
    out = np.clip(out, 0, 1)
    srgb = np.where(out <= 0.0031308, out * 12.92, 1.055 * out ** (1 / 2.4) - 0.055)
    img = Image.fromarray((np.clip(srgb, 0, 1) * 255 + 0.5).astype(np.uint8))
    img.save(f"{OUT}/{name}.webp", quality=78, method=6)
    img.save(f"{OUT}/{name}.jpg", quality=80, optimize=True, progressive=True)
    print(name, img.size, f"puntos={int(big.sum())} igualados={int(fix.sum())} rojo={red_ids}")


if __name__ == "__main__":
    process(sys.argv[1], 1600, "portada", True)
    process(sys.argv[2], 1600, "cabecera", True)
