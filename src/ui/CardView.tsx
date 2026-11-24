import { rankOf, suitOf, RANKS, SUIT_SYMBOL } from '../engine/cards';

/** board = 커뮤니티 카드(크게), mine = 내 카드, 그 외 = 다른 자리(작게) */
export function CardView({ c, hidden, board, mine, dim }: { c?: number; hidden?: boolean; board?: boolean; mine?: boolean; dim?: boolean }) {
  const size = board ? ' board-card' : mine ? ' mine' : ' other';
  if (hidden || c === undefined) return <span className={'card back' + size} />;
  const s = suitOf(c);
  const r = RANKS[rankOf(c)];
  return (
    <span className={'card' + size + (dim ? ' dim' : '') + ` s${s}`}>
      <span className="rk">{r === 'T' ? '10' : r}</span>
      <span className="st">{SUIT_SYMBOL[s]}</span>
    </span>
  );
}
