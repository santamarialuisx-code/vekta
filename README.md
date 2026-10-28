# Vekta

Vectorizador de imágenes a vectores **que una máquina puede ejecutar**: láser, CNC,
corte de vinilo y estampado DTF.

El mercado (Vector Magic y compañía) produce SVG bonitos para pantalla. Vekta apunta a
la salida que necesita un taller: formas que no se solapen, DXF en el navegador,
unidades reales en milímetros, compensación de ancho de corte, trazado de línea central
y separación de tintas. Todo procesado **en el cliente** —la imagen nunca sale del equipo
del usuario— y sin el límite de 2 megapíxeles que imponen los servicios en la nube.

## Estado

Fase de validación. El motor de trazado se apoya en [`vtracer`](https://github.com/visioncortex/vtracer)
(MIT), que ya resuelve segmentación por color, cuantización en OKLab y ajuste de curvas
de Bézier. Lo que Vekta añade encima es la fase de limpieza y la salida orientada a
máquina.

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/competencia-vectormagic.md`](docs/competencia-vectormagic.md) | Análisis del competidor: producto, precios, arquitectura, limitaciones admitidas |
| [`docs/experimento-01-vtracer-vs-vectormagic.md`](docs/experimento-01-vtracer-vs-vectormagic.md) | Medición de vtracer contra Vector Magic y veredicto de viabilidad |
| [`docs/experimento-07-bw-adaptativo.md`](docs/experimento-07-bw-adaptativo.md) | Line art: modo binario con umbral de Otsu, F1 de tinta y por qué el adaptativo no hace falta |
| [`bench/README.md`](bench/README.md) | Banco de pruebas: cómo medir fidelidad y economía de nodos |

## Banco de pruebas

```bash
npm install
npm run bench        # genera SVGs y métricas
npm run bench:serve  # http://127.0.0.1:8787/compare.html
```

## Arquitectura prevista del motor

```
imagen
  → ¿es line art? (neutro + poca tinta) ── sí → modo binario con umbral de Otsu, un solo relleno
                                        └─ no → cuantización perceptiva en OKLab
  → trazado (vtracer: clustering de color + ajuste de Bézier)
  → limpieza de regiones (área mínima + reasignación por ΔE)
  → simplificación preservando esquinas
  → salida orientada a máquina (unión booleana, mm, DXF, kerf)
```

Lo que separa a Vekta de un trazador genérico no es el ajuste de curvas —lo hace `vtracer` y lo hace
bien—: es **decidir qué hay en la imagen** y **entregar geometría que una máquina pueda ejecutar**. Un
escaneo no necesita 16 colores para el tono del papel: necesita un relleno, y con eso desaparece el
doble corte.
