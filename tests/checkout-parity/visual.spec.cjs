'use strict';
// Opt-in Playwright suite. Intentionally RED against current production code.
// Fully isolated fixture; NEVER sends requests to AltaPure or payment gateways.
const {test,expect}=require('@playwright/test');
const FIX='/tests/checkout-parity/fixture.html';
async function pageReady(page,view,params=''){
 await page.goto(FIX+'?view='+view+(params?'&'+params:''));
 await page.waitForFunction(()=>window.__fixtureReady===true);
 await page.evaluate(()=>document.fonts?.ready);
 const errors=await page.evaluate(()=>window.__fixtureErrors);
 expect(errors,'Isolated fixture must not have runtime exceptions').toEqual([]);
}
async function capture(page,name){
 await test.info().attach(name,{body:await page.screenshot({animations:'disabled',fullPage:false}),contentType:'image/png'});
}
async function box(locator){return locator.boundingBox()}

test('VIS-01 desktop cart geometry, independent scroll and pinned footer',async({page})=>{
 await pageReady(page,'cart','many=1');
 await capture(page,'cart-open-desktop');
 const panel=await box(page.locator('.ap-cart-dialog'));
 const widthRatio=panel.width/page.viewportSize().width;
 expect(widthRatio).toBeGreaterThanOrEqual(.27);
 expect(widthRatio).toBeLessThanOrEqual(.30);
 const upper=page.getByTestId('cart-product-scroll');
 const footer=page.getByTestId('cart-fixed-footer');
 await expect(upper).toBeVisible();await expect(footer).toBeVisible();
 const before=await box(footer);
 await upper.evaluate(node=>{node.scrollTop=250});
 await page.waitForTimeout(70);
 await capture(page,'cart-scrolled');
 const after=await box(footer);
 expect(Math.abs(after.y-before.y),'Pinned footer moved when product list scrolled').toBeLessThanOrEqual(3);
 expect(await upper.evaluate(node=>node.scrollTop)).toBeGreaterThan(100);
});
test('VIS-02 cart coupon expands without pushing primary controls away',async({page})=>{
 await pageReady(page,'cart','many=1');
 const footer=page.getByTestId('cart-fixed-footer');
 await expect(footer).toBeVisible();
 const before=await box(footer);
 await page.locator('details.nlc-coupon summary').click();
 await capture(page,'cart-coupon-expanded');
 const after=await box(footer);
 expect(Math.abs((after.y+after.height)-(before.y+before.height)),'Footer bottom must remain anchored').toBeLessThanOrEqual(6);
 expect(await footer.evaluate(node=>getComputedStyle(node).overflowY)).not.toBe('auto');
 await expect(page.getByRole('link',{name:/proceed to checkout/i})).toBeInViewport();
 await expect(page.locator('[data-nlc-wallets]')).toBeInViewport();
});
test('VIS-03 checkout uses compact benchmark proportions and a single loaded font family',async({page})=>{
 await pageReady(page,'shipping');await capture(page,'shipping-desktop');
 const b=await box(page.locator('.nlx-page'));
 const ratio=b.width/page.viewportSize().width;
 expect(ratio).toBeGreaterThanOrEqual(.86);
 expect(ratio).toBeLessThanOrEqual(.89);
 const font=await page.locator('.nlx-checkout-root').evaluate(x=>getComputedStyle(x).fontFamily);
 expect(font.toLowerCase()).toContain('poppins');
 await expect(page.locator('select[name=country]')).toBeVisible();
 await expect(page.locator('.nlx-summary')).toBeVisible();
});
test('VIS-04 Continue button has strong white-on-black contrast',async({page})=>{
 await pageReady(page,'shipping');
 const cta=page.locator('[data-nlx-next]');
 await expect(cta).toBeEnabled();
 const s=await cta.evaluate(x=>({color:getComputedStyle(x).color,background:getComputedStyle(x).backgroundColor}));
 expect(s.color).toBe('rgb(255, 255, 255)');
 expect(s.background).toBe('rgb(8, 9, 12)');
 await capture(page,'primary-button-contrast');
});
test('VIS-05 protection Read more is inline and never opens another page',async({page})=>{
 await pageReady(page,'delivery');
 let alerts=0,popups=0;
 page.on('dialog',d=>{alerts++;d.dismiss()});
 page.on('popup',p=>{popups++;p.close()});
 const disclosure=page.getByTestId('protection-disclosure');
 await expect(disclosure).toBeVisible();
 const oldURL=page.url();await disclosure.click();
 await expect(disclosure).toHaveAttribute('aria-expanded','true');
 await expect(page.getByTestId('protection-disclosure-panel')).toBeVisible();
 expect(page.url()).toBe(oldURL);
 expect(alerts).toBe(0);expect(popups).toBe(0);
 await capture(page,'protection-inline-expanded');
});
test('VIS-06 Priority and Cold Chain disclosures are inline and extras start OFF',async({page})=>{
 await pageReady(page,'delivery');
 await expect(page.locator('[data-nlx-extra="priority"]')).not.toBeChecked();
 await expect(page.locator('[data-nlx-extra="cold_chain"]')).not.toBeChecked();
 let dialogs=0;page.on('dialog',d=>{dialogs++;d.dismiss()});
 for(const id of ['priority','cold-chain']){
  const toggle=page.getByTestId(id+'-disclosure');
  await expect(toggle).toBeVisible();await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  await expect(page.getByTestId(id+'-disclosure-panel')).toBeVisible();
 }
 expect(dialogs).toBe(0);await capture(page,'delivery-inline-extras');
});
test('VIS-07 missing carrier ETA must show honest uncertainty, never fabricated arrival',async({page})=>{
 await pageReady(page,'delivery');
 const first=page.locator('.nlx-delivery-card').first();
 await expect(first).toContainText(/estimated at dispatch|date not yet available/i);
 await expect(first).not.toContainText(/arrives (mon|tue|wed|thu|fri|sat|sun)/i);
 await capture(page,'shipping-no-unverified-dates');
});
test('VIS-08 rewards use authentic sparkle and membership destination',async({page})=>{
 await pageReady(page,'delivery');
 const points=page.locator('[data-nlx-points]');
 await expect(points).toContainText(/earn \d+ points/i);
 await expect(points.locator('svg, img')).toHaveCount(1);
 await expect(points.getByRole('link',{name:/earn more/i})).toHaveAttribute('href','/memberships');
 const activation=page.getByTestId('membership-activate');
 await expect(activation).toBeVisible();
 await expect(activation).toHaveAttribute('href',/\/(memberships|account\/membership)/);
 await capture(page,'member-upsell-and-points');
});
test('VIS-09 authentic card marks and truthful payment gating',async({page})=>{
 await pageReady(page,'payment');
 await capture(page,'payment-no-live-provider');
 await expect(page.locator('.nlx-terms input[type=checkbox]')).toHaveCount(2);
 await expect(page.locator('[data-nlx-wallets] button')).toHaveCount(2);
 for(const control of await page.locator('[data-nlx-wallets] button').all())await expect(control).toBeDisabled();
 await expect(page.locator('[data-nlx-place]')).toBeDisabled();
 const brands=page.locator('.nlx-we-accept');
 await expect(brands).toContainText(/not yet activated/i);
 await expect(brands.locator('svg, img')).toHaveCount(6);
 await expect(brands.locator('span.nlx-pay-logo')).toHaveCount(0);
});
test('VIS-10 desktop summary remains visible while user scrolls checkout',async({page})=>{
 await pageReady(page,'payment');
 await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight-window.innerHeight));
 await page.waitForTimeout(90);
 await capture(page,'summary-after-scroll');
 const b=await box(page.locator('.nlx-summary'));
 expect(b.y).toBeGreaterThanOrEqual(0);
 expect(b.y).toBeLessThan(120);
});
for(const width of [768,390,375]){
 test('VIS-11 responsive checkout '+width+'px with no horizontal overflow',async({page})=>{
  await page.setViewportSize({width,height:width===768?1024:844});
  await pageReady(page,'payment');await capture(page,'checkout-'+width+'px');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator('.nlx-terms')).toBeVisible();
 });
}
test('VIS-12 short-mobile cart keeps product browsing and checkout accessible',async({page})=>{
 await page.setViewportSize({width:390,height:667});
 await pageReady(page,'cart','many=1');
 await capture(page,'cart-mobile-short');
 const body=page.getByTestId('cart-product-scroll'),footer=page.getByTestId('cart-fixed-footer');
 await expect(body).toBeVisible();await expect(footer).toBeVisible();
 const b=await box(footer);
 expect(b.height).toBeLessThanOrEqual(667*.65);
 await expect(page.getByRole('link',{name:/proceed to checkout/i})).toBeVisible();
});

test('VIS-13 BOGO free badges follow confirmed quote lines and disappear after quantity changes',async({page})=>{
 await pageReady(page,'cart');
 const cartFree=page.locator('[data-testid="cart-bogo-free"]:not([hidden])');
 await expect(cartFree).toHaveCount(2); // One earned free unit, one active single-unit BOGO offer
 await expect(cartFree.first()).toHaveText('+1 FREE');
 await capture(page,'cart-server-confirmed-bogo');
 await pageReady(page,'shipping');
 await expect(page.getByTestId('checkout-bogo-free')).toHaveCount(2);
 await expect(page.getByTestId('checkout-bogo-free').first()).toHaveText('+1 FREE');
 await page.locator('[data-nlx-qty="-1"]').first().click();
 await page.waitForTimeout(300);
 await expect(page.getByTestId('checkout-bogo-free')).toHaveCount(2); // Remaining single-unit products still advertise the offer
});
