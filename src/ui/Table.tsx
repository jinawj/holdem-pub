import { CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CardView } from './CardView';
import { ChipStack, fmt } from './Chips';
import { betPosition, computeGeometry, dealerPosition, dealerSize, Geometry, Pt, tokenPosition } from './layout';

export interface SeatModel {
  seat: number;
  name: string;
  color: string;
  stack: number;
  committed: number;
  folded: boolean;
  allIn: boolean;
  out: boolean;
  inHand: boolean;
  cards: number[] | null;
  faceUp: boolean;
  isActor: boolean;
  thinking: boolean;
  winner: boolean;
  label?: string;
  isMe: boolean;
  handName?: string;
  /** 이 자리의 마지막 자발적 액션 (연출용) */
  actIdx?: number;
  actType?: string;
  /** 올인 쇼다운으로 공개된 핸드 → 빨간 테두리 */
  allInShow?: boolean;
  /** 이번 핸드에서 받은 칩 (승자 표시) */
  won?: number;
  /** 쇼다운에서 진 패 (흐리게) */
  lost?: boolean;
}

export interface TableModel {
  numSeats: number;
  seats: SeatModel[];
  button: number;
  board: number[];
  pots: { amount: number; label?: string }[];
  street: string;
  handNo: number;
  winners: { seat: number; amount: number }[] | null;
  animMs: number;
  /** 모두 폴드해서 끝난 핸드 (쇼다운 없음) */
  uncontested?: boolean;
  /** 방금 끝난 스트리트의 자리별 베팅 (팟으로 모으는 연출) */
  collected?: Record<number, number>;
  /** 새 핸드면 카드 나눠주기 연출 */
  dealAnim?: boolean;
  /** 연출이 끝날 때까지 진행을 멈춰 달라는 요청 (ms 시각) */
  onHold?: (untilMs: number) => void;
}

interface Flight { id: number; from: Pt; to: Pt; amount: number; go: boolean }

