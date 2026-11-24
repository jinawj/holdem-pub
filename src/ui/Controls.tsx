import { useEffect, useRef, useState } from 'react';
import type { Legal, Move } from '../engine/types';
import { fmt } from './Chips';

export function Controls({ legal, bb, pot, onMove, disabled }: { legal: Legal | null; bb: number; pot: number; onMove: (m: Move) => void; disabled?: boolean }) {
  const callLevel = legal ? legal.committed + legal.callAmount : 0;
  const [val, setVal] = useState(callLevel);
  const [confirmAllIn, setConfirmAllIn] = useState(false);
  const [confirmFold, setConfirmFold] = useState(false);
  /** 직접 입력 중인 글자 (입력이 끝나면 null) */
  const [draft, setDraft] = useState<string | null>(null);
  const step = bb >= 2000 ? 500 : 100;
  const key = legal ? `${legal.seat}-${legal.currentBet}-${legal.committed}-${legal.stack}` : 'none';
  useEffect(() => { setVal(callLevel); setDraft(null); setConfirmAllIn(false); setConfirmFold(false); }, [key]);

  if (!legal || disabled) {
    return <div className="controls waiting"><span>{disabled ? '' : '상대 차례…'}</span></div>;
  }
  const canRaise = legal.canRaise;
  const minV = callLevel;
  const maxV = canRaise ? legal.maxRaiseTo : callLevel;

  const snap = (v: number) => {
    if (!canRaise) return callLevel;
    let x = Math.round(v / step) * step;
    if (x >= maxV - step / 2) return maxV;
    if (x <= minV) return minV;
    if (x < legal.minRaiseTo) x = v - minV < (legal.minRaiseTo - minV) / 2 ? minV : legal.minRaiseTo;
    return Math.min(maxV, x);
  };
  // 입력 중이면 입력한 금액 기준 (규칙에 맞게 보정한 값으로 버튼 이름이 바뀜)
  const typed = draft !== null && draft !== '' ? parseInt(draft, 10) : NaN;
  const v = snap(Number.isFinite(typed) ? typed : val);
  /** 팟 기준 크기: 콜한 뒤의 팟 × 비율만큼 (벳이면 팟 × 비율) */
  const potSize = (f: number) => snap(legal.currentBet + f * (pot + legal.callAmount));
  const quick: [string, number][] = [['25%', 0.25], ['50%', 0.5], ['Pot', 1], ['2x', 2]];
  const commitDraft = () => { if (draft !== null) { setVal(v); setDraft(null); } };
  const isAllIn = canRaise && v === maxV;
  let label: string;
  if (v === callLevel) label = legal.canCheck ? '체크' : `콜 ${fmt(legal.callAmount)}`;
  else if (isAllIn) label = `All-in ${fmt(v)}`;
  else label = legal.currentBet === 0 ? `벳 ${fmt(v)}` : `레이즈 ${fmt(v)}`;

  const doMain = () => {
    if (v === callLevel) onMove(legal.canCheck ? { type: 'check' } : { type: 'call' });
    else onMove({ type: 'raise', to: v });
  };
  const doAllIn = () => {
    if (!confirmAllIn) { setConfirmAllIn(true); setTimeout(() => setConfirmAllIn(false), 2500); return; }
    if (canRaise) onMove({ type: 'raise', to: legal.maxRaiseTo });
    else onMove(legal.canCheck ? { type: 'check' } : { type: 'call' });
  };
  const doFold = () => {
    if (legal.canCheck && !confirmFold) { setConfirmFold(true); setTimeout(() => setConfirmFold(false), 2500); return; }
    onMove({ type: 'fold' });
  };
  const nudge = (d: number) => {
    setDraft(null);
    if (d > 0 && v === callLevel) setVal(Math.min(maxV, legal.minRaiseTo));
    else if (d < 0 && v === legal.minRaiseTo) setVal(callLevel);
    else setVal(Math.max(minV, Math.min(maxV, v + d * step)));
  };

  return (
    <div className="controls">
      {canRaise && (
        <div className="size-row">
          {quick.map(([name, f]) => {
            const to = potSize(f);
            return (
              <button key={name} className={'quick' + (v === to && v !== callLevel ? ' on' : '')} onClick={() => { setDraft(null); setVal(to); }}>{name}</button>
            );
          })}
          <input
            className="bet-input" inputMode="numeric" enterKeyHint="done" aria-label="베팅 금액 직접 입력"
            value={draft ?? (v === callLevel ? '' : fmt(v))}
            placeholder={fmt(legal.minRaiseTo)}
            onFocus={(e) => { setDraft(v === callLevel ? '' : String(v)); requestAnimationFrame(() => e.target.select()); }}
            onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
            onBlur={commitDraft}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          />
        </div>
      )}
      {canRaise && (
        <div className="slider-row">
          <button className="nudge" onClick={() => nudge(-1)} aria-label="줄이기">−</button>
          <BigSlider min={minV} max={maxV} value={v} onChange={(x) => { setDraft(null); setVal(snap(x)); }} />
          <button className="nudge" onClick={() => nudge(1)} aria-label="늘리기">＋</button>
        </div>
      )}
      <div className="btn-row">
        <button className={'btn fold' + (confirmFold ? ' confirm' : '')} onClick={doFold}>{confirmFold ? '체크 가능! 그래도 폴드' : '폴드'}</button>
        <button className={'btn main' + (v === callLevel ? (legal.canCheck ? ' check' : ' call') : isAllIn ? ' is-allin' : ' raise')} onClick={doMain}>{label}</button>
        <button className={'btn allin' + (confirmAllIn ? ' confirm' : '')} onClick={doAllIn}>{confirmAllIn ? '한 번 더 눌러 All-in' : 'All-in'}</button>
      </div>
    </div>
  );
}

function BigSlider({ min, max, value, onChange }: { min: number; max: number; value: number; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const frac = max > min ? (value - min) / (max - min) : 0;
  const setFrom = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    onChange(min + f * (max - min));
  };
  return (
    <div
      className="bigslider" ref={ref}
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setFrom(e.clientX); }}
      onPointerMove={(e) => { if (e.buttons) setFrom(e.clientX); }}
      role="slider" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
    >
      <div className="track"><div className="fill" style={{ width: frac * 100 + '%' }} /></div>
      <div className="thumb" style={{ left: `calc(${frac * 100}% - 18px)` }} />
    </div>
  );
}
