import { useEffect, useMemo, useRef, useState } from 'react';
import { ACTION_GAP_MS, CHIP_ANIM_MS, HAND_END_PAUSE_MS, MIN_THINK_MS } from '../config';
import { askAi } from '../ai/client';
import { newMemory } from '../ai/v2';
import { centerPots, legalActions, actionLabel } from '../engine/hand';
import { describeHand } from '../engine/evaluator';
import { aliveSeats, currentLevel, LEVELS } from '../engine/tournament';
import { fmt } from './Chips';
import { Controls } from './Controls';
import { aiSpeedMult, baselineProfile, GameSave, HUMAN_SEAT, useStore, viewFor } from './store';
import { SeatModel, Table, TableModel } from './Table';

export function buildTableModel(g: GameSave, thinkingSeat: number | null): TableModel {
  const h = g.t.hand;
  const seats: SeatModel[] = g.t.seats.map((ts) => {
    const hp = h?.players.find((p) => p.seat === ts.seat);
    const done = h?.street === 'done';
    const revealed = !!(h && done && h.result && (h.result.shown.includes(ts.seat) || g.voluntaryShown.includes(ts.seat)));
    let label: string | undefined;
    let actIdx = -1, actType: string | undefined;
    if (h && hp) {
      const acts = h.actions.filter((a) => a.seat === ts.seat && (a.street === h.street || a.type === 'fold'));
      const last = acts[acts.length - 1];
      if (last && !(done && !hp.folded)) {
        label = actionLabel(last);
        // 올인에 콜했거나 콜하면서 올인이 되면 "올인 콜"
        if (last.type === 'call') {
          const li = h.actions.lastIndexOf(last);
          const facing = h.actions.slice(0, li).reverse().find((a) => a.street === last.street && (a.type === 'bet' || a.type === 'raise'));
          if (last.allIn || facing?.allIn) label = `올인 콜 ${last.amount.toLocaleString('en-US')}`;
        }
      }
      for (let i = h.actions.length - 1; i >= 0; i--) {
        const a = h.actions[i];
        if (a.seat === ts.seat && !['ante', 'sb', 'bb'].includes(a.type)) { actIdx = i; actType = a.allIn ? 'allin' : a.type; break; }
      }
    }
    return {
      seat: ts.seat, name: ts.name, color: g.colors[ts.seat], isMe: ts.isHuman,
      stack: hp ? hp.stack : ts.stack, committed: hp ? hp.committed : 0,
      folded: !!hp?.folded, allIn: !!hp?.allIn, out: ts.out && !hp, inHand: !!hp,
      cards: hp ? [...hp.hole] : null,
      faceUp: ts.isHuman || revealed,
      isActor: !!h && h.toAct === ts.seat,
      thinking: thinkingSeat === ts.seat,
      winner: !!(done && h?.result && (h.result.won[ts.seat] ?? 0) > 0),
      label, actIdx, actType,
      allInShow: revealed && !!h && !h.result?.uncontested && (h.allInRunout || h.players.some((p) => p.allIn && !p.folded)),
      won: done && h?.result ? h.result.won[ts.seat] ?? 0 : 0,
      lost: !!(done && h?.result && !h.result.uncontested && hp && !hp.folded && !((h.result.won[ts.seat] ?? 0) > 0)),
      handName: revealed && h?.result?.scores[ts.seat] !== undefined ? describeHand(h.result.scores[ts.seat]) : undefined,
    };
  });
  // 핸드가 끝나도 승자에게 칩이 갈 때까지 팟은 테이블에 남겨 둠 (CSS가 승자 공개 시점에 숨김)
  const pots = h && h.street !== 'done'
    ? centerPots(h).map((p, i) => ({ amount: p.amount, label: i === 0 ? undefined : `사이드 ${i}` }))
    : h?.result ? [{ amount: h.result.pots.reduce((a, p) => a + p.amount, 0) }] : [];
  return {
    numSeats: g.t.numSeats, seats, button: h ? h.buttonSeat : g.t.prev?.button ?? 0, board: h ? h.board : [],
    pots, street: h ? h.street : 'none', handNo: h ? h.handNo : g.t.handNo,
    winners: h && h.street === 'done' && h.result ? Object.entries(h.result.won).map(([s, a]) => ({ seat: +s, amount: a })) : null,
    animMs: CHIP_ANIM_MS[g.settings.aiSpeed],
    uncontested: !!h?.result?.uncontested,
    collected: collectedBets(h),
    dealAnim: !!h && h.street === 'preflop' && !h.actions.some((a) => !['ante', 'sb', 'bb'].includes(a.type)),
    onHold: (until) => useStore.getState().hold(until),
  };
}

