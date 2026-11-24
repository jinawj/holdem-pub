import chips from '../data/chips.json';

type ChipDef = { value: number; color: string; edge: string; text: string };
const CHIPS = chips as ChipDef[];

export const fmt = (n: number) => n.toLocaleString('en-US');

/** 큰 칩부터 나누기. 칩 개수가 너무 많으면 큰 단위로 */
export function breakdown(amount: number, maxChips = 40): ChipDef[] {
  const out: ChipDef[] = [];
  let rest = amount;
  for (const c of CHIPS) {
    while (rest >= c.value) { out.push(c); rest -= c.value; }
  }
  if (out.length > maxChips) return out.slice(0, maxChips);
  return out;
}

function shortVal(v: number) {
  return v >= 1000 ? `${v / 1000}K` : String(v);
}

export function Chip({ c, size }: { c: ChipDef; size: number }) {
  return (
    <span className="chip" style={{ width: size, height: size, background: c.color, borderColor: c.edge, color: c.text, fontSize: size * 0.32 }}>
      {size >= 18 ? shortVal(c.value) : ''}
    </span>
  );
}

/** 칩 더미: 같은 칩끼리 세로로 쌓고 옆으로 줄을 늘린다 (한 줄 최대 perCol개, 최대 cols줄) */
export function ChipStack({ amount, size = 18, perCol = 8, cols = 6, label, big }: { amount: number; size?: number; perCol?: number; cols?: number; label?: string; big?: boolean }) {
  if (amount <= 0) return null;
  let list = breakdown(amount, perCol * cols);
  const groups: ChipDef[][] = [];
  for (const c of list) {
    const g = groups[groups.length - 1];
    if (g && g[0].value === c.value && g.length < perCol) g.push(c);
    else groups.push([c]);
  }
  list = [];
  const shown = groups.slice(0, cols);
  return (
    <div className={'chipstack' + (big ? ' big' : '')}>
      <div className="chipcols">
        {shown.map((g, i) => (
          <div className="chipcol" key={i} style={{ height: size + (g.length - 1) * size * 0.18 }}>
            {g.map((c, k) => (
              <span key={k} style={{ position: 'absolute', bottom: k * size * 0.18, left: 0 }}>
                <Chip c={c} size={size} />
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="chipamt">{label ? <span className="chiplabel">{label}</span> : null}{fmt(amount)}</div>
    </div>
  );
}
