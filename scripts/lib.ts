// 스크립트 공용 도구
import { Rng, cryptoSeed, seedToString, seedFromNumber } from '../src/engine/rng';

export function arg(name: string, def: string): string {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
export const flag = (name: string) => process.argv.includes('--' + name);

export function makeRng(seed?: number) {
  const r = new Rng(seed !== undefined ? seedFromNumber(seed) : cryptoSeed());
  return {
    rand: () => r.next(),
    int: (n: number) => r.int(n),
    seedStr: () => seedToString([r.nextU32() || 1, r.nextU32(), r.nextU32(), r.nextU32()]),
  };
}

export function mean(a: number[]) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
export function pctile(a: number[], q: number) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }
export function sd(a: number[]) { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); }

export function table(rows: (string | number)[][], header: string[]) {
  const all = [header, ...rows.map((r) => r.map((c) => (typeof c === 'number' ? (Number.isInteger(c) ? String(c) : c.toFixed(1)) : c)))];
  const w = header.map((_, i) => Math.max(...all.map((r) => strWidth(String(r[i] ?? '')))));
  return all.map((r, ri) => r.map((c, i) => pad(String(c), w[i])).join(' | ') + (ri === 0 ? '\n' + w.map((x) => '-'.repeat(x)).join('-|-') : '')).join('\n');
}
function strWidth(s: string) { let w = 0; for (const ch of s) w += /[ㄱ-힝]/.test(ch) ? 2 : 1; return w; }
function pad(s: string, w: number) { return s + ' '.repeat(Math.max(0, w - strWidth(s))); }
