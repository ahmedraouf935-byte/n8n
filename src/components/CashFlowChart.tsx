"use client";
import { useState } from "react";

interface Day { day: string; collected: number; spent: number }

const fmt = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 });
const dfmt = new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short", timeZone: "UTC" });

/** Grouped bars: cash collected vs cash spent per day (from the cash ledger). One axis, legend + table fallback. */
export function CashFlowChart({ data }: { data: Day[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 640, H = 200, padB = 24, padT = 12, padX = 8;
  const max = Math.max(1, ...data.flatMap((d) => [d.collected, d.spent]));
  const nice = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / nice) * nice;
  const slot = (W - padX * 2) / data.length;
  const bw = Math.max(3, Math.min(14, slot / 2 - 3));
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  const empty = data.every((d) => !d.collected && !d.spent);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-text-2">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--series-1)" }} />تحصيل من العملاء</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--series-2)" }} />مصروفات ومدفوعات</span>
        <button className="ms-auto text-info hover:underline" onClick={() => setTable(!table)}>{table ? "عرض الرسم" : "عرض كجدول"}</button>
      </div>
      {empty && <p className="mb-2 text-xs text-muted">لا توجد حركات نقدية مسجلة خلال آخر 14 يومًا.</p>}
      {table ? (
        <table className="w-full text-sm">
          <thead><tr className="text-right text-xs text-muted"><th className="py-1">اليوم</th><th>تحصيل</th><th>مصروفات</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.day} className="border-t border-border"><td className="py-1">{dfmt.format(new Date(d.day))}</td><td className="num">{fmt.format(d.collected)}</td><td className="num">{fmt.format(d.spent)}</td></tr>)}</tbody>
        </table>
      ) : (
        <div className="relative" dir="ltr">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="التدفق النقدي اليومي" style={{ background: "var(--chart-surface)" }}>
            {[0, 0.5, 1].map((t) => (
              <g key={t}>
                <line x1={padX} x2={W - padX} y1={y(top * t)} y2={y(top * t)} stroke="var(--grid)" strokeWidth={1} />
                <text x={W - padX} y={y(top * t) - 3} textAnchor="end" fontSize={10} fill="var(--muted)">{fmt.format(top * t)}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = padX + slot * (data.length - 1 - i) + slot / 2; // RTL: newest on the left edge reads naturally right-to-left
              return (
                <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect x={cx - slot / 2} y={padT} width={slot} height={H - padT - padB} fill={hover === i ? "var(--grid)" : "transparent"} opacity={0.5} />
                  {d.collected > 0 && <rect x={cx - bw - 1} y={y(d.collected)} width={bw} height={Math.max(1, y(0) - y(d.collected))} rx={3} fill="var(--series-1)" />}
                  {d.spent > 0 && <rect x={cx + 1} y={y(d.spent)} width={bw} height={Math.max(1, y(0) - y(d.spent))} rx={3} fill="var(--series-2)" />}
                  {(i % 3 === 0 || i === data.length - 1) && (
                    <text x={cx} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--muted)">{dfmt.format(new Date(d.day))}</text>
                  )}
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="pointer-events-none absolute top-2 left-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow" dir="rtl">
              <div className="font-semibold">{dfmt.format(new Date(data[hover].day))}</div>
              <div>تحصيل: <span className="num">{fmt.format(data[hover].collected)}</span> ج.م</div>
              <div>مصروفات: <span className="num">{fmt.format(data[hover].spent)}</span> ج.م</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
