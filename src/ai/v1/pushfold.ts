// 직접 계산한 푸시/폴드 표 조회 (scripts/generate-pushfold.ts 결과, 칩 기준)
// 값 = EV(올인) − EV(폴드), BB 단위. 양수면 올인이 이득.
import data from '../../data/pushfold.json';

interface PF { keys: string[]; stacks: number[]; antes: number[]; scale: number; data: Record<string, string> }
const PFD = data as PF;
const KEY_INDEX: Record<string, number> = {};
PFD.keys.forEach((k, i) => (KEY_INDEX[k] = i));
const decoded = new Map<string, Int8Array>();

function row(ante: number, n: number, s: number): Int8Array | null {
  const id = `${ante}|${n}|${s}`;
  let r = decoded.get(id);
  if (r) return r;
  const b64 = PFD.data[id];
  if (!b64) return null;
  const bin = atob(b64);
  r = new Int8Array(bin.length);
  for (let i = 0; i < bin.length; i++) r[i] = (bin.charCodeAt(i) << 24) >> 24;
  decoded.set(id, r);
  return r;
}

const maxStack = () => PFD.stacks[PFD.stacks.length - 1];

/**
 * @param key 169 핸드 키 (예: "A9o")
 * @param behind 내 뒤에 남은 사람 수 (1 = SB 대 BB)
 * @param effBB 유효 스택 (BB)
 * @param anteBB BB 앤티 크기 (BB 단위, 0 또는 0.5)
 * @returns 올인 이득(BB). 표 범위 밖이면 null
 */
export function pushMargin(key: string, behind: number, effBB: number, anteBB: number): number | null {
  const i = KEY_INDEX[key];
  if (i === undefined || effBB > maxStack() + 0.5) return null;
  const n = Math.max(1, Math.min(9, Math.round(behind)));
  const ante = anteBB >= 0.25 ? 0.5 : 0;
  const s = Math.max(1, Math.min(maxStack(), effBB));
  const lo = Math.floor(s), hi = Math.min(maxStack(), lo + 1);
  const rl = row(ante, n, Math.max(1, lo)), rh = row(ante, n, hi);
  if (!rl || !rh) return null;
  const f = s - lo;
  return ((1 - f) * rl[i] + f * rh[i]) / PFD.scale;
}

export function hasPushTable(effBB: number) { return effBB <= maxStack() + 0.5; }
