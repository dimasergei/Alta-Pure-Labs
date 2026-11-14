'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const js=fs.readFileSync('checkout-reference.js','utf8'),css=fs.readFileSync('checkout-reference.css','utf8');
test('shipping trust, email help, SMS opt-in and linked legal notices',()=>{
 for(const t of ['3RD PARTY TESTED','Order confirmation and tracking go here. Leave blank to use your account email.','Consent is not a condition of purchase.','Reply HELP for help or STOP to cancel.','/privacy-policy.html'])assert.ok(js.includes(t),t);
});
test('summary supports removal, active BOGO offer and no extra quote note',()=>{
 assert.match(js,/data-nlx-remove/);assert.match(js,/checkout-bogo-free/);
 assert.match(js,/\[data-nlx-quote-note\].*textContent=''/);
});
test('inactive card and wallets cannot take card data or place orders',()=>{
 assert.match(js,/name="payment_choice" value="card" checked/);
 assert.match(js,/Card number \*<input disabled/);
 assert.match(js,/nlx-wallet-unavailable" disabled/);
 assert.match(js,/selected==='bank'&&bank/);
});
test('membership and bank option labels and responsive cards',()=>{
 for(const t of ['ALTA GOLD MEMBERSHIP','Monthly','Annual','No thanks','Compare plans','Same-Day Bank Payment','No Fees!','5% off'])assert.ok(js.includes(t),t);
 assert.match(css,/\.nlx-payment-choice/);assert.match(css,/\.nlx-trust svg/);
});
