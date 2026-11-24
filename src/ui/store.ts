import { create } from 'zustand';
import { AiSpeed, AI_SPEED_MULT, Difficulty, DEFAULT_LEVEL_MINUTES, SAVE_VERSION, START_STACK_MULT } from '../config';
import { createAiProfiles, newMemory, updateMemory, wantsToShow, makeProfile } from '../ai/v1';
import type { AiMemory, AiProfile, AiDecision } from '../ai/v1';
import { applyMove, IllegalActionError } from '../engine/hand';
import { aliveSeats, createTournament, finishHand, forfeit, startNextHand, TournamentState, LEVELS } from '../engine/tournament';
import type { Move } from '../engine/types';
import { cryptoInt, cryptoSeed, seedToString } from '../engine/rng';
import { makePlayerView } from '../engine/view';
import { ActionMemo, HandRecord, makeHandRecord, summaryFor } from '../game/summary';
import nicknames from '../data/nicknames.json';
import { kvDel, kvGet, kvSet } from '../persist/db';
import { exportJson, migrateSave } from '../persist/file';

export interface Settings { seats: number; stackBB: number; levelMinutes: number; aiSpeed: AiSpeed; difficulty: Difficulty; recall: boolean; /** 내 닉네임 (브라우저에 기억) */ myName?: string }
export const defaultSettings: Settings = { seats: 8, stackBB: 200, levelMinutes: DEFAULT_LEVEL_MINUTES, aiSpeed: 'normal', difficulty: 'normal', recall: true };

export interface Highlight { handNo: number; actionIndex: number; street: string }
export interface Report { id: string; at: number; handNo: number; actionIndex: number; seat: number; name: string; comment: string; memo: unknown; view: unknown; profile: unknown }
export interface Finished { reason: 'win' | 'bust' | 'forfeit'; place: number; handNo: number; elapsedMs: number; level: number }

export interface GameSave {
  kind: 'holdem-pub-save';
  version: number;
  id: string;
  createdAt: number;
  settings: Settings;
  t: TournamentState;
  ai: Record<number, { profile: AiProfile; memory: AiMemory }>;
  colors: string[];
  levelRemainingMs: number;
  elapsedMs: number;
  history: HandRecord[];
  highlights: Highlight[];
  curMemos: ActionMemo[];
  curBaseline: ActionMemo[];
  voluntaryShown: number[];
  finished: Finished | null;
  reports: Report[];
  /** 개발용: AI가 항상 올인/콜 (올인 연출 테스트) */
  debug?: { aiAllIn?: boolean };
}

export interface ArchiveEntry { id: string; createdAt: number; seats: number; place: number; reason: Finished['reason']; hands: number; highlights: number }

export type Screen = 'settings' | 'game' | 'result' | 'review';
export type Phase = 'idle' | 'ai' | 'human' | 'handEnd';

const HUMAN = 0;
const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#ff6b9d', '#95a5a6', '#c0ca33'];

interface Store {
  screen: Screen;
  game: GameSave | null;
  rev: number;
  paused: boolean;
  autoPaused: boolean;
  phase: Phase;
  thinkingSeat: number | null;
  hasAutosave: boolean;
  archive: ArchiveEntry[];
  review: { startHand?: number; onlyHighlights?: boolean } | null;
  toast: string | null;
  /** 카드 나눠주기·보드 공개 연출이 끝나는 시각 (그때까지 진행 멈춤) */
  holdUntil: number;
  /** 마지막 액션 시각 (다음 사람 행동 전 최소 간격용) */
  lastActionAt: number;
  hold(until: number): void;
  init(): Promise<void>;
  newGame(s: Settings): void;
  resume(): Promise<void>;
  bump(): void;
  setPaused(p: boolean, auto?: boolean): void;
  setPhase(p: Phase, seat?: number | null): void;
  humanMove(m: Move): void;
  applyAi(seat: number, d: AiDecision, view: unknown): void;
  setBaseline(m: ActionMemo): void;
  startHand(): void;
  endHand(): void;
  toggleHighlight(): void;
  doForfeit(): void;
  exportFile(): Promise<void>;
  importFile(raw: unknown): void;
  openReview(opts: { startHand?: number; onlyHighlights?: boolean }): void;
  openArchive(id: string): Promise<void>;
  addReport(r: Omit<Report, 'id' | 'at'>): void;
  goSettings(): void;
  showToast(s: string): void;
  tickTimer(dtMs: number): void;
}

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = cryptoInt(i + 1); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
const cryptoRand = () => cryptoInt(1 << 30) / (1 << 30);

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function autosave(g: GameSave) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { kvSet('current', g).catch(() => {}); }, 150);
}

