import { CHIP_UNIT } from '../config';

export interface Contribution { seat: number; total: number; folded: boolean }
export interface Pot { amount: number; eligible: number[] }

/**
 * 사이드팟 계산. total = 앤티 제외 라이브 칩. antePot은 메인 팟에 더한다(모두가 다툼).
 * 폴드한 사람의 칩은 팟에 남지만 자격은 없다.
 */
export function computePots(contribs: Contribution[], antePot = 0): Pot[] {
  const remaining = contribs.map((c) => ({ ...c }));
  const pots: Pot[] = [];
  let guard = 0;
  while (remaining.some((c) => c.total > 0) && guard++ < 100) {
    const live = remaining.filter((c) => !c.folded && c.total > 0);
    let level: number;
    if (live.length === 0) {
      level = Math.max(...remaining.map((c) => c.total));
    } else {
      level = Math.min(...live.map((c) => c.total));
    }
    let amount = 0;
    for (const c of remaining) {
      const take = Math.min(c.total, level);
      amount += take;
      c.total -= take;
    }
    const eligible = live.map((c) => c.seat);
    // 자격자가 같으면 이전 팟에 합친다
    const prev = pots[pots.length - 1];
    if (prev && sameSet(prev.eligible, eligible)) prev.amount += amount;
    else if (eligible.length === 0 && prev) prev.amount += amount;
    else pots.push({ amount, eligible });
  }
  if (pots.length === 0) pots.push({ amount: 0, eligible: contribs.filter((c) => !c.folded).map((c) => c.seat) });
  pots[0].amount += antePot;
  return pots;
}

function sameSet(a: number[], b: number[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/**
 * 팟 분할. 남는 칩(CHIP_UNIT 단위)은 버튼 왼쪽에 가장 가까운 승자부터 한 단위씩.
 * orderFromButton: 버튼 왼쪽 첫 자리부터 시계 방향 좌석 순서.
 */
export function splitPot(amount: number, winners: number[], orderFromButton: number[]): { seat: number; amount: number }[] {
  const sorted = [...winners].sort((a, b) => orderFromButton.indexOf(a) - orderFromButton.indexOf(b));
  const n = sorted.length;
  const units = Math.floor(amount / CHIP_UNIT);
  const odd = amount - units * CHIP_UNIT; // 단위 미만 자투리(정상적으로는 0)
  const base = Math.floor(units / n);
  let extra = units - base * n;
  return sorted.map((seat, i) => {
    let a = base * CHIP_UNIT;
    if (extra > 0) { a += CHIP_UNIT; extra--; }
    if (i === 0) a += odd;
    return { seat, amount: a };
  });
}
