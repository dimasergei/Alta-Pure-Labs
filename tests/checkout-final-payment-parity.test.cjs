'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const checkout=fs.readFileSync('checkout-reference.js','utf8');
test('payment layout adds reviewed CAD Interac when configured without unconfigured wallet buttons or fee claims',()=>{
 assert.match(checkout,/\['card','crypto',.*paymentKind\(m\)==='interac'.*\['interac'\]/);
 assert.match(checkout,/Interac e-Transfer \(CAD\)/);
 assert.match(checkout,/REQUEST CAD INVOICE/);
 assert.match(checkout,/USD estimate; no money is due/);
 assert.doesNotMatch(checkout,/ByteNFT|Link a new bank account|Same-Day Bank Payment|No Fees!|nlx-wallet-unavailable|Card number \*/);
 assert.match(checkout,/provider displays its fees, conversion rate and final charge/);
 assert.match(checkout,/extra 5% on merchandise after any applied coupon/);
 assert.doesNotMatch(checkout,/discounts do not combine|larger discount applies/);
});
test('provider handoff follows verified quote and saved order; saved/uncertain orders lock checkout',()=>{
 assert.match(checkout,/openHostedPayment/);
 assert.match(checkout,/lastPlaced=body.id/);
 assert.match(checkout,/function lockCheckout/);
 assert.match(checkout,/CHECK SAVED ORDER/);
 assert.doesNotMatch(checkout,/native_provider==='nmi'|method_id:bank.id/);
});
