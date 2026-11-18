// Isolated partner fixtures; requests never reach a provider or production database.
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
const config=require('../config/conversion.json'),auth={auth:{getSession:async()=>({data:{session:{access_token:'fixture-only-token'}}})}};
(async()=>{
 const dom=new JSDOM('<main id="root"></main>',{url:'https://altapurelabs.test',runScripts:'outside-only'}),w=dom.window,root=w.document.querySelector('main'),calls=[];
 let joined=false,cartOffers=0;
 w.fetch=async(url,options)=>{const body=options?.body?JSON.parse(options.body):null;calls.push({url,body,headers:options?.headers});if(body?.action==='join'){joined=true;return {ok:true,json:async()=>({code:'AP-ABCDEFGH2345'})};}return {ok:true,json:async()=>({partner:joined?{code:'AP-ABCDEFGH2345',status:'active'}:null,events:[],summary:{earned_cents:0,eligible_cents:0,paid_cents:0},terms:config.partner})};};
 w.AltaCartNmi={offer:async element=>{assert.equal(element,root);cartOffers++;}};
 w.eval(fs.readFileSync('conversion-ui.js','utf8'));
 await w.ConversionUI.cart(root);assert.equal(cartOffers,1,'Conversion uses the active cart instead of injecting another coupon panel');assert.equal(typeof w.ConversionUI.membershipCards,'function');assert.equal(typeof w.ConversionUI.mountMembership,'function');assert.equal(typeof w.ConversionUI.subscriptions,'function');
 await w.ConversionUI.partner(root,auth);assert.doesNotMatch(root.textContent,/20% off|customer savings|membership/i);root.querySelector('input[name=code]').value='MYLAB';root.querySelector('input[type=checkbox]').checked=true;await root.querySelector('form').onsubmit({preventDefault(){},target:root.querySelector('form')});assert.equal(root.querySelector('input').value,'https://altapurelabs.test/?ref=AP-ABCDEFGH2345');assert.match(root.textContent,/Referral activity/);assert.match(root.textContent,/Your referral codes/);assert.equal(calls.find(call=>call.body?.action==='join').body.terms_version,config.partner.version);assert.equal(calls.find(call=>call.body?.action==='join').headers.Authorization,'Bearer fixture-only-token');assert.equal(calls.some(call=>call.body?.action==='save_bank'),false);
 dom.window.close();console.log('PASS: active cart delegation and partner enrollment/referral dashboard without customer discount offers or payout mutations.');
})().catch(error=>{console.error(error);process.exitCode=1;});
