import { useState } from 'react';
import { DIFFICULTY, Difficulty, LEVEL_MINUTES_OPTIONS, START_STACK_BB_OPTIONS, START_STACK_MULT, TABLE_SIZES, AiSpeed } from '../config';
import { pickJsonFile } from '../persist/file';
import { fmt } from './Chips';
import { Toast } from './Game';
import { defaultSettings, Settings as S, useStore } from './store';
import { AI_VERSION_LABEL, AI_VERSIONS, AiVersion } from '../ai/adapter';

function Seg<T extends string | number>({ label, opts, value, onChange, fmtOpt }: { label: string; opts: T[]; value: T; onChange: (v: T) => void; fmtOpt?: (v: T) => string }) {
  return (
    <div className="seg">
      <div className="seg-label">{label}</div>
      <div className="seg-opts">
        {opts.map((o) => (
          <button key={String(o)} className={o === value ? 'on' : ''} onClick={() => onChange(o)}>{fmtOpt ? fmtOpt(o) : String(o)}</button>
        ))}
      </div>
    </div>
  );
}

export function SettingsScreen() {
  const st = useStore();
  const [s, setS] = useState<S>(() => {
    try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem('settings') ?? '{}') }; } catch { return defaultSettings; }
  });
  const up = (p: Partial<S>) => { const n = { ...s, ...p }; setS(n); try { localStorage.setItem('settings', JSON.stringify(n)); } catch { /* */ } };
  return (
    <div className="settings">
      <h1>홀덤펍 토너먼트 <span>vs AI</span></h1>
      <p className="tag">싱글 테이블 노리밋 홀덤 토너먼트 · 가상 칩만 사용</p>
      {st.hasAutosave && <button className="big primary" onClick={() => st.resume()}>이어하기</button>}
      <div className="seg">
        <div className="seg-label">내 닉네임 (테이블에 표시, 최대 5글자 · 이 브라우저가 기억)</div>
        <input className="nick-input" maxLength={5} placeholder="나" value={s.myName ?? ''} aria-label="내 닉네임"
          onChange={(e) => up({ myName: e.target.value.slice(0, 5) })} />
      </div>
      <Seg label="테이블 인원 (나 포함)" opts={TABLE_SIZES} value={s.seats} onChange={(v) => up({ seats: v })} fmtOpt={(v) => `${v}명`} />
      <Seg label="시작 스택" opts={START_STACK_BB_OPTIONS} value={s.stackBB} onChange={(v) => up({ stackBB: v })} fmtOpt={(v) => `${fmt(v * START_STACK_MULT)} (${v}BB)`} />
      <Seg label="블라인드 레벨 시간" opts={LEVEL_MINUTES_OPTIONS} value={s.levelMinutes} onChange={(v) => up({ levelMinutes: v })} fmtOpt={(v) => `${v}분`} />
      <Seg label="난이도" opts={['normal', 'hard', 'veryhard'] as Difficulty[]} value={s.difficulty} onChange={(v) => up({ difficulty: v })} fmtOpt={(v) => DIFFICULTY[v].name} />
      <Seg label="AI 버전 (V3는 새 AI 시험판)" opts={AI_VERSIONS} value={(s.aiVersion ?? 'v2') as AiVersion} onChange={(v) => up({ aiVersion: v })} fmtOpt={(v) => AI_VERSION_LABEL[v]} />
      <Seg label="AI 속도" opts={['fast', 'normal', 'real'] as AiSpeed[]} value={s.aiSpeed} onChange={(v) => up({ aiSpeed: v })} fmtOpt={(v) => ({ fast: '빠름', normal: '보통', real: '리얼' })[v]} />
      <Seg label="AI 기억 반응 (쇼다운에서 본 장면에 흔들림)" opts={['on', 'off']} value={s.recall ? 'on' : 'off'} onChange={(v) => up({ recall: v === 'on' })} fmtOpt={(v) => (v === 'on' ? '켜기' : '끄기')} />
      <button className="big primary" onClick={() => st.newGame(s)}>{st.hasAutosave ? '새 토너먼트 시작' : '토너먼트 시작'}</button>
      <button className="big" onClick={async () => { try { st.importFile(await pickJsonFile()); } catch (e) { st.showToast('불러오기 실패: ' + String((e as Error).message)); } }}>파일 불러오기</button>
      {st.archive.length > 0 && (
        <div className="archive">
          <h3>지난 토너먼트</h3>
          {st.archive.map((a) => (
            <button key={a.id} className="arch" onClick={() => st.openArchive(a.id)}>
              {new Date(a.createdAt).toLocaleDateString()} · {a.seats}인 · {a.reason === 'forfeit' ? '포기' : `${a.place}위`} · {a.hands}핸드 {a.highlights ? `· ★${a.highlights}` : ''}
            </button>
          ))}
        </div>
      )}
      <Toast />
    </div>
  );
}
