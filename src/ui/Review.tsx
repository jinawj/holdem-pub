import { useMemo, useState } from 'react';
import { describeHand } from '../engine/evaluator';
import { actionLabel } from '../engine/hand';
import { exportJson } from '../persist/file';
import type { HandRecord } from '../game/summary';
import { fmt } from './Chips';
import { Toast } from './Game';
import { useStore, HUMAN_SEAT } from './store';
import { SeatModel, Table, TableModel } from './Table';

type Filter = 'all' | 'highlight' | 'mine' | 'allin';

function involved(h: HandRecord) {
  return h.actions.some((a) => a.seat === HUMAN_SEAT && (a.type === 'call' || a.type === 'raise' || a.type === 'bet' || a.type === 'check'));
}
function hadAllIn(h: HandRecord) { return h.actions.some((a) => a.allIn); }

export function ReviewScreen() {
  const st = useStore();
  const g = st.game!;
  const [filter, setFilter] = useState<Filter>(st.review?.onlyHighlights ? 'highlight' : 'all');
  const hands = useMemo(() => g.history.filter((h) =>
    filter === 'all' ? true : filter === 'highlight' ? g.highlights.some((x) => x.handNo === h.handNo) : filter === 'mine' ? involved(h) : hadAllIn(h)), [filter, g.history.length, g.highlights.length]);
  const [hi, setHi] = useState(0);
  const hand = hands[Math.min(hi, hands.length - 1)];
  const startStep = (h?: HandRecord) => {
    if (!h) return 0;
    const hl = g.highlights.find((x) => x.handNo === h.handNo);
    if (!hl) return 0;
    if (hl.street === 'done') return h.snapshots.length - 1;
    const k = h.snapshots.findIndex((s) => s.i >= hl.actionIndex);
    return k < 0 ? h.snapshots.length - 1 : k;
  };
  const [step, setStep] = useState(() => startStep(hand));
  const [reportText, setReportText] = useState<string | null>(null);
  const goHand = (k: number) => { setHi(k); setStep(startStep(hands[k])); setReportText(null); };

  if (!hand) {
    return (
      <div className="review">
        <ReviewHeader filter={filter} setFilter={(f) => { setFilter(f); setHi(0); setStep(0); }} />
        <p className="tag">해당하는 핸드가 없어요.</p>
        <button className="big" onClick={() => useStore.setState({ screen: 'result' })}>결과 화면</button>
      </div>
    );
  }
  const snap = hand.snapshots[Math.min(step, hand.snapshots.length - 1)];
  const act = snap.actor !== null ? hand.actions[snap.i] : null;
  const memo = act ? hand.memos.find((m) => m.actionIndex === snap.i) : undefined;
  const done = snap.street === 'done';
  const won = hand.result?.won ?? {};
  const seats: SeatModel[] = Array.from({ length: hand.numSeats }, (_, seat) => {
    const p = hand.players.find((x) => x.seat === seat);
    const ss = snap.seats.find((x) => x.seat === seat);
    const name = g.t.seats[seat].name;
    if (!p || !ss) return { seat, name, color: g.colors[seat], stack: 0, committed: 0, folded: false, allIn: false, out: true, inHand: false, cards: null, faceUp: false, isActor: false, thinking: false, winner: false, isMe: seat === HUMAN_SEAT };
    const lastAct = [...hand.actions.slice(0, snap.i + 1)].reverse().find((a) => a.seat === seat && (a.street === snap.street || a.type === 'fold'));
    return {
      seat, name, color: g.colors[seat], stack: ss.stack, committed: ss.committed, folded: ss.folded, allIn: ss.allIn, out: false, inHand: true,
      cards: p.hole, faceUp: true, isActor: snap.actor === seat, thinking: false, winner: done && (won[seat] ?? 0) > 0, isMe: seat === HUMAN_SEAT,
      label: lastAct ? actionLabel(lastAct) : undefined,
      handName: done && hand.result?.scores[seat] !== undefined ? describeHand(hand.result.scores[seat]) : undefined,
    };
  });
  const model: TableModel = {
    numSeats: hand.numSeats, seats, button: hand.buttonSeat, board: snap.board, pots: snap.pot > 0 ? [{ amount: snap.pot }] : [],
    street: snap.street, handNo: hand.handNo * 1000 + step, winners: null, animMs: 0,
  };
  const isHL = g.highlights.some((x) => x.handNo === hand.handNo);
  const aiSeat = memo && memo.seat !== HUMAN_SEAT ? memo.seat : null;

  return (
    <div className="review">
      <ReviewHeader filter={filter} setFilter={(f) => { setFilter(f); setHi(0); setStep(0); }} />
      <div className="rv-nav">
        <button onClick={() => goHand(Math.max(0, hi - 1))} disabled={hi === 0}>◀ 이전 핸드</button>
        <span>#{hand.handNo} {isHL ? '★' : ''} · Lv{hand.level.level} {fmt(hand.level.sb)}/{fmt(hand.level.bb)} ({hi + 1}/{hands.length})</span>
        <button onClick={() => goHand(Math.min(hands.length - 1, hi + 1))} disabled={hi >= hands.length - 1}>다음 핸드 ▶</button>
      </div>
      <div className="rv-table"><Table m={model} /></div>
      <div className="rv-steps">
        <button onClick={() => setStep(0)}>⏮</button>
        <button onClick={() => { setStep(Math.max(0, step - 1)); setReportText(null); }}>◀ 한 액션</button>
        <span className="rv-label">{act ? `${g.t.seats[act.seat].name}: ${actionLabel(act)}` : snap.label}{hand.forfeited && step === hand.snapshots.length - 1 ? ' (포기)' : ''}</span>
        <button onClick={() => { setStep(Math.min(hand.snapshots.length - 1, step + 1)); setReportText(null); }}>한 액션 ▶</button>
        <button onClick={() => setStep(hand.snapshots.length - 1)}>⏭</button>
      </div>
      {memo && aiSeat !== null && (
        <div className="memo">
          <div><b>{g.t.seats[aiSeat].name}</b>의 판단 메모 ({(memo.memo as any).persona} Lv{(memo.memo as any).level})</div>
          <div className="small">{(memo.memo as any).note}</div>
          <div className="small">
            {(memo.memo as any).equity !== undefined && <>에퀴티 {(((memo.memo as any).equity) * 100).toFixed(0)}% · </>}
            {(memo.memo as any).potOdds !== undefined && <>필요 승률 {(((memo.memo as any).potOdds) * 100).toFixed(0)}% · </>}
            {((memo.memo as any).options as { key: string; p: number }[]).filter((o) => o.p > 0).map((o) => `${optName(o.key)} ${(o.p * 100).toFixed(0)}%`).join(' / ')} → {optName((memo.memo as any).chosen)}
            {(memo.memo as any).habit ? ` · 습관: ${(memo.memo as any).habit}` : ''}
          </div>
          {reportText === null ? (
            <button className="report" onClick={() => setReportText('')}>🚩 이 AI 행동 이상함</button>
          ) : (
            <div className="report-box">
              <input autoFocus placeholder="한 줄 의견 (예: 로봇 같음, 이건 폴드해야지)" value={reportText} onChange={(e) => setReportText(e.target.value)} />
              <button onClick={() => { st.addReport({ handNo: hand.handNo, actionIndex: snap.i, seat: aiSeat, name: g.t.seats[aiSeat].name, comment: reportText, memo: memo.memo, view: memo.view, profile: g.ai[aiSeat].profile }); setReportText(null); }}>저장</button>
              <button onClick={() => setReportText(null)}>취소</button>
            </div>
          )}
        </div>
      )}
      <div className="rv-foot">
        <button onClick={() => useStore.setState({ screen: 'result' })}>결과 화면</button>
        <button disabled={g.reports.length === 0} onClick={() => exportJson(`ai-reports-${g.id}.json`, { kind: 'holdem-pub-ai-reports', reports: g.reports })}>신고 {g.reports.length}건 내보내기</button>
      </div>
      <Toast />
    </div>
  );
}

function optName(k: string) {
  if (k.startsWith('raise:')) return `벳/레이즈 ${fmt(+k.slice(6))}`;
  return ({ fold: '폴드', check: '체크', call: '콜' } as Record<string, string>)[k] ?? k;
}

function ReviewHeader({ filter, setFilter }: { filter: Filter; setFilter: (f: Filter) => void }) {
  return (
    <div className="rv-head">
      <b>복기</b>
      <div className="seg-opts">
        {([['all', '전체'], ['highlight', '★ 강조'], ['mine', '내가 참여'], ['allin', '올인']] as [Filter, string][]).map(([k, l]) => (
          <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
    </div>
  );
}
