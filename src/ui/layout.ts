// 좌석 배치: 인원수 + 테이블 영역 크기 → 긴 타원(스타디움) 둘레에 같은 간격 (overview 1.3)
// 내 자리(좌석 0)는 항상 하단 중앙. 화면에서 시계 방향 = 아래 → 왼쪽 → 위 → 오른쪽.
// 가로 화면 → 가로로 긴 테이블, 세로 화면 → 세로로 긴 테이블.
export interface Pt { x: number; y: number }

export interface Geometry {
  w: number; h: number; portrait: boolean;
  cx: number; cy: number;
  /** 좌석이 놓이는 스타디움 반폭·반높이 */
  sa: number; sb: number; seatW: number;
  /** 펠트(테이블) 사각형 */
  felt: { l: number; t: number; w: number; h: number };
  seats: Pt[];
  center: Pt; // 보드·팟 중심 (= 딜러 자리, 카드가 나오는 곳)
}

type Seg = { len: number; at: (u: number) => Pt };

function stadiumSegments(cx: number, cy: number, a: number, b: number): Seg[] {
  const arc = (ox: number, oy: number, r: number, a0: number, a1: number): Seg => ({
    len: Math.abs(a1 - a0) * r,
    at: (u) => { const t = a0 + (a1 - a0) * u; return { x: ox + r * Math.cos(t), y: oy + r * Math.sin(t) }; },
  });
  const line = (p: Pt, q: Pt): Seg => ({ len: Math.hypot(q.x - p.x, q.y - p.y), at: (u) => ({ x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u }) });
  const P = Math.PI;
  if (a >= b) {
    const L = a - b; // 직선 반길이
    return [
      line({ x: cx, y: cy + b }, { x: cx - L, y: cy + b }),
      arc(cx - L, cy, b, P / 2, (3 * P) / 2),
      line({ x: cx - L, y: cy - b }, { x: cx + L, y: cy - b }),
      arc(cx + L, cy, b, (3 * P) / 2, (5 * P) / 2),
      line({ x: cx + L, y: cy + b }, { x: cx, y: cy + b }),
    ];
  }
  const L = b - a;
  return [
    arc(cx, cy + L, a, P / 2, P),
    line({ x: cx - a, y: cy + L }, { x: cx - a, y: cy - L }),
    arc(cx, cy - L, a, P, 2 * P),
    line({ x: cx + a, y: cy - L }, { x: cx + a, y: cy + L }),
    arc(cx, cy + L, a, 0, P / 2),
  ];
}

function pointAlong(segs: Seg[], s: number): Pt {
  for (const g of segs) {
    if (s <= g.len) return g.at(g.len > 0 ? s / g.len : 0);
    s -= g.len;
  }
  const last = segs[segs.length - 1];
  return last.at(1);
}

export function computeGeometry(n: number, w: number, h: number): Geometry {
  const portrait = h >= w;
  const cx = w / 2;
  const cy = h * (portrait ? 0.485 : 0.5);
  // 좌석 경로 (자리 상자 중심이 지나는 선)
  const seatW = Math.max(62, Math.round(Math.min(portrait ? w * 0.19 : w * 0.095, 150)));
  // 자리 상자가 화면 밖으로 잘리지 않게
  const sa = Math.min(portrait ? w * 0.405 : w * 0.43, w / 2 - seatW / 2 - 6);
  const sb = portrait ? h * 0.405 : h * 0.39;
  // 펠트는 좌석 경로보다 조금 안쪽 (좌석이 레일 위에 걸쳐 앉음)
  const fa = portrait ? sa - w * 0.06 : sa - h * 0.06;
  const fb = portrait ? sb - w * 0.08 : sb - h * 0.08;
  const segs = stadiumSegments(cx, cy, sa, sb);
  const total = segs.reduce((x, g) => x + g.len, 0);
  const seats: Pt[] = [];
  for (let k = 0; k < n; k++) seats.push(pointAlong(segs, (total * k) / n));
  return {
    w, h, portrait, cx, cy, sa, sb, seatW,
    felt: { l: cx - fa, t: cy - fb, w: 2 * fa, h: 2 * fb },
    seats,
    center: { x: cx, y: cy - (portrait ? h * 0.03 : h * 0.04) },
  };
}

/** 베팅 칩 위치: 자리와 중앙 사이 */
export function betPosition(g: Geometry, seat: Pt): Pt {
  const t = g.portrait ? 0.36 : 0.33;
  return { x: seat.x + (g.cx - seat.x) * t, y: seat.y + (g.cy - seat.y) * t };
}

/**
 * 딜러 버튼: 실제 테이블처럼 버튼 자리와 SB 자리(시계 방향 다음 자리) 사이, 테이블 안쪽에.
 * 버튼이 빈자리(데드 버튼)여도 그 자리 기준으로 놓는다.
 */
export function dealerPosition(g: Geometry, buttonIdx: number, n: number): Pt {
  return avoidBoard(g, dealerRaw(g, buttonIdx, n));
}

/** 보드 카드 영역과 겹치면 위·아래 가까운 쪽으로 밀어냄 */
function avoidBoard(g: Geometry, p: Pt): Pt {
  const halfW = g.sa - g.seatW / 2 - 7 + 16;
  const boardW = ((g.sa - g.seatW / 2 - 7) * 2) / 5.35;
  const halfH = Math.min(boardW, 96) * 0.7 + 16;
  const cy = g.center.y;
  if (Math.abs(p.x - g.cx) < halfW && Math.abs(p.y - cy) < halfH) {
    return { x: p.x, y: p.y < cy ? cy - halfH : cy + halfH };
  }
  return p;
}

function dealerRaw(g: Geometry, buttonIdx: number, n: number): Pt {
  const a = g.seats[buttonIdx] ?? g.seats[0];
  const b = g.seats[(buttonIdx + 1) % n] ?? a;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dx = g.cx - mid.x, dy = g.cy - mid.y;
  const len = Math.hypot(dx, dy) || 1;
  // 두 자리가 마주 보면(헤즈업 등) 중간점이 테이블 한가운데가 되므로: 버튼 자리 앞에서 SB 쪽으로 비켜서
  if (len < Math.min(g.w, g.h) * 0.25) {
    const ax = g.cx - a.x, ay = g.cy - a.y;
    const al = Math.hypot(ax, ay) || 1;
    let px = -ay / al, py = ax / al;
    if ((b.x - a.x) * px + (b.y - a.y) * py < 0) { px = -px; py = -py; }
    const off = Math.min(g.w, g.h) * 0.12 + g.seatW * 0.3;
    return { x: a.x + ax * 0.3 + px * off, y: a.y + ay * 0.3 + py * off };
  }
  const pull = Math.max(len * (g.portrait ? 0.3 : 0.26), Math.min(g.w, g.h) * 0.11);
  return { x: mid.x + (dx / len) * pull, y: mid.y + (dy / len) * pull };
}

/** 올인 토큰: 베팅 칩 바로 옆 (딜러 버튼과 반대쪽) */
export function tokenPosition(g: Geometry, seatIdx: number, chip: number): Pt {
  const s = g.seats[seatIdx];
  const bp = betPosition(g, s);
  const dx = g.cx - s.x, dy = g.cy - s.y;
  const len = Math.hypot(dx, dy) || 1;
  const rx = dx / len, ry = dy / len;
  const off = chip * 1.6 + 14;
  return { x: bp.x - ry * off, y: bp.y + rx * off };
}
