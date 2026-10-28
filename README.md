# Vekta

Vectorizador de imágenes a vectores **que una máquina puede ejecutar**: láser, CNC,
corte de vinilo y estampado DTF.

El mercado (Vector Magic y compañía) produce SVG bonitos para pantalla. Vekta apunta a
la salida que necesita un taller: formas que no se solapen, DXF en el navegador,
unidades reales en milímetros, compensación de ancho de corte, trazado de línea central
y separación de tintas. Todo procesado **en el cliente** —la imagen nunca sale del equipo
del usuario— y sin el límite de 2 megapíxeles que imponen los servicios en la nube.

## Estado

Fase de validación, con el pipeline completo medido y trece experimentos cerrados. El motor
de trazado se apoya en [`vtracer`](https://github.com/visioncortex/vtracer) (MIT), que
resuelve segmentación por color, cuantización en OKLab y ajuste de curvas de Bézier. Lo que
Vekta añade encima es la decisión de qué hay en la imagen y la salida orientada a máquina.
Lo que existe hoy:

- **Decisión automática por categoría** —ilustración, póster, foto, line art— con el preset
  que se midió para cada una; el usuario no contesta un cuestionario.
- **Dos caminos de trazado**: paleta cuantizada en OKLab con `simplify` por categoría, o modo
  binario con el umbral de Otsu de la propia imagen.
- **Muestreo subpíxel** a 3× para line art: el borde se estima donde está, no donde cae la rejilla.
- **Línea central** opcional para grabado y plotter: un recorrido por el medio del trazo, sin rellenos.
- **Salida de taller**: unión booleana por color, unidades en milímetros, kerf, entrada y salida de
  herramienta, anidado en hoja, DXF multicapa con tintas con nombre y orden de impresión, y silueta
  desde el alfa de un PNG.
- **Demo en el navegador** ([`web/`](web/README.md)): corre el wasm en el cliente, sin build y sin
  servidor propio; la imagen nunca sale del equipo.

Un vectorizador genérico entrega SVG. Vekta entrega el archivo que va a la máquina, y cada
decisión de por medio tiene una cifra medida en [`bench/`](bench/README.md).

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/README.md`](docs/README.md) | **Índice de los trece experimentos**: una línea por experimento con su hallazgo y su cifra, y el estado de lo que falta medir |
| [`docs/competencia-vectormagic.md`](docs/competencia-vectormagic.md) | Análisis del competidor: producto, precios, arquitectura, limitaciones admitidas |
| [`docs/experimento-01-vtracer-vs-vectormagic.md`](docs/experimento-01-vtracer-vs-vectormagic.md) | Medición de vtracer contra Vector Magic y veredicto de viabilidad |
| [`docs/experimento-07-bw-adaptativo.md`](docs/experimento-07-bw-adaptativo.md) | Line art: modo binario con umbral de Otsu, F1 de tinta y por qué el adaptativo no hace falta |
| [`bench/README.md`](bench/README.md) | Banco de pruebas: cómo medir fidelidad y economía de nodos |

## Demo en el navegador

```bash
npm install
npm run bench:serve   # http://127.0.0.1:8787/web/index.html
```

Arrastrar una imagen y descargar el SVG, con la decisión y las señales a la vista. Sin build, sin
backend y con una sola dependencia: el wasm de vtracer.

## Banco de pruebas

```bash
npm run bench          # barrido principal: genera SVGs y métricas
npm run bench:serve    # http://127.0.0.1:8787/compare.html
npm run bench:auto     # decide la categoría por imagen y traza con su preset
npm test               # pruebas de geometría, corte, DXF, alfa, clasificación y línea central
```

Los demás barridos (`bench:sweep`, `bench:quantize`, `bench:pipeline`, `bench:sweep2`,
`bench:geometry`, `bench:knobs`, `bench:bw`, `bench:classify`, `bench:alpha`, `bench:stroke`,
`bench:subpixel`, `bench:cut`, `bench:merge`) están en [`bench/README.md`](bench/README.md).

## Arquitectura del motor

```
imagen
  → decisión por categoría (señales de la imagen: colores, entropía, croma, neutro, tinta)
      ├─ line art → modo binario, umbral de Otsu de la imagen, un solo relleno
      └─ color    → cuantización en OKLab con la paleta de la categoría
  → trazado (vtracer: clustering + ajuste de Bézier, paleta explícita). En line art se muestrea
    ampliado y se devuelve la geometría a la rejilla: el borde se estima, no se decide al píxel
  → línea central opcional (esqueleto + RDP: un recorrido, sin rellenos)
  → unión booleana por color (cada borde una vez por capa)
  → salida de máquina: mm reales, kerf, entrada/salida de herramienta, anidado en hoja,
    DXF multicapa con tintas con nombre y orden
```

Lo que separa a Vekta de un trazador genérico no es el ajuste de curvas —lo hace `vtracer` y lo hace
bien—: es **decidir qué hay en la imagen** y **entregar geometría que una máquina pueda ejecutar**. Un
escaneo no necesita 16 colores para el tono del papel: necesita un relleno, y con eso desaparece el
doble corte.
