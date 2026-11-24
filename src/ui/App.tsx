import { useEffect } from 'react';
import { Game } from './Game';
import { ResultScreen } from './Result';
import { ReviewScreen } from './Review';
import { SettingsScreen } from './Settings';
import { defaultSettings, useStore } from './store';

// 개발 중에만: 자동 화면 점검(Playwright)이 상태를 읽을 수 있게
if (import.meta.env.DEV) (window as any).__store = useStore;

export function App() {
  const screen = useStore((s) => s.screen);
  const hasGame = useStore((s) => !!s.game);
  useEffect(() => {
    useStore.getState().init();
    // 개발용 올인 연출 테스트: ?demo=allin&n=2|3|4 (AI가 항상 올인/콜)
    if (import.meta.env.DEV) {
      const q = new URLSearchParams(location.search);
      if (q.get('demo') === 'allin') {
        const n = Math.max(2, Math.min(10, +(q.get('n') ?? 2)));
        useStore.getState().newGame({ ...defaultSettings, seats: n, aiSpeed: 'normal' });
        useStore.getState().game!.debug = { aiAllIn: true };
      }
    }
  }, []);
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    document.addEventListener('contextmenu', block);
    return () => document.removeEventListener('contextmenu', block);
  }, []);
  if (screen === 'game' && hasGame) return <Game />;
  if (screen === 'result' && hasGame) return <ResultScreen />;
  if (screen === 'review' && hasGame) return <ReviewScreen />;
  return <SettingsScreen />;
}
