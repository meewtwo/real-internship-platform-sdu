import { describe, expect, it } from 'vitest';
import { SEMANTIC_FLOOR, SEMANTIC_RANGE, cosineQ, fromBytes, matchScore, quantize, semanticScore, type StudentSignal, type VacancySignal } from '../src';

let seed = 5; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 - 0.5; };
const rand = (n: number) => Array.from({ length: n }, rnd);
const float = (a: number[], b: number[]) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2; } return d / Math.sqrt(x * y); };

describe('quantize / cosineQ', () => {
  it('stays within ±127, is scale-invariant and rejects unusable vectors', () => {
    const q = quantize([3, -4, 0])!;
    expect(Array.from(q)).toEqual([76, -102, 0]);
    expect(Array.from(quantize([30, -40, 0])!)).toEqual(Array.from(q));
    for (const bad of [[], [0, 0, 0], [NaN, 1], [Infinity, 1], [1, -Infinity], Array(4097).fill(1)]) expect(quantize(bad), JSON.stringify(bad).slice(0, 20)).toBeNull();
  });
  it('cosine is symmetric, bounded, 1 for identical, -1 for opposite and 0 for mismatched shapes (never NaN)', () => {
    const a = quantize(rand(64))!, b = quantize(rand(64))!;
    expect(cosineQ(a, a)).toBeCloseTo(1, 6);
    expect(cosineQ(a, b)).toBeCloseTo(cosineQ(b, a), 12);
    expect(cosineQ(a, new Int8Array(a.map((x) => -x)))).toBeCloseTo(-1, 6);
    expect(cosineQ(a, quantize(rand(32)))).toBe(0);
    expect(cosineQ(a, new Int8Array(64))).toBe(0);
    expect(cosineQ(null, a)).toBe(0); expect(cosineQ(a, undefined)).toBe(0); expect(cosineQ(new Int8Array(0), new Int8Array(0))).toBe(0);
  });
  it('quantisation error is small: |cosineQ − cosine| < 0.02 over 400 random 256-d pairs, including correlated ones', () => {
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      const a = rand(256), noise = rand(256), mix = i % 2 ? 0.2 : 2;
      const b = a.map((x, j) => x + noise[j] * mix);
      worst = Math.max(worst, Math.abs(cosineQ(quantize(a), quantize(b)) - float(a, b)));
    }
    expect(worst).toBeLessThan(0.02);
  });
  it('fromBytes round-trips a Buffer view (including non-zero byteOffset)', () => {
    const q = quantize(rand(16))!;
    const big = new Uint8Array(64); big.set(new Uint8Array(q.buffer), 10);
    expect(Array.from(fromBytes(big.subarray(10, 26))!)).toEqual(Array.from(q));
    expect(fromBytes(null)).toBeNull(); expect(fromBytes(new Uint8Array(0))).toBeNull();
  });
});

describe('semanticScore', () => {
  it('maps cosine to 0–1 monotonically with a floor and a ceiling', () => {
    expect(semanticScore(SEMANTIC_FLOOR)).toBe(0);
    expect(semanticScore(-1)).toBe(0);
    expect(semanticScore(SEMANTIC_FLOOR + SEMANTIC_RANGE)).toBe(1);
    expect(semanticScore(1)).toBe(1);
    let prev = -1;
    for (let c = -1; c <= 1; c += 0.01) { const s = semanticScore(c); expect(s).toBeGreaterThanOrEqual(prev); expect(s >= 0 && s <= 1).toBe(true); prev = s; }
  });
});

describe('matchScore uses meaning only when both sides have comparable vectors', () => {
  const s = (vec?: Int8Array | null): StudentSignal => ({ skills: ['Python'], cvSkills: [], interests: [], cvText: 'машинное обучение нейросети', majorKey: 'computer_science', interestArea: 'data_ai', city: 'almaty', cityOther: null, relocation: 'yes', gpa: 3.5, experienceYears: 0, vec });
  const v = (vec?: Int8Array | null): VacancySignal => ({ title: 'Machine learning engineer', description: 'Build neural networks', requiredSkills: ['Python'], industry: 'it_software', city: 'almaty', cityOther: null, workFormat: 'onsite', minGpa: null, vec });
  const same = quantize([1, 0, 0, 0])!, close = quantize([0.9, 0.1, 0, 0])!, orth = quantize([0, 1, 0, 0])!, other = quantize([1, 0, 0])!;
  it('lexical by default and whenever a vector is missing or shapes differ', () => {
    for (const [a, b] of [[undefined, undefined], [same, undefined], [undefined, same], [null, null], [same, other]] as const) expect(matchScore(s(a), v(b)).textSource).toBe('lexical');
  });
  it('semantic when both present: text sub-score = semanticScore(cosine); unrelated → 0, near-identical → ~1', () => {
    expect(matchScore(s(same), v(same))).toMatchObject({ textSource: 'semantic', text: 1 });
    expect(matchScore(s(same), v(orth))).toMatchObject({ textSource: 'semantic', text: 0 });
    const m = matchScore(s(same), v(close));
    expect(m.text).toBe(Math.round(semanticScore(cosineQ(same, close)) * 100) / 100);
  });
  it('a better semantic match never lowers the percent; the other sub-scores are untouched', () => {
    const hi = matchScore(s(same), v(same)), lo = matchScore(s(same), v(orth));
    expect(hi.percent).toBeGreaterThan(lo.percent);
    expect([hi.skill, hi.fit, hi.location]).toEqual([lo.skill, lo.fit, lo.location]);
  });
});
