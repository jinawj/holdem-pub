// 메인 스레드 → AI Web Worker 호출
import type { AiDecision, AnyMemory as AiMemory, AnyProfile as AiProfile } from './adapter';
import type { PlayerView } from '../engine/view';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (d: AiDecision) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; decision?: AiDecision; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.decision) p.resolve(e.data.decision);
      else p.reject(new Error(e.data.error));
    };
  }
  return worker;
}

export function askAi(view: PlayerView, profile: AiProfile, memory: AiMemory, speedMult: number): Promise<AiDecision> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, view, profile, memory, speedMult });
  });
}
