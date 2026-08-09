/* Копіювання в буфер.

   navigator.clipboard є не завжди: його немає на http, і браузер
   може відмовити без дозволу. Тому запасний шлях через прихований
   textarea — саме він рятує на телефонах, де покупець і копіює
   номер накладної.

   Повертає, чи справді вийшло: рапортувати про успіх наосліп
   гірше, ніж чесно сказати «не вдалося». */
export async function copyText(text: string): Promise<boolean> {
  const value = String(text ?? '');
  if (!value) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* нижче запасний шлях */
  }

  try {
    const box = document.createElement('textarea');
    box.value = value;
    // поза екраном, але в потоці: display:none браузер не виділяє
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.left = '-9999px';
    document.body.appendChild(box);
    box.select();
    const done = document.execCommand('copy');
    box.remove();
    return done;
  } catch {
    return false;
  }
}
