'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const views=require('../reference-ui-functions.cjs');
const read=file=>fs.readFileSync(file,'utf8');

test('membership pages and embedded home tiers omit redundant note, approximation and currency suffix',()=>{
 const member=read('membership-experience.js'),fx=read('config/conversion.json');
 assert.match(member,/Save 20%/);
 assert.doesNotMatch(member,/Save ≈20%|mx-currency-note|currencyCode\(\)\} \/ /);
 assert.match(member,/mx-price-period/);
 assert.ok(JSON.parse(fx).plans.elite.annual_cents===Math.round(JSON.parse(fx).plans.elite.monthly_cents*12*.8));
 assert.ok(JSON.parse(fx).plans.vip.annual_cents===Math.round(JSON.parse(fx).plans.vip.monthly_cents*12*.8));
});
test('sign-in Google artwork is the existing clean payment G with no inline outline',()=>{
 const js=read('account.js'),asset=read('assets/payment-brands/google-g-clean.svg');
 assert.match(js,/google-g-clean\.svg/);
 assert.match(js,/class="pure-google-mark"/);
 assert.doesNotMatch(js,/<svg viewBox="0 0 48 48"/);
 assert.doesNotMatch(asset,/(?:stroke|stroke-width)="black"/);
});
test('account tabs use the same underline active and hover behavior as the storefront',()=>{
 const brand=read('pure-brand.css'),palette=read('unified-palette.css');
 assert.match(brand,/nav\.account-nav a\[aria-current=page\]::after/);
 assert.match(brand,/nav\.account-nav :is\(a,\.account-nav-logout\):hover::after/);
 assert.match(brand,/background:transparent!important/);
 assert.doesNotMatch(palette,/\.account-nav a\[aria-current=page\]/);
 assert.match(brand,/\.cv-program-primary,\.ap-subscriptions-empty a\.ap-button/);
 assert.match(brand,/-webkit-text-fill-color:#fff!important/);
});
test('Partner and COA preserve original form, report and navigation integration',()=>{
 const partner=views.workspace.partnerPage.toString(),coa=read('workspace-v2.js'),styling=read('pure-coa.css');
 assert.match(partner,/pure-partner-hero/);
 assert.match(partner,/pure-partner-inquiry/);
 assert.match(partner,/inquiryForm\('partner'\)/);
 assert.match(partner,/href="\/account\/partner"/);
 assert.match(coa,/id="ap-coa-query"/);
 assert.match(coa,/id="ap-supplier-references"/);
 assert.match(coa,/PURE \/ CERTIFICATES OF ANALYSIS/);
 assert.match(styling,/\.pure-coa-page \.ap-coa-card/);
});

test('only the terms link remains below membership cards on both routes',()=>{
 const src=read('membership-experience.js');
 assert.match(src,/class="mx-terms"><a href="\/membership-terms\.html">See full terms\.<\/a>/);
 assert.doesNotMatch(src,/class="mx-terms">\$\{esc\(terms\(config\)\)\}/);
});
test('rewards and credit links show balances on account overview, not separate tabs',()=>{
 const site=read('site-build.cjs'),nav=read('account-experience-build.cjs'),ui=read('readiness-ui.js');
 assert.match(site,/\['Rewards & Credit','\/account#rewards-and-credit'\]/);
 assert.match(site,/href="\/account#rewards-and-credit">Rewards & Credit/);
 assert.doesNotMatch(nav,/\['Points','\/account\/points'\],\['Store Credit'/);
 assert.match(nav,/includes\(location\.pathname\)\)return go\('\/account#rewards-and-credit'\)/);
 assert.match(ui,/id="rewards-and-credit"/);
 assert.match(ui,/rd-balance-pair/);
 assert.doesNotMatch(ui,/href="\/account\/points">View points/);
});
test('homepage branded FAQ and illustrative COA preview preserve links',()=>{
 const home=views.store.home.toString(),css=read('pure-brand.css');
 assert.match(home,/pure-faq-section/);
 assert.match(home,/pure-faq-list/);
 assert.match(home,/nl-doc-sheet/);
 assert.match(home,/ILLUSTRATIVE PREVIEW/);
 assert.doesNotMatch(home,/99%\+ purity/);
 assert.match(home,/href="\/coas"/);
 assert.match(css,/\.pure-faq-list details\[open\] summary::after/);
 assert.match(css,/\.nl-doc-sheet-row/);
});
