// 스택 읽기 모듈: 내 스택과 상대 스택을 보고 판단에 쓰는 것들
//  - 누가 나를 커버하나(지면 탈락) / 내가 누구를 커버하나(져도 살아남음)
//  - 칩리더인가, 내 뒤에 숏스택(올인으로 받아칠 사람)·빅스택이 있나
//  - 압박 가능성: 중간 스택들은 탈락이 두려워 빅스택 상대로 넓게 접는다 → 칩리더는 넓게 오픈·3벳
//  - 위험 프리미엄: 나를 커버하는 상대의 올인에 콜하려면 칩 계산보다 승률이 조금 더 필요 (토너먼트 생존 가치)
import { AI_V3 } from '../../config';
import type { PlayerView } from '../../engine/view';
import { preflopOrder } from './context';

export interface StackRead {
  myBB: number;
  avgBB: number;
  isLeader: boolean;
  /** 아직 행동 안 한(프리플랍) 사람들 */
  behind: { seat: number; bb: number; coversMe: boolean }[];
  shortBehind: number; // 뒤에 15BB 이하
  bigBehind: number; // 뒤에 나를 커버하는 사람
  /** 칩리더 압박 여지 (0..1): 내가 크고 뒤 사람들이 중간 스택일수록 */
  pressure: number;
  notes: string[];
}

export function readStacks(view: PlayerView): StackRead {
  const bb = view.level.bb;
  const tot = (s: { stack: number; committed: number }) => (s.stack + s.committed) / bb;
  const me = view.seats.find((s) => s.seat === view.mySeat)!;
  const myBB = tot(me);
  const all = view.seats.map(tot);
  const avgBB = all.reduce((a, b) => a + b, 0) / Math.max(1, all.length);
  const isLeader = all.every((x) => x <= myBB + 1e-9);
  const ord = preflopOrder(view);
  const acted = new Set(view.actionLog.filter((a) => a.street === 'preflop' && !['ante', 'sb', 'bb'].includes(a.type)).map((a) => a.seat));
  const behind = ord
    .filter((s) => s !== view.mySeat && !acted.has(s) && view.seats.find((x) => x.seat === s)!.status === 'active')
    .filter((s) => ord.indexOf(s) > ord.indexOf(view.mySeat) || view.street === 'preflop')
    .map((s) => { const x = view.seats.find((y) => y.seat === s)!; return { seat: s, bb: tot(x), coversMe: tot(x) >= myBB }; });
  const shortBehind = behind.filter((b) => b.bb <= 15).length;
  const bigBehind = behind.filter((b) => b.coversMe).length;
  // 압박: 내가 칩리더이고, 뒤 사람들이 12~40BB(올인 받기 싫은 중간 스택)일수록
  let pressure = 0;
  if (isLeader && myBB >= avgBB * 1.3 && behind.length) {
    const mids = behind.filter((b) => b.bb >= 12 && b.bb <= 40 && !b.coversMe).length;
    pressure = Math.min(1, (mids / behind.length) * Math.min(1, (myBB / avgBB - 1)));
  }
  const notes: string[] = [];
  notes.push(`스택: 나 ${myBB.toFixed(0)}BB (평균 ${avgBB.toFixed(0)}BB${isLeader ? ', 칩리더' : ''})`);
  if (shortBehind) notes.push(`뒤에 숏스택 ${shortBehind}명(올인 받아칠 수 있음)`);
  // 다들 깊으면(60BB+) 누가 몇 칩 더 많은지는 판단에 안 씀 → 표시도 하지 않음
  if (bigBehind && !isLeader && myBB <= 60) notes.push(`뒤에 나를 커버하는 ${bigBehind}명`);
  if (pressure > 0.2) notes.push(`중간 스택 상대로 압박 가능(${Math.round(pressure * 100)}%)`);
  return { myBB, avgBB, isLeader, behind, shortBehind, bigBehind, pressure, notes };
}

/**
 * 올인 콜에 필요한 추가 승률 (토너먼트 생존). 상대가 나를 커버하면(지면 탈락) 크고, 내가 커버하면 작다.
 * 아주 짧은 스택(10BB 미만)은 어차피 승부해야 하므로 작다.
 */
export function riskPremium(view: PlayerView, villainSeat: number): number {
  const bb = view.level.bb;
  const me = view.seats.find((s) => s.seat === view.mySeat)!;
  const v = view.seats.find((s) => s.seat === villainSeat);
  if (!v) return 0;
  const myBB = (me.stack + me.committed) / bb, vBB = (v.stack + v.committed) / bb;
  const R = AI_V3.riskPremium;
  if (myBB < 10) return R.short;
  const full = R.coveredBase + R.coveredDeep * Math.min(1, (myBB - 10) / 30);
  // 내가 커버해도 지면 거의 다 잃는다면(상대가 내 스택의 절반 이상) 생존 부담은 거의 같다
  //  → 1칩 차이로 판단이 뒤집히지 않게 '지면 남는 비율'로 연속 보간 (상대 ≤ 내 절반: 0, 같음: 전부)
  if (vBB < myBB) return R.covering + (full - R.covering) * Math.max(0, Math.min(1, (vBB / myBB - 0.5) / 0.5));
  return full;
}
