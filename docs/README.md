# Vekta — índice de experimentos

Quince experimentos sobre el mismo banco de cuatro imágenes, más el análisis del competidor. Cada
línea es una pregunta cerrada con una cifra; el documento enlazado tiene el método, las tablas
completas y lo que ese experimento **no** prueba.

| experimento | pregunta | respuesta en una línea | cifra |
|---|---|---|---|
| [01 — vtracer vs Vector Magic](experimento-01-vtracer-vs-vectormagic.md) | ¿está vtracer a la altura del competidor? | La geometría sí; el acabado no: halos de antialiasing, regiones de bajo contraste que se traga y 2–3× nodos. | SSIM 0,9483 con 10 817 nodos |
| [02 — salida cortable](experimento-02-salida-cortable.md) | ¿se puede entregar una salida cortable? | Por capas sí (0–7 % de exceso); en una sola pasada el doble corte es real y medible. | `R/U` 1,90–2,19 en 32 de 32 archivos |
| [03 — cuantización](experimento-03-cuantizacion.md) | ¿arregla la cuantización el acabado? | Sí, por dos vías: menos nodos y las nubes de vuelta. Los halos eran de paleta, no de regiones. | −8 % a −37 % de nodos; nubes 98,5 % intactas |
| [04 — calibración](experimento-04-calibracion.md) | ¿se cumple «mitad de nodos, misma percepción»? | En ilustración y póster; en foto y line art el presupuesto de SSIM se agota antes. | −52 % en ilustración (ΔSSIM −0,004), −27 % en line art |
| [05 — geometría](experimento-05-geometria.md) | ¿se cierra el hueco con parámetros? | No: las perillas mueven +0,0001 a +0,0002. El hueco restante es de motor. | 0,0325 de SSIM frente al render real de Vector Magic |
| [06 — DXF y kerf](experimento-06-dxf-kerf.md) | ¿hay milímetros, DXF y compensación de corte? | Sí: ancho físico real, DXF R2000 en el navegador y compensación al radio de la herramienta. | Cuadrado de 10 mm → 10,2 mm de trayectoria con kerf 0,2 |
| [07 — modo binario](experimento-07-bw-adaptativo.md) | ¿se arregla el line art sin tocar el motor? | Sí: binario con el Otsu de la propia imagen. El umbral adaptativo de Bradley–Roth pierde. | 174 451 nodos y 28 rellenos → 17 749 y 1; F1 0,9436 |
| [08 — clasificación](experimento-08-clasificacion.md) | ¿quién elige el preset? | La imagen: cascada de umbrales con motivo, no un clasificador. | 4 de 4 imágenes a su preset del experimento 04 |
| [09 — línea central](experimento-09-linea-central.md) | ¿cuánto recorre un grabador? | El contorno pasa dos veces; la cresta una sola, y sin rellenos. | 196 796 → 114 956 px (−41,6 %) |
| [10 — producción](experimento-10-produccion.md) | ¿es un archivo de taller o una demo? | De taller: entrada y salida de herramienta, anidado en hoja y tintas con nombre y orden. | 311,326 → 315,326 mm con 2 mm de entrada; 22 pruebas |
| [11 — alfa](experimento-11-alfa.md) | ¿sirve el alfa como línea de corte? | Sí: con fondo transparente la silueta deja de ser el rectángulo del lienzo. | Perímetro +0,16 %; la pieza es 44,2 % del lienzo |
| [12 — subpíxel](experimento-12-subpixel.md) | ¿dónde está el borde? | En el subpíxel: trazar a 3× compra F1 y el preset se queda en 3× / 1,2; a 4× ya no se paga. | F1 0,9436 → 0,9670 con 31 500 nodos (preset); techo 0,9773 a 3× sin simplificar |
| [13 — paridad en foto](experimento-13-vectormagic-foto.md) | ¿el hueco de 0,032 es estructural? | Depende de la categoría: en foto se multiplica por cinco y ahí sí es de modelo. | Hueco 0,1574 en foto, 0,0154 en póster, 0,0457 en ilustración |
| [14 — fidelidad en color](experimento-14-fidelidad-color.md) | ¿se cierra el hueco con muestreo o paleta? | Ni una ni otra: es el ajuste de curvas. Trazando píxel a píxel se alcanza al competidor. | SSIM 0,9351 → 0,9776 (ilustración), 0,9518 → 0,9631 (póster), 0,6693 → 0,8365 (foto, por encima de VM) |
| [15 — reajuste de curvas](experimento-15-reajuste-curvas.md) | ¿se puede tener la fidelidad del píxel con curvas? | Sí: píxel + Béziers encima, que es la arquitectura de Vector Magic. A 3× es el único modo que aguanta el zoom. | 0,9766 con 11 527 nodos (el píxel pide 64 036); póster y foto superan al píxel |
| [Competencia — Vector Magic](competencia-vectormagic.md) | ¿qué hace el competidor y dónde falla? | Producto maduro y estrecho: la calidad está en el cuestionario, no en un algoritmo inalcanzable. | 7,99 USD/mes web, 295 USD escritorio, 2 MP; DXF solo en escritorio |

