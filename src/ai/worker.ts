// Web Worker 진입점: AI 계산을 화면과 분리
import { decide } from './adapter';
import type { AnyMemory as AiMemory, AnyProfile as AiProfile } from './adapter';
import type { PlayerView } from '../engine/view';

const rand = () => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 4294967296;
};

self.onmessage = (e: MessageEvent<{ id: number; view: PlayerView; profile: AiProfile; memory: AiMemory; speedMult: number; recallEnabled: boolean }>) => {
  const { id, view, profile, memory, speedMult, recallEnabled } = e.data;
  try {
    const d = decide(view, profile, memory, { rand, speedMult, recallEnabled });
    (self as unknown as Worker).postMessage({ id, decision: d });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
