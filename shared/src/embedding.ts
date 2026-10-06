/**
 * Semantic similarity helpers. Vectors are L2-normalised and stored as signed 8-bit integers (1 byte per dimension: a 1024-d vector is 1 KB),
 * which keeps cosine accurate to ~1% while making match computation over thousands of rows cheap.
 */
export type QVec = Int8Array;

/** Typical cosine for a CV vs a job text with multilingual sentence models: unrelated ≈ 0.35, strongly related ≈ 0.75+. Tunable. */
export const SEMANTIC_FLOOR = 0.35;
export const SEMANTIC_RANGE = 0.4;

export function quantize(v: ArrayLike<number>): QVec | null {
  let n = 0;
  for (let i = 0; i < v.length; i++) { const x = v[i]; if (!Number.isFinite(x)) return null; n += x * x; }
  if (n === 0 || v.length === 0 || v.length > 4096) return null;
  const inv = 127 / Math.sqrt(n);
  const out = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = Math.max(-127, Math.min(127, Math.round(v[i] * inv)));
  return out;
}

/** Cosine of two quantised vectors; 0 when shapes differ or either is all-zero (never NaN). */
export function cosineQ(a: QVec | null | undefined, b: QVec | null | undefined): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? Math.max(-1, Math.min(1, dot / Math.sqrt(na * nb))) : 0;
}

export const semanticScore = (cos: number) => Math.max(0, Math.min(1, (cos - SEMANTIC_FLOOR) / SEMANTIC_RANGE));

/** bytea (Buffer) → Int8Array view without copying semantics surprises. */
export const fromBytes = (b: Uint8Array | null | undefined): QVec | null => (b && b.length ? new Int8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) : null);
