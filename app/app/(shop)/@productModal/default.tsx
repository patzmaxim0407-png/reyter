/* Порожній слот. Next вимагає default.tsx для кожного
   паралельного маршруту: він показується там, де перехоплення не
   спрацювало — зокрема при перезавантаженні сторінки товару. */
export default function ProductModalDefault() {
  return null;
}
