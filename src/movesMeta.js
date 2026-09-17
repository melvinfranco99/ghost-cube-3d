// Metadata for the 9 possible turn "faces" of a 3x3 cube: 6 outer faces + 3 middle slices.
// axis: which principal axis the layer rotates around ('x' | 'y' | 'z')
// layer: the grid coordinate (-1, 0, 1) that selects which cubies belong to the layer
// cwSign: the three.js rotation sign (right-hand rule) that corresponds to a
//         non-prime ("clockwise", standard notation) turn of that face/slice.
export const FACES = {
  R: { axis: "x", layer: 1, cwSign: -1 },
  L: { axis: "x", layer: -1, cwSign: 1 },
  M: { axis: "x", layer: 0, cwSign: 1 }, // follows L direction
  U: { axis: "y", layer: 1, cwSign: -1 },
  D: { axis: "y", layer: -1, cwSign: 1 },
  E: { axis: "y", layer: 0, cwSign: 1 }, // follows D direction
  F: { axis: "z", layer: 1, cwSign: -1 },
  B: { axis: "z", layer: -1, cwSign: 1 },
  S: { axis: "z", layer: 0, cwSign: -1 }, // follows F direction
};

const AXIS_LAYER_TO_FACE = {
  "x,1": "R",
  "x,-1": "L",
  "x,0": "M",
  "y,1": "U",
  "y,-1": "D",
  "y,0": "E",
  "z,1": "F",
  "z,-1": "B",
  "z,0": "S",
};

export function faceFromAxisLayer(axis, layer) {
  return AXIS_LAYER_TO_FACE[`${axis},${layer}`];
}

const FACE_NAMES_ES = {
  U: "superior",
  D: "inferior",
  L: "izquierda",
  R: "derecha",
  F: "frontal",
  B: "trasera",
  M: "media (entre L y R)",
  E: "ecuatorial (entre U y D)",
  S: "central (entre F y B)",
};

// Parses a move token like "R", "R'", "R2" into { face, prime, double }
export function parseMoveToken(token) {
  const face = token[0];
  const mod = token.slice(1);
  return {
    face,
    prime: mod === "'",
    double: mod === "2",
  };
}

export function describeMove(token) {
  const { face, prime, double } = parseMoveToken(token);
  const name = FACE_NAMES_ES[face] || face;
  let dir;
  if (double) dir = "180°";
  else if (prime) dir = "sentido antihorario";
  else dir = "sentido horario";
  return `Gira la capa ${name} en ${dir}`;
}

// Expands a move token into one or two single quarter-turn tokens for animation,
// e.g. "R2" -> ["R", "R"], "R'" -> ["R'"], "R" -> ["R"]
export function expandMove(token) {
  const { face, prime, double } = parseMoveToken(token);
  if (double) return [face, face];
  return [prime ? `${face}'` : face];
}