export function usePortrait() {
  const get = () => (typeof window !== 'undefined' ? window.innerHeight >= window.innerWidth : true);
  const [p, setP] = useState(get);
  useEffect(() => {
    const on = () => setP(get());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return p;
}

function useSize(ref: React.RefObject<HTMLDivElement>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const upd = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return size;
}

let fid = 1;

export function Table({ m }: { m: TableModel }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(ref);
  const g = computeGeometry(m.numSeats, w || 360, h || 600);
  const [flights, setFlights] = useState<Flight[]>([]);
  const prev = useRef<{ street: string; handNo: number; committed: Record<number, number>; done: boolean; boardLen: number }>({ street: m.street, handNo: m.handNo, committed: {}, done: false, boardLen: m.board.length });
  const boardDelay = useRef<Record<string, BoardAnim>>({});
  const revealEnd = useRef(0);
  const winRef = useRef<{ hand: number; delay: number }>({ hand: -1, delay: 0 });
  const T = timings(m.animMs);

  // 보드 카드 공개 연출
  //  플랍: 세 장이 뒤집힌 채 첫 자리에 따다닥 쌓인 뒤 → 촤라락 펼쳐지며 앞면으로
  //  턴·리버: 한 장씩 뒤집힘. 올인 런아웃이면 플랍 → 턴 → 리버를 간격 두고 차례로
  const p0 = prev.current;
  const prevLen = p0.handNo === m.handNo ? p0.boardLen : 0;
  if (m.animMs > 0 && m.board.length > prevLen) {
    let end = 0, added = false;
    // 칩이 팟으로 다 모인 다음 카드가 나옴
    const base = T.collectDelay + T.chipFly;
    for (let i = prevLen; i < m.board.length; i++) {
      const key = `${m.handNo}-${i}`;
      if (boardDelay.current[key] !== undefined) continue;
      added = true;
      let a: BoardAnim;
      if (i < 3) a = { mode: 'flop', appear: base + i * T.flopGap, spread: base + T.spreadAt };
      else if (i === 3) a = { mode: 'flip', appear: base + (prevLen < 3 ? T.flopEnd + T.streetGap : 0), spread: 0 };
      else a = { mode: 'flip', appear: base + (prevLen < 3 ? T.flopEnd + 2 * T.streetGap : prevLen < 4 ? T.streetGap : 0), spread: 0 };
      boardDelay.current[key] = a;
      end = Math.max(end, a.mode === 'flop' ? base + T.flopEnd : a.appear + T.flipDur);
    }
    if (added) revealEnd.current = Date.now() + end;
  }
  // 승자 공개 시각: (런아웃이 끝난 뒤) 쇼다운 패를 잠깐 보여 주고 → 승자 표시·칩 이동
  if (m.winners && winRef.current.hand !== m.handNo) {
    const collectWait = m.collected && Object.keys(m.collected).length ? T.collectDelay + T.chipFly : 0;
    const revealWait = Math.max(collectWait, revealEnd.current - Date.now());
    winRef.current = { hand: m.handNo, delay: m.animMs > 0 ? revealWait + (m.uncontested ? T.uncontestedPause : T.showdownPause) : 0 };
  }
  const winDelay = m.winners && winRef.current.hand === m.handNo ? winRef.current.delay : 0;

  // 칩 이동 애니메이션: 스트리트가 끝나면 베팅 칩 → 팟, 핸드가 끝나면 팟 → 승자
  useEffect(() => {
    const p = prev.current;
    const newF: Flight[] = [];
    if (w === 0) return;
    if (p.handNo === m.handNo && p.street !== m.street) {
      // 마지막 콜까지 포함한 이번 스트리트 베팅 (없으면 직전 화면의 베팅)
      const src = m.collected && Object.keys(m.collected).length ? m.collected : p.committed;
      for (const [seat, amt] of Object.entries(src)) {
        if (amt > 0) newF.push({ id: fid++, from: betPosition(g, g.seats[+seat]), to: g.center, amount: amt, go: false });
      }
    }
    const winF: Flight[] = [];
    if (m.winners && !p.done && p.handNo === m.handNo) {
      for (const wn of m.winners) winF.push({ id: fid++, from: g.center, to: g.seats[wn.seat], amount: wn.amount, go: false });
    }
    const boardGrew = m.board.length > (p.handNo === m.handNo ? p.boardLen : 0);
    prev.current = { street: m.street, handNo: m.handNo, committed: Object.fromEntries(m.seats.map((s) => [s.seat, s.committed])), done: !!m.winners, boardLen: m.board.length };
    /** showNow: 출발 전에도 제자리에 칩을 보여 줌 (마지막 콜 칩이 사라지지 않게) */
    const launch = (fs: Flight[], delay: number, showNow = false) => {
      if (!fs.length || m.animMs <= 0) return;
      const go = () => requestAnimationFrame(() => requestAnimationFrame(() => setFlights((f) => f.map((x) => (fs.some((n) => n.id === x.id) ? { ...x, go: true } : x)))));
      const remove = () => setTimeout(() => setFlights((f) => f.filter((x) => !fs.some((n) => n.id === x.id))), T.chipFly + 80);
      if (showNow) {
        setFlights((f) => [...f, ...fs]);
        setTimeout(() => { go(); remove(); }, delay);
      } else {
        setTimeout(() => { setFlights((f) => [...f, ...fs]); go(); remove(); }, delay);
      }
    };
    // 마지막 액션 칩이 놓이는 걸 잠깐 보여 준 뒤 팟으로 모음
    launch(newF, T.collectDelay, true);
    const wait = winRef.current.hand === m.handNo ? winRef.current.delay : 0;
    launch(winF, wait);
    // 연출 동안 진행 멈춤 요청
    if (m.onHold && m.animMs > 0) {
      let until = 0;
      if (boardGrew) until = Math.max(until, revealEnd.current + 150);
      if (m.dealAnim && p.handNo !== m.handNo) until = Math.max(until, Date.now() + dealDuration(m));
      // 승자 표시 → 칩이 승자에게 간 뒤에도 잠깐 머문 다음 다음 핸드
      if (winF.length) until = Math.max(until, Date.now() + wait + T.chipFly + T.afterWin);
      if (until > Date.now()) m.onHold(until);
    }
  }, [m.street, m.handNo, m.winners, m.board.length, m.seats.map((s) => s.committed).join(','), w]);

  const btnPos = dealerPosition(g, m.button, m.numSeats);
  const u = Math.min(w || 360, h || 600);
  const { vars, board: boardW, gap: boardGap } = cardVars(g);
  const potChip = Math.round(Math.max(20, Math.min(36, u * 0.06)));
  const betChip = Math.round(Math.max(14, Math.min(24, u * 0.04)));
  const dealOrder = dealOrderOf(m);
  const style: CSSProperties = { ...vars, ['--win-delay' as string]: winDelay + 'ms', ['--fly-ms' as string]: T.chipFly + 'ms' };

  return (
    <div ref={ref} className={'table-wrap ' + (g.portrait ? 'portrait' : 'landscape') + (m.winners ? ' hand-over' : '')} style={style}>
      <div className="rail" style={{ left: g.felt.l, top: g.felt.t, width: g.felt.w, height: g.felt.h }}>
        <div className="felt"><div className="felt-line" /></div>
      </div>
      <div className="center" style={{ left: g.center.x, top: g.center.y }}>
        <div className="board" style={{ gap: boardGap }}>
          {[0, 1, 2, 3, 4].map((i) => {
            const c = m.board[i];
            if (c === undefined) return <span key={'s' + i} className="card board-card slot" />;
            const a = boardDelay.current[`${m.handNo}-${i}`];
            if (a && a.mode === 'flop') {
              return (
                <span key={`${m.handNo}-${i}`} className="flopcard"
                  style={{ ['--sx' as string]: -(i * (boardW + boardGap)) + 'px', animation: `flop-appear ${T.flopGap + 60}ms ease-out ${a.appear}ms both, flop-spread ${T.spreadDur}ms cubic-bezier(0.2, 0.8, 0.2, 1) ${a.spread}ms both`, zIndex: 3 - i }}>
                  <span className="flop-inner" style={{ animation: `flop-turn ${T.spreadDur}ms ease-out ${a.spread}ms both` }}>
                    <span className="face front"><CardView c={c} board /></span>
                    <span className="face back"><CardView hidden board /></span>
                  </span>
                </span>
              );
            }
            return (
              <span key={`${m.handNo}-${i}`} className={a ? 'flip' : ''} style={a ? { animationDelay: a.appear + 'ms', animationDuration: T.flipDur + 'ms' } : undefined}>
                <CardView c={c} board />
              </span>
            );
          })}
        </div>
        <div className="pots">
          {m.pots.map((p, i) => (
            <div key={i} className={'pot' + (i === 0 ? ' main' : ' side')}>
              <ChipStack amount={p.amount} size={i === 0 ? potChip : Math.round(potChip * 0.7)} perCol={10} cols={6} label={p.label ?? (m.pots.length > 1 ? '메인' : undefined)} big={i === 0} />
            </div>
          ))}
        </div>
      </div>
      {w > 0 && m.seats.map((s) => {
        const p = g.seats[s.seat];
        const bp = betPosition(g, p);
        const tp = tokenPosition(g, s.seat, betChip);
        // 올인 삼각형 토큰: 올인한 사람마다 자기 앞 테이블에 하나씩 (이긴 사람은 칩을 받으면서 치움)
        const token = s.inHand && s.allIn && !s.folded;
        return (
          <div key={s.seat}>
            {s.committed > 0 && (
              // 칩이 자리에서 앞으로 밀려 나오는 연출 (금액이 바뀔 때마다)
              <div key={`${m.handNo}-${s.seat}-${s.committed}`} className={'bet' + (m.animMs > 0 ? ' bet-in' : '')}
                style={{ left: bp.x, top: bp.y, ['--fx' as string]: p.x - bp.x + 'px', ['--fy' as string]: p.y - bp.y + 'px', animationDuration: T.betIn + 'ms' }}>
                <ChipStack amount={s.committed} size={betChip} perCol={6} cols={3} />
              </div>
            )}
            {token && (
              <div key={'tk' + m.handNo} className={'allin-token' + (m.animMs > 0 ? ' in' : '') + (s.winner ? ' cleared' : '')} style={{ left: tp.x, top: tp.y, ['--fx' as string]: p.x - tp.x + 'px', ['--fy' as string]: p.y - tp.y + 'px' }} aria-label="올인">
                <span>ALL<br />IN</span>
              </div>
            )}
            <Seat s={s} p={p} g={g} handNo={m.handNo} anim={m.animMs > 0} deal={m.dealAnim && m.animMs > 0 ? { order: dealOrder, step: dealStep(m) } : null} />
          </div>
        );
      })}
      {w > 0 && <div className="dealer" style={{ left: btnPos.x, top: btnPos.y, width: dealerSize(g), height: dealerSize(g), fontSize: dealerSize(g) * 0.5 }}>D</div>}
      {flights.map((f) => (
        <div key={f.id} className="flight" style={{ left: f.go ? f.to.x : f.from.x, top: f.go ? f.to.y : f.from.y, transition: `left ${T.chipFly}ms ease-in-out, top ${T.chipFly}ms ease-in-out, opacity ${T.chipFly}ms`, opacity: f.go ? 0.75 : 1 }}>
          <ChipStack amount={f.amount} size={betChip} perCol={5} cols={3} />
        </div>
      ))}
    </div>
  );
}

/** 카드 크기: 화면 크기에 비례 (PC에서 크게, 폰에서 화면에 맞게) */
function cardVars(g: Geometry): { vars: CSSProperties; board: number; gap: number } {
  const seatW = g.seatW;
  const board = g.board;
  const mine = Math.round(Math.min(g.portrait ? g.w * 0.13 : g.w * 0.05, g.h * (g.portrait ? 0.075 : 0.1), 80));
  const other = Math.round(Math.max(16, Math.min(g.portrait ? Math.min(mine * 0.45, g.w * 0.06) : mine * 0.62, 44)));
  return {
    vars: { ['--board-w' as string]: board + 'px', ['--mine-w' as string]: mine + 'px', ['--other-w' as string]: other + 'px', ['--seat-w' as string]: seatW + 'px' } as CSSProperties,
    board, gap: g.boardGap,
  };
}

interface BoardAnim { mode: 'flop' | 'flip'; appear: number; spread: number }

/** 연출 시간표 (AI 속도 설정의 animMs 기준: 빠름 250 / 보통 450 / 리얼 650) */
function timings(animMs: number) {
  const a = Math.max(1, animMs);
  const flopGap = Math.round(Math.max(110, a * 0.32)); // 뒤집힌 카드 따다닥 간격
  const spreadAt = 2 * flopGap + Math.round(Math.max(260, a * 0.7)); // 세 장 쌓인 뒤 잠깐 멈췄다가
  const spreadDur = Math.round(Math.max(380, a * 1.1)); // 촤라락 펼치며 뒤집기
  return {
    flopGap, spreadAt, spreadDur, flopEnd: spreadAt + spreadDur,
    flipDur: Math.round(Math.max(420, a * 1.1)),
    streetGap: Math.round(Math.max(900, a * 2.4)), // 올인 런아웃에서 다음 카드까지
    betIn: Math.round(Math.max(420, a * 1.35)), // 베팅 칩이 앞으로 나오는 시간
    chipFly: Math.round(Math.max(500, a * 1.6)), // 칩이 팟·승자에게 가는 시간
    collectDelay: Math.round(Math.max(450, a * 1.2)), // 마지막 액션 칩을 보여 준 뒤 팟으로 모으기까지
    showdownPause: Math.round(Math.max(1100, a * 2.6)), // 쇼다운 패를 보여 주는 시간
    uncontestedPause: Math.round(Math.max(350, a * 0.8)),
    afterWin: Math.round(Math.max(900, a * 2.2)), // 칩을 먹은 뒤 다음 핸드까지
  };
}

function dealOrderOf(m: TableModel): number[] {
  const inHand = m.seats.filter((s) => s.inHand).map((s) => s.seat);
  const out: number[] = [];
  for (let i = 1; i <= m.numSeats; i++) { const s = (m.button + i) % m.numSeats; if (inHand.includes(s)) out.push(s); }
  return out;
}
const dealStep = (m: TableModel) => Math.round(Math.max(55, m.animMs * 0.17));
const dealDuration = (m: TableModel) => dealStep(m) * 2 * dealOrderOf(m).length + 450;

function Seat({ s, p, g, handNo, deal, anim }: { s: SeatModel; p: Pt; g: Geometry; handNo: number; deal: { order: number[]; step: number } | null; anim: boolean }) {
  if (s.out) {
    return <div className="seat empty" style={{ left: p.x, top: p.y }}><span>빈자리</span></div>;
  }
  const idx = deal ? deal.order.indexOf(s.seat) : -1;
  // 카드가 테이블 가운데(딜러 자리)에서 날아오도록: 이 자리 기준 중앙까지의 거리
  const dx = g.center.x - p.x, dy = g.center.y - (p.y - 30);
  // 액션 연출: 같은 액션이면 다시 재생하지 않도록 액션 번호로 key
  const actKey = `${handNo}-${s.actIdx ?? -1}`;
  const actClass = anim && s.actType ? ' anim-' + s.actType : '';
  // 상대가 폴드하면 카드가 가운데로 버려짐 (내 카드는 흐리게 남김)
  const muck = s.folded && !s.isMe && !s.faceUp;
  return (
    <div className={'seat' + (s.isActor ? ' actor' : '') + (s.folded ? ' folded' : '') + (s.winner ? ' winner' : '') + (s.lost ? ' lost' : '') + (s.isMe ? ' me' : '') + (s.allInShow ? ' allin-show' : '')} style={{ left: p.x, top: p.y }}>
      {s.winner && s.won ? (
        // 화면 가장자리 자리는 배너가 잘리지 않게 안쪽으로 붙임
        <div className={'win-banner' + (p.x < g.w * 0.3 ? ' edge-l' : p.x > g.w * 0.7 ? ' edge-r' : '')}><b>WIN</b> +{fmt(s.won)}</div>
      ) : null}
      {s.cards && (
        <div className={'hole' + (muck ? (anim ? ' mucked' : ' gone') : '')} key={handNo} style={muck ? { ['--dx' as string]: dx + 'px', ['--dy' as string]: dy + 'px' } : undefined}>
          {s.cards.map((c, i) => {
            const style: CSSProperties | undefined = deal && idx >= 0
              ? { ['--dx' as string]: dx + 'px', ['--dy' as string]: dy + 'px', animationDelay: (i * deal.order.length + idx) * deal.step + 'ms' }
              : undefined;
            return (
              <span key={i} className={style ? 'dealt' : ''} style={style}>
                <CardView c={c} hidden={!s.faceUp} mine={s.isMe} dim={s.folded} />
              </span>
            );
          })}
        </div>
      )}
      <div key={actKey} className={'nameplate' + actClass} style={{ ['--pc' as string]: s.color }}>
        <div className="nm">{s.name}{s.thinking && <span className="dots"><i /><i /><i /></span>}</div>
        {s.winner && s.won ? (
          // 승자 공개 전에는 받기 전 스택, 공개 순간 받은 뒤 스택으로 (결과 미리 보이지 않게)
          <div className="stk swap">
            <span className="pre">{s.stack - s.won === 0 && s.allIn ? <b className="allin">ALL-IN</b> : fmt(s.stack - s.won)}</span>
            <span className="post">{fmt(s.stack)}</span>
          </div>
        ) : (
          <div className="stk">{s.allIn && s.stack === 0 ? <b className="allin">ALL-IN</b> : fmt(s.stack)}</div>
        )}
      </div>
      {s.label && <div key={'lb' + actKey} className={'act-label' + (anim ? ' pop' : '') + (s.actType ? ' t-' + s.actType : '')}>{s.label}</div>}
      {s.handName && <div className="hand-name">{s.handName}</div>}
    </div>
  );
}
