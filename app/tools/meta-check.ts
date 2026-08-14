/* Перевірка формату й дедуплікації Meta Pixel без мережі. */

import {
  metaCartParams,
  metaProductParams,
  trackMeta,
  trackMetaOnce
} from '../lib/meta.ts';

let failed = 0;
function ok(name: string, cond: boolean) {
  if (!cond) failed++;
  console.log(`${cond ? '✓' : '✗'} ${name}`);
}

const stored = new Map<string, string>();
const calls: unknown[][] = [];
Object.assign(globalThis, {
  window: {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value)
    },
    fbq: (...args: unknown[]) => calls.push(args)
  }
});

const product = metaProductParams({ id: 'SW-003', name: 'Swimwear', price: 880, category: 'swim' });
trackMeta('ViewContent', product);
trackMeta('AddToCart', product);

const checkout = metaCartParams(
  [
    { id: 'SW-003', quantity: 2, item_price: 880 },
    { id: 'MBLE-003', quantity: 1, item_price: 560 }
  ],
  2320
);
trackMeta('InitiateCheckout', checkout);

const purchase = { ...checkout, order_id: 'R-TEST-1' };
trackMetaOnce('purchase:R-TEST-1', 'Purchase', purchase, 'reyter_purchase_R-TEST-1');
trackMetaOnce('purchase:R-TEST-1', 'Purchase', purchase, 'reyter_purchase_R-TEST-1');

ok('усі чотири стандартні події викликано', calls.length === 4);
ok('назви подій правильні',
   ['ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase'].every((event, i) => calls[i]?.[1] === event));
ok('checkout передає артикули, кількість, суму й валюту',
   JSON.stringify(calls[2]?.[2]) === JSON.stringify(checkout));
ok('Purchase не дублюється', calls.filter((call) => call[1] === 'Purchase').length === 1);
ok('Purchase має eventID для майбутнього CAPI',
   (calls[3]?.[3] as { eventID?: string })?.eventID === 'reyter_purchase_R-TEST-1');

if (failed) process.exit(1);
