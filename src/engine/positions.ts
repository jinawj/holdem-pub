// 데드 버튼 방식 위치 계산 (TDA 기준 정리, overview 2.5)

export interface Positions { button: number; sb: number | null; bb: number; /** SB 자리(데드여도 좌석 번호) */ sbPos: number }
export interface PrevPositions { button: number; sbPos: number; bb: number }

function nextAlive(alive: boolean[], from: number): number {
  const n = alive.length;
  for (let i = 1; i <= n; i++) {
    const s = (from + i) % n;
    if (alive[s]) return s;
  }
  return -1;
}

/**
 * @param alive 좌석별 생존 여부 (이번 핸드 시작 시점)
 * @param prev 직전 핸드 위치 (첫 핸드면 null)
 * @param randomInt 첫 버튼용 난수 [0,n)
 */
export function computePositions(alive: boolean[], prev: PrevPositions | null, randomInt: (n: number) => number): Positions {
  const seatsAlive = alive.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
  if (seatsAlive.length < 2) throw new Error('need 2+ players');

  if (!prev) {
    const button = seatsAlive[randomInt(seatsAlive.length)];
    if (seatsAlive.length === 2) {
      const bb = nextAlive(alive, button);
      return { button, sb: button, sbPos: button, bb };
    }
    const sb = nextAlive(alive, button);
    const bb = nextAlive(alive, sb);
    return { button, sb, sbPos: sb, bb };
  }

  if (seatsAlive.length === 2) {
    // 헤즈업: 직전 핸드에서 BB가 아니었던 사람이 BB, 다른 사람이 버튼(=SB)
    let bb: number;
    if (alive[prev.bb]) bb = seatsAlive.find((x) => x !== prev.bb)!;
    else bb = nextAlive(alive, prev.bb);
    const button = seatsAlive.find((x) => x !== bb)!;
    return { button, sb: button, sbPos: button, bb };
  }

  const bb = nextAlive(alive, prev.bb);
  const sbPos = prev.bb;
  const sb = alive[sbPos] ? sbPos : null;
  const button = prev.sbPos; // 비어 있으면 데드 버튼
  return { button, sb, sbPos, bb };
}

/**
 * 같은 핸드에서 여러 명이 탈락했을 때 순위: 시작 칩이 많은 사람이 높은 순위, 같으면 공동.
 * @param remainingAfter 이 핸드 후 남은 인원
 * @returns seat → place
 */
export function rankEliminations(busted: { seat: number; startStack: number }[], remainingAfter: number): Record<number, number> {
  const sorted = [...busted].sort((a, b) => b.startStack - a.startStack);
  const out: Record<number, number> = {};
  let place = remainingAfter + 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].startStack === sorted[i - 1].startStack) out[sorted[i].seat] = out[sorted[i - 1].seat];
    else out[sorted[i].seat] = remainingAfter + 1 + i;
  }
  void place;
  return out;
}
