// Variantes a evaluar. Cada una es una hipótesis sobre cómo acercarse al
// resultado de Vector Magic ("Ilustración con contornos suavizados, Alta,
// Colores ilimitados") y, en paralelo, a lo que necesita un taller láser.

export const VARIANTS = [
  {
    id: "default",
    label: "vtracer defaults",
    opts: {},
  },
  {
    id: "spline-stacked",
    label: "spline + capas apiladas",
    opts: { mode: "spline" },
  },
  {
    id: "cutout",
    label: "spline + mosaico sin costuras (cutout)",
    opts: { mode: "spline", hierarchical: "cutout" },
  },
  {
    id: "cutout-opt",
    label: "cutout + simplify 1.5 + optimize 2",
    opts: { mode: "spline", hierarchical: "cutout", simplify: 1.5, optimize: 2 },
  },
  {
    id: "cutout-opt-hard",
    label: "cutout + simplify 2.5 + optimize 2 (menos nodos)",
    opts: { mode: "spline", hierarchical: "cutout", simplify: 2.5, optimize: 2 },
  },
  {
    id: "cutout-pal12",
    label: "cutout + máx 12 colores (su paleta P12)",
    opts: { mode: "spline", hierarchical: "cutout", simplify: 1.5, optimize: 2, maxColors: 12 },
  },
  {
    id: "poster",
    label: "preset poster",
    opts: { preset: "poster" },
  },
  {
    id: "poster-cutout",
    label: "preset poster + cutout + simplify",
    opts: { preset: "poster", hierarchical: "cutout", simplify: 1.5, optimize: 2 },
  },
];

// Imágenes de prueba: una por categoría relevante.
export const INPUTS = [
  {
    file: "Gum Tree Vector.jpg",
    label: "Ilustración con antialiasing",
    // el caso exacto que probamos en Vector Magic
    category: "logo-aa",
    detail: 3,
    succinct: "-",
  },
  {
    file: "Cityscape Sunset_DFM3-01.jpg",
    label: "Ilustración plana / poster",
    category: "poster",
  },
  {
    file: "angel-luciano-LATYeZyw88c-unsplash-s.jpg",
    label: "Fotografía",
    category: "photo",
  },
  {
    file: "K1_drawing.jpg",
    label: "Escaneo / line art",
    category: "scan",
  },
];