## El hilo, en cinco pasos

1. **El hueco (01).** vtracer reproduce composición, paleta y formas. Lo que falla es acabado:
   contornos con temblor, halos y densidad de nodos. El veredicto fija la arquitectura:
   cuantizar antes de trazar, no aplastar colores.
2. **El corte (02, 06).** Medido el doble corte —`R/U` cerca de 2,0, el 48 % del recorrido
   repetido—, la respuesta no es unir mejor los bordes, es preguntar para qué se corta: capas por
   color, silueta, y las transformaciones de taller (mm, kerf, DXF).
3. **El color (03, 04, 05).** La cuantización en OKLab devuelve las nubes y quita nodos; la paleta
   y el `simplify` se eligen por categoría; y el hueco que queda —0,0325— no se mueve con ninguna
   perilla. Es motor.
4. **La decisión (07, 08).** El line art no era un problema de color ni de `simplify`: era otro modo
   del motor. Con la vara correcta (F1 de tinta) el binario gana, y la imagen —no el usuario— elige
   el preset.
5. **La máquina (09, 10, 11, 12, 13).** Lo que falta para que el archivo salga del taller: cresta en
   vez de contorno, entrada y anidado, alfa como frontera de pieza, muestreo subpíxel en line art, y
   el mapa de dónde duele de verdad frente al competidor (foto).
6. **La fidelidad (14, 15).** En color el hueco no era muestreo ni paleta: era el ajuste de curvas.
   Con píxel a píxel se alcanza al competidor, y ajustando curvas subpíxel sobre esas etiquetas se
   tiene la fidelidad del píxel con 5,6× menos nodos: 0,9766 con 11 527 en ilustración.

## Cómo se mide

- **SSIM** sobre luminancia, ventanas 8×8, comparando el SVG rasterizado contra el original. Premia
  fidelidad de píxel, no calidad de curva: se lee siempre junto al número de nodos.
- **F1 de la máscara de tinta**, píxel oscuro del render contra píxel oscuro del original, cortados
  en el umbral de Otsu de la imagen. Es la vara de un grabado; en una imagen de color no avisa.
- **Nodos**: comandos de dibujo del atributo `d`, sin `Z` y contando cada `C` como uno.
- **Longitudes de corte** (`R`, `L`, `E`, `U`): contorno crudo, unión por capa, silueta y recorrido
  único. La definición y la cuenta están en [`../bench/README.md`](../bench/README.md).

## Lo que queda pendiente de medir

Dicho aquí para que nadie cite como resultado lo que es una línea de trabajo:

- **Línea central (09)**: SSIM y F1 no son comparables con los del experimento 07 —un camino de 1 px
  no cubre una máscara de 3 px— y falta una vara propia.
- **Subpíxel (12)**: probar el muestreo en el pipeline de color, que es donde el hueco de 0,032 está
  medido contra Vector Magic, y medir más de un line art: el preset 3× / 1,2 se sostiene con una sola
  imagen.
- **Clasificación (08)**: los umbrales se eligieron con cuatro imágenes; falta un banco mayor antes
  de llamarlo precisión. Cualquier porcentaje de acierto sobre estas cuatro sería circular.
- **Foto (13)**: una sola foto sostiene la conclusión de la categoría más cara de cerrar.
- **Alfa (11)**: el fixture es sintético; falta un PNG real con sombras y bordes suaves.
- **Fidelidad de color (14, 15)**: la foto sigue costando 153 641 nodos en modo refit (367 032 en
  píxel): falta el presupuesto tonal adaptativo. `refit` ya es el modo por defecto de la entrega de
  color; `curvas` queda para cortar.

## Errata

El PR de la medición de paridad con Vector Magic (experimento 13) dice **«#32»** en su cuerpo y en
su mensaje de commit. El issue real era el **#38**, cerrado a mano con esa nota. «#32» es la puerta
automática de pruebas, otro trabajo.
