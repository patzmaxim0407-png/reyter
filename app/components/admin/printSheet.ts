import { fmt } from '@/lib/catalog';
import type { PrintOrder } from '@/lib/admin/orders';

/* Аркуш для друку. Окреме вікно, а не поточна сторінка: інакше
   на папір ішли б смуги фільтрів, чіпи й кнопки, а зі згорнутої
   картки — жодної позиції, і зібрати посилку за таким аркушем
   неможливо.

   Стилі вбудовані сюди: у нового вікна свого CSS немає. */

function esc(v: unknown): string {
  return String(v ?? '').replace(
    /[&<>"]/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string
  );
}

const CSS = `
  body { font: 13px/1.45 system-ui, sans-serif; color: #111; margin: 24px; }
  .o { page-break-inside: avoid; border-bottom: 2px solid #111; padding-bottom: 14px; margin-bottom: 18px; }
  .o:last-child { border-bottom: 0; }
  h2 { font-size: 16px; margin: 0 0 2px; }
  .muted { color: #555; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #ddd; font-size: 12px; }
  th { background: #f3f3f3; }
  td.n, th.n { text-align: right; white-space: nowrap; }
  .parts { color: #555; font-size: 11px; }
  .total { margin-top: 6px; text-align: right; font-weight: 700; }
  @media print { body { margin: 0 12mm; } }
`;

export function printSheet(list: PrintOrder[]): string {
  const rows = (o: PrintOrder) =>
    o.items
      .map(
        (i) =>
          `<tr><td>${esc(i.name)}` +
          (i.category ? ` <span class="muted">${esc(i.category)}</span>` : '') +
          (i.size ? ` · <b>${esc(i.size)}</b>` : '') +
          (i.parts.length ? `<div class="parts">${i.parts.map(esc).join('<br>')}</div>` : '') +
          `</td><td class="n">${i.qty}</td><td class="n">${fmt(i.sum)} грн</td></tr>`
      )
      .join('');

  const card = (o: PrintOrder) =>
    `<article class="o">
       <h2>№${esc(o.num)} · ${esc(o.status)}</h2>
       <div class="muted">${esc(o.date)}</div>
       <p><b>${esc(o.name)}</b> · ${esc(o.phone)}${o.email ? ' · ' + esc(o.email) : ''}</p>
       ${o.address ? `<p>🚚 ${esc(o.address)}</p>` : ''}
       ${o.ttn ? `<p>📦 ТТН: <b>${esc(o.ttn)}</b></p>` : ''}
       ${o.confirm ? `<p class="muted">☎️ ${esc(o.confirm)}</p>` : ''}
       ${o.comment ? `<p class="muted">💬 ${esc(o.comment)}</p>` : ''}
       <table>
         <thead><tr><th>Товар</th><th class="n">К-сть</th><th class="n">Сума</th></tr></thead>
         <tbody>${rows(o)}</tbody>
       </table>
       <div class="total">До сплати: ${fmt(o.total)} грн</div>
     </article>`;

  return `<!doctype html><html lang="uk"><head><meta charset="utf-8">
    <title>REYTER — замовлення (${list.length})</title>
    <style>${CSS}</style></head><body>${list.map(card).join('')}</body></html>`;
}
