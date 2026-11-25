/**
 * Deterministic math for the simulation.
 *
 * JavaScript engines don't agree on Math.sin, cos, atan2, exp or log to the
 * last bit (Chrome and Node already differ), and a physics run amplifies those
 * tiny differences until the same seed plays out differently in the terminal
 * and in the browser, or before and after a browser update. These versions
 * are ports of the classic fdlibm algorithms built only from + − × ÷, sqrt and
 * exact bit operations, which every engine computes identically. They are
 * accurate to about one unit in the last place.
 *
 * Use them in src/engine/ (and scripts); the renderer can keep using Math.
 */

const view = new DataView(new ArrayBuffer(8));
const hiWord = (x: number): number => {
  view.setFloat64(0, x);
  return view.getInt32(0);
};
const withHiWord = (x: number, hi: number): number => {
  view.setFloat64(0, x);
  view.setInt32(0, hi);
  return view.getFloat64(0);
};
/** x · 2^k, exact. */
function scalbn(x: number, k: number): number {
  while (k > 1023) {
    x *= 8.98846567431158e307; // 2^1023
    k -= 1023;
  }
  while (k < -1022) {
    x *= 2.2250738585072014e-308; // 2^-1022
    k += 1022;
  }
  view.setInt32(0, (k + 1023) << 20);
  view.setInt32(4, 0);
  return x * view.getFloat64(0);
}

// ---- sin / cos ---------------------------------------------------------------------

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

/** sin on [-π/4, π/4]; y is the tail of x. */
function ksin(x: number, y: number): number {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return y === 0 ? x + v * (S1 + z * r) : x - (z * (0.5 * y - v * r) - y - v * S1);
}
/** cos on [-π/4, π/4]. */
function kcos(x: number, y: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  return 1 - (0.5 * z - (z * r - x * y));
}

const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21;
const PIO2_3T = 8.47842766036889956997e-32;

/** x = n·π/2 + (y0 + y1), |y0| ≤ π/4. (Cody–Waite, three-part π/2; fine for |x| up to ~1e9.) */
function reduce(x: number): [number, number, number] {
  const n = Math.floor(x * INV_PIO2 + 0.5);
  let r = x - n * PIO2_1;
  let t = r;
  let w = n * PIO2_2; // (PIO2_1T is split into PIO2_2 + PIO2_2T for the second round)
  r = t - w;
  w = n * PIO2_2T - (t - r - w);
  t = r;
  w = n * PIO2_3;
  r = t - w;
  w = n * PIO2_3T - (t - r - w);
  const y0 = r - w;
  const y1 = r - y0 - w;
  return [n, y0, y1];
}

export function sin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) <= 0.7853981633974483) return ksin(x, 0);
  const [n, a, b] = reduce(x);
  switch (((n % 4) + 4) % 4) {
    case 0:
      return ksin(a, b);
    case 1:
      return kcos(a, b);
    case 2:
      return -ksin(a, b);
    default:
      return -kcos(a, b);
  }
}

export function cos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) <= 0.7853981633974483) return kcos(x, 0);
  const [n, a, b] = reduce(x);
  switch (((n % 4) + 4) % 4) {
    case 0:
      return kcos(a, b);
    case 1:
      return -ksin(a, b);
    case 2:
      return -kcos(a, b);
    default:
      return ksin(a, b);
  }
}

export function tan(x: number): number {
  return sin(x) / cos(x);
}

// ---- atan / atan2 ------------------------------------------------------------------

const ATANHI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.570796326794896558];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.1111110405462355788e-1, 9.09088713343650656196e-2, -7.69187620504482999495e-2,
  6.66107313738753120669e-2, -5.83357013379057348645e-2, 4.97687799461593236017e-2, -3.6531572744216915527e-2, 1.62858201153657823623e-2,
];

export function atan(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const sign = x < 0 ? -1 : 1;
  let ax = Math.abs(x);
  if (ax >= 7.378697629483821e19) return sign * (ATANHI[3] + ATANLO[3]); // 2^66
  let id: number;
  if (ax < 0.4375) {
    if (ax < 1.862645149230957e-9) return x; // 2^-29
    id = -1;
  } else if (ax < 1.1875) {
    if (ax < 0.6875) {
      id = 0;
      ax = (2 * ax - 1) / (2 + ax);
    } else {
      id = 1;
      ax = (ax - 1) / (ax + 1);
    }
  } else if (ax < 2.4375) {
    id = 2;
    ax = (ax - 1.5) / (1 + 1.5 * ax);
  } else {
    id = 3;
    ax = -1 / ax;
  }
  const z = ax * ax;
  const w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return sign * (ax - ax * (s1 + s2));
  return sign * (ATANHI[id] - (ax * (s1 + s2) - ATANLO[id] - ax));
}