async function archiveGame(g: GameSave) {
  const list = ((await kvGet<ArchiveEntry[]>('archive')) ?? []).filter((x) => x.id !== g.id);
  list.unshift({ id: g.id, createdAt: g.createdAt, seats: g.settings.seats, place: g.finished!.place, reason: g.finished!.reason, hands: g.history.length, highlights: g.highlights.length });
  await kvSet('tourney:' + g.id, g);
  await kvSet('archive', list.slice(0, 50));
  await kvDel('current');
  return list;
}

export const useStore = create<Store>((set, get) => ({
  screen: 'settings', game: null, rev: 0, paused: false, autoPaused: false, phase: 'idle', thinkingSeat: null,
  hasAutosave: false, archive: [], review: null, toast: null, holdUntil: 0, lastActionAt: 0,

  hold(until) { if (until > get().holdUntil) set({ holdUntil: until }); },

  async init() {
    try {
      const cur = await kvGet<GameSave>('current');
      const archive = (await kvGet<ArchiveEntry[]>('archive')) ?? [];
      set({ hasAutosave: !!cur && !cur.finished, archive });
    } catch { /* 저장소 사용 불가 */ }
  },

  newGame(s) {
    // 브라우저가 저장 공간이 부족할 때 기록을 지우지 않도록 '영구 저장' 요청 (지원 안 하면 무시)
    try { navigator.storage?.persist?.(); } catch { /* */ }
    const n = s.seats;
    // 내 닉네임(설정 화면에서 정한 것, 최대 5글자). AI 이름과 겹치지 않게
    const me = (s.myName ?? '').trim().slice(0, 5) || '나';
    const names = [me, ...shuffle((nicknames as string[]).filter((x) => x !== me)).slice(0, n - 1)];
    const t = createTournament(names, HUMAN, s.stackBB * START_STACK_MULT);
    const profiles = createAiProfiles(s.difficulty, n - 1, cryptoRand);
    const ai: GameSave['ai'] = {};
    for (let i = 1; i < n; i++) ai[i] = { profile: profiles[i - 1], memory: newMemory() };
    const g: GameSave = {
      kind: 'holdem-pub-save', version: SAVE_VERSION, id: seedToString(cryptoSeed()).slice(0, 12), createdAt: Date.now(),
      settings: s, t, ai, colors: shuffle(COLORS).slice(0, n), levelRemainingMs: s.levelMinutes * 60000, elapsedMs: 0,
      history: [], highlights: [], curMemos: [], curBaseline: [], voluntaryShown: [], finished: null, reports: [],
    };
    set({ game: g, screen: 'game', paused: false, autoPaused: false, phase: 'idle', rev: get().rev + 1, hasAutosave: true });
    autosave(g);
  },

  async resume() {
    const g = await kvGet<GameSave>('current');
    if (!g) return;
    set({ game: g, screen: g.finished ? 'result' : 'game', paused: true, autoPaused: false, phase: 'idle', rev: get().rev + 1 });
  },

  bump() { set({ rev: get().rev + 1 }); },

  setPaused(p, auto = false) {
    if (!get().game || get().game!.finished) return;
    if (!p && get().autoPaused && auto) { set({ autoPaused: false }); return; } // 자동 일시정지 해제는 사람이
    set({ paused: p, autoPaused: p && auto });
  },

  setPhase(p, seat = null) { set({ phase: p, thinkingSeat: seat }); },

  humanMove(m) {
    const g = get().game;
    const h = g?.t.hand;
    if (!g || !h || h.toAct !== HUMAN) return;
    try { applyMove(h, m); } catch (e) { if (e instanceof IllegalActionError) { get().showToast('그 액션은 할 수 없어요'); return; } throw e; }
    set({ phase: 'idle', rev: get().rev + 1, lastActionAt: Date.now() });
    autosave(g);
  },

  applyAi(seat, d, view) {
    const g = get().game;
    const h = g?.t.hand;
    if (!g || !h || h.toAct !== seat) return;
    const actionIndex = h.actions.length;
    try {
      applyMove(h, d.type === 'raise' ? { type: 'raise', to: d.to! } : { type: d.type });
    } catch (e) {
      if (!(e instanceof IllegalActionError)) throw e;
      console.warn('AI 규칙 위반 (AI 쪽 버그로 기록):', d);
      applyMove(h, h.players.find((p) => p.seat === seat)!.committed >= h.currentBet ? { type: 'check' } : { type: 'fold' });
    }
    g.curMemos.push({ actionIndex, seat, memo: d.memo, view: view as any });
    set({ phase: 'idle', thinkingSeat: null, rev: get().rev + 1, lastActionAt: Date.now() });
    autosave(g);
  },

  setBaseline(m) {
    const g = get().game;
    if (!g) return;
    if (!g.curBaseline.some((x) => x.actionIndex === m.actionIndex)) g.curBaseline.push(m);
  },

  startHand() {
    const g = get().game;
    if (!g || g.finished) return;
    g.curMemos = []; g.curBaseline = []; g.voluntaryShown = [];
    startNextHand(g.t, seedToString(cryptoSeed()), cryptoInt);
    set({ phase: 'idle', rev: get().rev + 1 });
    autosave(g);
  },

  endHand() {
    const g = get().game;
    const h = g?.t.hand;
    if (!g || !h || h.street !== 'done') return;
    // AI 쇼다운 행동(보여주기) — 핸드 기록에 남김
    const r = h.result!;
    for (const p of h.players) {
      if (p.seat === HUMAN || r.shown.includes(p.seat) || p.folded && !(r.won[p.seat] > 0)) continue;
      const won = (r.won[p.seat] ?? 0) > 0;
      if (won && wantsToShow(g.ai[p.seat].profile, won, false, cryptoRand)) g.voluntaryShown.push(p.seat);
    }
    g.history.push(makeHandRecord(h, g.curMemos, g.curBaseline, g.voluntaryShown, HUMAN));
    for (const p of h.players) {
      if (p.seat === HUMAN) continue;
      g.ai[p.seat].memory = updateMemory(g.ai[p.seat].memory, g.ai[p.seat].profile, summaryFor(h, p.seat), g.settings.recall);
    }
    finishHand(g.t);
    g.t.hand = null;
    const me = g.t.seats[HUMAN];
    if (me.out || g.t.finished) {
      g.finished = { reason: me.out ? 'bust' : 'win', place: me.place ?? 1, handNo: g.t.handNo, elapsedMs: g.elapsedMs, level: g.t.levelIndex + 1 };
      set({ screen: 'result', phase: 'idle', rev: get().rev + 1, hasAutosave: false });
      archiveGame(g).then((archive) => set({ archive })).catch(() => {});
      logAiTiming(g);
      return;
    }
    set({ phase: 'idle', rev: get().rev + 1 });
    autosave(g);
  },

  toggleHighlight() {
    const g = get().game;
    if (!g) return;
    const h = g.t.hand;
    const handNo = h ? h.handNo : g.history[g.history.length - 1]?.handNo;
    if (!handNo) return;
    const i = g.highlights.findIndex((x) => x.handNo === handNo);
    if (i >= 0) g.highlights.splice(i, 1);
    else {
      const actionIndex = h ? h.actions.length - 1 : (g.history[g.history.length - 1]?.actions.length ?? 1) - 1;
      g.highlights.push({ handNo, actionIndex, street: h ? h.street : 'done' });
    }
    set({ rev: get().rev + 1 });
    autosave(g);
  },

  doForfeit() {
    const g = get().game;
    if (!g || g.finished) return;
    const h = g.t.hand;
    if (h && h.street !== 'done') {
      // 그 시점까지 핸드 기록에 남김 (내 카드는 폴드 처리)
      const me = h.players.find((p) => p.seat === HUMAN);
      if (me) me.folded = true;
      const rec = makeHandRecord(h, g.curMemos, g.curBaseline, [], HUMAN);
      rec.forfeited = true;
      g.history.push(rec);
    } else if (h && h.street === 'done') {
      g.history.push(makeHandRecord(h, g.curMemos, g.curBaseline, g.voluntaryShown, HUMAN));
    }
    g.t.hand = null;
    forfeit(g.t, HUMAN);
    g.finished = { reason: 'forfeit', place: g.t.seats[HUMAN].place ?? aliveSeats(g.t).length + 1, handNo: g.t.handNo, elapsedMs: g.elapsedMs, level: g.t.levelIndex + 1 };
    set({ screen: 'result', paused: false, phase: 'idle', rev: get().rev + 1, hasAutosave: false });
    archiveGame(g).then((archive) => set({ archive })).catch(() => {});
  },

  async exportFile() {
    const g = get().game;
    if (!g) return;
    if (g.t.hand && g.t.hand.street !== 'done') { get().showToast('파일 내보내기는 핸드와 핸드 사이에만 할 수 있어요'); return; }
    const d = new Date();
    await exportJson(`holdem-pub-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${g.t.handNo}.json`, g);
  },

  importFile(raw) {
    try {
      const g = migrateSave(raw) as GameSave;
      set({ game: g, screen: g.finished ? 'result' : 'game', paused: true, phase: 'idle', rev: get().rev + 1 });
      if (!g.finished) autosave(g);
      get().showToast('불러왔어요. ▶ 를 누르면 이어서 진행해요');
    } catch (e) {
      get().showToast(String((e as Error).message ?? e));
    }
  },

  openReview(opts) { set({ screen: 'review', review: opts }); },

  async openArchive(id) {
    const g = await kvGet<GameSave>('tourney:' + id);
    if (g) set({ game: g, screen: 'result', rev: get().rev + 1 });
  },

  addReport(r) {
    const g = get().game;
    if (!g) return;
    g.reports.push({ ...r, id: seedToString(cryptoSeed()).slice(0, 8), at: Date.now() });
    if (g.finished) kvSet('tourney:' + g.id, g).catch(() => {});
    set({ rev: get().rev + 1 });
    get().showToast('신고를 저장했어요');
  },

  goSettings() { get().init(); set({ screen: 'settings', review: null }); },

  showToast(s) {
    set({ toast: s });
    setTimeout(() => { if (get().toast === s) set({ toast: null }); }, 2600);
  },

  tickTimer(dt) {
    const g = get().game;
    if (!g || g.finished || get().paused) return;
    g.elapsedMs += dt;
    const finalLevel = g.t.levelIndex + g.t.pendingLevelUp >= LEVELS.length - 1;
    if (finalLevel) { g.levelRemainingMs = 0; return; }
    g.levelRemainingMs -= dt;
    if (g.levelRemainingMs <= 0) {
      g.t.pendingLevelUp++;
      g.levelRemainingMs += g.settings.levelMinutes * 60000;
    }
  },
}));

export function aiSpeedMult(g: GameSave) { return AI_SPEED_MULT[g.settings.aiSpeed]; }
export const HUMAN_SEAT = HUMAN;

/** 사람 결정 시점 "AI 기준" 계산용 프로필 (기록만) */
export const baselineProfile = makeProfile('solver', 10, () => 0.5);

export function viewFor(g: GameSave, seat: number) {
  return makePlayerView(g.t.hand!, seat, aliveSeats(g.t).length);
}

function logAiTiming(g: GameSave) {
  const all = g.history.flatMap((h) => h.memos.map((m) => m.memo as { calcMs: number; street: string }));
  const by: Record<string, number[]> = {};
  for (const m of all) (by[m.street] ??= []).push(m.calcMs);
  const s = Object.entries(by).map(([k, a]) => `${k}: 평균 ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)}ms (${a.length}회)`).join(', ');
  console.info('[AI 계산 시간]', s);
}
