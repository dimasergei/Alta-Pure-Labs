'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync('account-experience.js','utf8'),context);
const payload=values=>JSON.parse(JSON.stringify(context.window.AccountExperience.profilePayload(values)));
test('profile saves bounded contact and addresses without writable payment privileges',()=>{
 const p=payload({full_name:' Research Lab ',phone:'+1 555 0100',organization:'Example',shipping_name:'Recipient',shipping_line1:'1 Main Street',shipping_country:'us',billing_same:'on',billing_line1:'wrong',membership:'elite',points:99999});
 assert.equal(p.full_name,'Research Lab');assert.equal(p.alta_profile.shipping.country,'US');assert.deepEqual(p.alta_profile.billing,p.alta_profile.shipping);
 assert.deepEqual(Object.keys(p).sort(),['alta_profile','first_name','full_name','last_name']);assert.equal(p.alta_profile.phone,'+1 555 0100');
 assert.equal(payload({full_name:'Lab',organization:'x'.repeat(400)}).alta_profile.organization.length,180);
});
test('profile retains separately entered billing address and validates display name',()=>{
 const p=payload({full_name:'Lab',shipping_line1:'One',billing_line1:'Two',billing_country:'ca'});assert.equal(p.alta_profile.billing.line1,'Two');assert.equal(p.alta_profile.billing.country,'CA');assert.equal(p.alta_profile.billing_same_as_shipping,false);
 assert.throws(()=>payload({full_name:' '}),/display name/);
});
