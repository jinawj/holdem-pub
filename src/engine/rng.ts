// 난수: 시드는 crypto.getRandomValues(암호학적 난수)로 만들고,
// 셔플은 그 시드로 초기화한 xoshiro128** 로 한다 → 시드만 기록하면 핸드 재현 가능.
// Math.random 사용 금지.

export type Seed = [number, number, number, number];

export function cryptoSeed(): Seed {
  const a = new Uint32Array(4);
  globalThis.crypto.getRandomValues(a);
  if (a[0] === 0 && a[1] === 0 && a[2] === 0 && a[3] === 0) a[0] = 1;
  return [a[0], a[1], a[2], a[3]];
}

export function seedToString(s: Seed): string {
  return s.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

export function seedFromString(str: string): Seed {
  const s: number[] = [];
  for (let i = 0; i < 4; i++) s.push(parseInt(str.slice(i * 8, i * 8 + 8), 16) >>> 0);
  return s as Seed;
}

/** 숫자 하나로 시드 만들기 (테스트·듀플리케이트용) */
export function seedFromNumber(n: number): Seed {
  let x = (n * 2654435761) >>> 0 || 1;
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    out.push(x >>> 0 || 1);
  }
  return out as Seed;
}

export class Rng {
  private s: Uint32Array;
  constructor(seed: Seed) {
    this.s = new Uint32Array(seed);
  }
  nextU32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }
  /** [0,1) */
  next(): number {
    return this.nextU32() / 4294967296;
  }
  /** [0, n) 정수, 편향 없이 */
  int(n: number): number {
    const limit = Math.floor(4294967296 / n) * n;
    let x: number;
    do x = this.nextU32(); while (x >= limit);
    return x % n;
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** 암호학적 난수로 [0,n) 정수 하나 (버튼 위치 등) */
export function cryptoInt(n: number): number {
  const a = new Uint32Array(1);
  const limit = Math.floor(4294967296 / n) * n;
  do globalThis.crypto.getRandomValues(a); while (a[0] >= limit);
  return a[0] % n;
}

export function shuffleInPlace<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