const PI = 3.1415926535897931160;
const PI_LO = 1.2246467991473531772e-16;

export function atan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === 1) return atan(y);
  if (y === 0) {
    if (x > 0 || Object.is(x, 0)) return y; // ±0
    return Object.is(y, -0) ? -PI : PI;
  }
  if (x === 0) return y > 0 ? PI / 2 : -PI / 2;
  const ratio = Math.abs(y / x);
  let z: number;
  if (ratio > 1.152921504606847e18)
    z = PI / 2 + 0.5 * PI_LO; // |y/x| > 2^60
  else if (x < 0 && ratio < 8.673617379884035e-19)
    z = 0; // |y/x| < 2^-60
  else z = atan(ratio);
  if (x > 0) return y > 0 ? z : -z;
  return y > 0 ? PI - (z - PI_LO) : z - PI_LO - PI;
}

// ---- exp / log / pow ---------------------------------------------------------------

const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.442695040888963387;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.6533902205465251539e-6;
const P5 = 4.13813679705723846039e-8;

export function exp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  const ax = Math.abs(x);
  let hi = 0;
  let lo = 0;
  let k = 0;
  if (ax > 0.34657359027997264) {
    // |x| > ln2/2: reduce to x = k·ln2 + r.
    k = ax < 1.0397207708399179 ? (x > 0 ? 1 : -1) : Math.trunc(INV_LN2 * x + (x > 0 ? 0.5 : -0.5));
    hi = x - k * LN2_HI;
    lo = k * LN2_LO;
    x = hi - lo;
  } else if (ax < 3.725290298461914e-9) {
    return 1 + x; // 2^-28
  }
  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  const y = 1 - (lo - (x * c) / (2 - c) - hi);
  return scalbn(y, k);
}

const LG1 = 6.666666666666735130e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;

export function log(x: number): number {
  if (Number.isNaN(x) || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let k = 0;
  let hx = hiWord(x);
  if (hx < 0x00100000) {
    // subnormal
    k -= 54;
    x *= 18014398509481984; // 2^54
    hx = hiWord(x);
  }
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  const i0 = (hx + 0x95f64) & 0x100000;
  x = withHiWord(x, hx | (i0 ^ 0x3ff00000)); // normalize x or x/2
  k += i0 >> 20;
  const f = x - 1;
  const dk = k;
  if ((0x000fffff & (2 + hx)) < 3) {
    // |f| < 2^-20
    if (f === 0) return k === 0 ? 0 : dk * LN2_HI + dk * LN2_LO;
    const R = f * f * (0.5 - 0.33333333333333333 * f);
    return k === 0 ? f - R : dk * LN2_HI - (R - dk * LN2_LO - f);
  }
  const s = f / (2 + f);
  const z = s * s;
  let i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    return k === 0 ? f - (hfsq - s * (hfsq + R)) : dk * LN2_HI - (hfsq - (s * (hfsq + R) + dk * LN2_LO) - f);
  }
  return k === 0 ? f - s * (f - R) : dk * LN2_HI - (s * (f - R) - dk * LN2_LO - f);
}

/** x^y for x > 0 (via exp/log; deterministic, a few ulp). Integer powers: use ipow. */
export function pow(x: number, y: number): number {
  if (y === 0) return 1;
  if (x === 0) return 0;
  return exp(y * log(x));
}

/** x^n for whole n, by repeated squaring (exact rounding order, deterministic). */
export function ipow(x: number, n: number): number {
  let e = Math.abs(Math.trunc(n));
  let base = x;
  let r = 1;
  while (e > 0) {
    if (e & 1) r *= base;
    base *= base;
    e >>= 1;
  }
  return n < 0 ? 1 / r : r;
}

/** √(x² + y²). (sqrt is exact in every engine; Math.hypot is not guaranteed to be.) */
export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function asin(x: number): number {
  return atan2(x, Math.sqrt((1 - x) * (1 + x)));
}

export function acos(x: number): number {
  return atan2(Math.sqrt((1 - x) * (1 + x)), x);
}
