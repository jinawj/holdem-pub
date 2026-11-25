import { profileLabel } from '../ai/v2';
import { exportJson } from '../persist/file';
import { Toast } from './Game';
import { useStore } from './store';

export function ResultScreen() {
  const st = useStore();
  const g = st.game!;
  const f = g.finished!;
  const min = Math.floor(f.elapsedMs / 60000);
  const title = f.reason === 'win' ? '🏆 우승!' : f.reason === 'forfeit' ? '게임 포기' : `${f.place}위로 탈락`;
  // 끝날 때 살아 있던 AI(내가 탈락·포기해서 순위가 안 정해짐)는 칩 순으로 위에
  const order = [...g.t.seats].sort((a, b) => {
    if (a.place === null && b.place === null) return b.stack - a.stack;
    if (a.place === null) return -1;
    if (b.place === null) return 1;
    return a.place - b.place;
  });
  const memos = g.history.flatMap((h) => h.memos.map((m) => m.memo as { calcMs: number }));
  const avgCalc = memos.length ? memos.reduce((a, m) => a + m.calcMs, 0) / memos.length : 0;
  return (
    <div className="result">
      <h1>{title}</h1>
      <p className="tag">{f.reason === 'forfeit' ? `포기 시점 순위 ${f.place}위 · ` : ''}레벨 {f.level} · {g.history.length}핸드 · {min}분 진행</p>
      {g.highlights.length > 0 && (
        <button className="big primary" onClick={() => st.openReview({ onlyHighlights: true })}>★ 강조한 핸드 {g.highlights.length}개 복기하기</button>
      )}
      <button className="big" onClick={() => st.openReview({})}>전체 핸드 복기</button>
      <h3>최종 순위 · AI 정체 공개</h3>
      <ul className="standings">
        {order.map((s) => (
          <li key={s.seat} style={{ borderLeftColor: g.colors[s.seat] }}>
            <b>{s.place !== null ? `${s.place}위` : `생존 ${s.stack.toLocaleString('en-US')}`}</b> {s.name} {s.isHuman ? '' : <span className="who">— {profileLabel(g.ai[s.seat].profile)}</span>}
          </li>
        ))}
      </ul>
      <p className="small">AI 평균 계산 시간 {avgCalc.toFixed(1)}ms ({memos.length}회 결정, 연출용 고민 시간 제외)</p>
      {g.reports.length > 0 && <button className="big" onClick={() => exportJson(`ai-reports-${g.id}.json`, { kind: 'holdem-pub-ai-reports', reports: g.reports })}>AI 신고 {g.reports.length}건 내보내기</button>}
      <button className="big" onClick={() => exportJson(`holdem-pub-${g.id}-record.json`, g)}>전체 기록 내보내기</button>
      <button className="big" onClick={() => st.goSettings()}>처음 화면</button>
      <Toast />
    </div>
  );
}