/** 방금 끝난 스트리트에 각자 넣은 칩 (마지막 콜까지 포함해 팟으로 모으는 연출용) */
function collectedBets(h: GameSave['t']['hand']): Record<number, number> {
  if (!h || h.actions.length === 0) return {};
  const lastStreet = h.actions[h.actions.length - 1].street;
  if (h.street === lastStreet) return {};
  const out: Record<number, number> = {};
  for (const a of h.actions) if (a.street === lastStreet && a.type !== 'ante') out[a.seat] = (out[a.seat] ?? 0) + a.amount;
  // 돌려받은(콜되지 않은) 칩은 빼기: 가장 많이 낸 사람을 두 번째와 맞춤
  const vals = Object.values(out).sort((x, y) => y - x);
  if (vals.length >= 2 && vals[0] > vals[1]) {
    const top = Object.keys(out).find((k) => out[+k] === vals[0])!;
    out[+top] = vals[1];
  }
  return out;
}

function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Game() {
  const g = useStore((s) => s.game)!;
  const rev = useStore((s) => s.rev);
  const paused = useStore((s) => s.paused);
  const phase = useStore((s) => s.phase);
  const thinkingSeat = useStore((s) => s.thinkingSeat);
  const st = useStore.getState();
  const [, setTick] = useState(0);
  const [menu, setMenu] = useState(false);
  const [forfeitAsk, setForfeitAsk] = useState(false);
  const [hudOpen, setHudOpen] = useState(false);

  // 레벨 타이머: 실제 시각 차이로 깎는다 (틱 횟수로 세지 않음)
  useEffect(() => {
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      useStore.getState().tickTimer(now - last);
      last = now;
      setTick((x) => x + 1);
    }, 250);
    return () => clearInterval(id);
  }, []);

  // 백그라운드로 가면 자동 일시정지
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'hidden') useStore.getState().setPaused(true, true); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  // 게임 진행 드라이버
  useEffect(() => {
    const s = useStore.getState();
    const game = s.game;
    if (!game || game.finished || s.paused) return;
    const h = game.t.hand;
    if (!h) { const id = setTimeout(() => useStore.getState().startHand(), 350); return () => clearTimeout(id); }
    const holdLeft = s.holdUntil - Date.now();
    if (h.street === 'done') {
      s.setPhase('handEnd');
      // 연출(쇼다운 → 승자 표시 → 칩 이동 → 잠깐 머묾)이 끝난 뒤 다음 핸드
      const id = setTimeout(() => useStore.getState().endHand(), Math.max(0, holdLeft) + HAND_END_PAUSE_MS[game.settings.aiSpeed]);
      return () => clearTimeout(id);
    }
    // 카드 나눠주기·보드 공개 연출이 끝날 때까지 기다림
    if (holdLeft > 0) {
      const id = setTimeout(() => useStore.getState().bump(), holdLeft + 20);
      return () => clearTimeout(id);
    }
    // 앞 사람 액션 연출(칩 나오기·말풍선)을 볼 수 있게 다음 사람 차례 전 잠깐 텀
    const gapLeft = s.lastActionAt + ACTION_GAP_MS[game.settings.aiSpeed] - Date.now();
    if (gapLeft > 0) {
      const id = setTimeout(() => useStore.getState().bump(), gapLeft + 10);
      return () => clearTimeout(id);
    }
    if (h.toAct === HUMAN_SEAT) {
      s.setPhase('human');
      // 내 결정 시점의 "AI 기준" (기록만)
      const view = viewFor(game, HUMAN_SEAT);
      const idx = h.actions.length;
      askAi(view, baselineProfile, newMemory(), 0, false).then((d) => useStore.getState().setBaseline({ actionIndex: idx, seat: HUMAN_SEAT, memo: d.memo })).catch(() => {});
      return;
    }
    const seat = h.toAct!;
    s.setPhase('ai', seat);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const view = viewFor(game, seat);
    const t0 = performance.now();
    const ai = game.ai[seat];
    askAi(view, ai.profile, ai.memory, aiSpeedMult(game), game.settings.recall).then((d) => {
      if (cancelled) return;
      if (game.debug?.aiAllIn) {
        const L = legalActions(h);
        if (L) d = L.canRaise ? { ...d, type: 'raise', to: L.maxRaiseTo } : { ...d, type: L.canCheck ? 'check' : 'call', to: undefined };
      }
      // 최소 고민 시간: 쉬운 결정이라도 사람처럼 잠깐 생각
      const think = Math.max(d.thinkMs, MIN_THINK_MS[game.settings.aiSpeed]);
      const wait = Math.max(0, think - (performance.now() - t0));
      timer = setTimeout(() => { if (!cancelled) useStore.getState().applyAi(seat, d, view); }, wait);
    }).catch((e) => console.error(e));
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [rev, paused]);

  const model = useMemo(() => buildTableModel(g, thinkingSeat), [rev, thinkingSeat, g]);
  const h = g.t.hand;
  const legal = h && h.toAct === HUMAN_SEAT && phase === 'human' && !paused ? legalActions(h) : null;
  const lv = currentLevel(g.t);
  const nextLv = LEVELS[Math.min(LEVELS.length - 1, g.t.levelIndex + g.t.pendingLevelUp + 1)];
  const alive = aliveSeats(g.t);
  const avg = Math.round(alive.reduce((a, s) => a + s.stack, 0) / Math.max(1, alive.length));
  const finalLevel = g.t.levelIndex + g.t.pendingLevelUp >= LEVELS.length - 1;
  const curHandNo = h ? h.handNo : g.history[g.history.length - 1]?.handNo;
  const highlighted = curHandNo !== undefined && g.highlights.some((x) => x.handNo === curHandNo);
  const potNow = h ? centerPots(h).reduce((a, p) => a + p.amount, 0) + h.players.reduce((a, p) => a + p.committed, 0) : 0;
  const betweenHands = !h || h.street === 'done';

  return (
    <div className="game">
      <header className="hud">
        <button className="icon" onClick={() => { setMenu(!menu); }} aria-label="메뉴">☰</button>
        {/* 항상 보이는 핵심 정보: 레벨·블라인드·앤티·남은 시간 */}
        <div className="lvl">
          <b>Lv{lv.level}</b> {fmt(lv.sb)}/{fmt(lv.bb)}{lv.ante ? <span className="ante"> ({fmt(lv.ante)})</span> : null}
          {' · '}<b className="clock">{finalLevel ? '최종' : mmss(g.levelRemainingMs)}</b>
          {g.t.pendingLevelUp > 0 && !finalLevel ? <span className="ante"> ↑</span> : null}
        </div>
        {/* 가로 화면: 바로 보임 / 세로 화면: ▾ 눌러서 펼침 */}
        <div className={'info' + (hudOpen ? ' open' : '')}>
          <span>다음 {finalLevel ? '-' : `${fmt(nextLv.sb)}/${fmt(nextLv.bb)}`}{g.t.pendingLevelUp > 0 ? ' (다음 핸드부터)' : ''}</span>
          <span>{alive.length}/{g.t.numSeats}명</span>
          <span>평균 {fmt(avg)}</span>
        </div>
        <button className="icon more" onClick={() => setHudOpen(!hudOpen)} aria-label={hudOpen ? '정보 접기' : '정보 펼치기'} aria-expanded={hudOpen}>{hudOpen ? '▴' : '▾'}</button>
        <button className={'icon bookmark' + (highlighted ? ' on' : '')} onClick={() => st.toggleHighlight()} aria-label={highlighted ? '강조됨' : '강조'} aria-pressed={highlighted} title="지금 핸드 강조(북마크)">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z" fill={highlighted ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </button>
        <button className="icon" onClick={() => st.setPaused(!paused)} aria-label={paused ? '계속' : '일시정지'}>{paused ? '▶' : '❚❚'}</button>
      </header>

      {menu && (
        <div className="menu" onClick={() => setMenu(false)}>
          <div className="menu-box" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { st.exportFile(); setMenu(false); }} disabled={!betweenHands}>파일 내보내기{!betweenHands ? ' (핸드 끝나고)' : ''}</button>
            <button onClick={() => { setMenu(false); setForfeitAsk(true); st.setPaused(true); }} className="danger">게임 포기</button>
            <button onClick={() => setMenu(false)}>닫기</button>
          </div>
        </div>
      )}

      {forfeitAsk && (
        <div className="modal">
          <div className="modal-box">
            <p>포기하면 이 토너먼트는 이어 할 수 없어요.<br />기록은 복기용으로 남아요.</p>
            <div className="row">
              <button className="danger" onClick={() => { setForfeitAsk(false); st.doForfeit(); }}>포기</button>
              <button onClick={() => { setForfeitAsk(false); st.setPaused(false); }}>취소</button>
            </div>
          </div>
        </div>
      )}

      <main className="table-area">
        <Table m={model} />
        {paused && !forfeitAsk && (
          <div className="paused" onClick={() => st.setPaused(false)}>
            <div>일시정지<br /><small>눌러서 계속</small></div>
          </div>
        )}
      </main>

      <footer className="control-area">
        <Controls legal={legal} bb={lv.bb} pot={potNow} onMove={(m) => st.humanMove(m)} disabled={phase === 'handEnd' || !h} />
      </footer>
      <Toast />
    </div>
  );
}

export function Toast() {
  const t = useStore((s) => s.toast);
  return t ? <div className="toast">{t}</div> : null;
}

export function useOnce(fn: () => void) {
  const done = useRef(false);
  useEffect(() => { if (!done.current) { done.current = true; fn(); } }, []);
}
