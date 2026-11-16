'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {execute}=require('../lib/unified-admin-actions');
const id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const address={line1:'123 Main Street',line2:'',city:'Miami',region:'FL',postal_code:'33101',country:'US'};
function db(order){
 const calls=[];return{calls,from(table){assert.equal(table,'commerce_invoices');return{select(){return this},eq(){return this},async maybeSingle(){return{data:order,error:null}}}},async rpc(name,args){calls.push({name,args});return{data:{version:2},error:null}}};
}
test('shipping edit requires paid goods and exact version',async()=>{
 const b={action:'edit_shipping',id,version:1,address,note:'Customer corrected street number'};
 const pending=db({id,status:'accepted',kind:'goods',version:1,total_cents:10000});
 assert.equal((await execute(pending,b)).status,409);assert.equal(pending.calls.length,0);
 const stale=db({id,status:'paid',kind:'goods',version:2,total_cents:10000});
 assert.equal((await execute(stale,b)).status,409);assert.equal(stale.calls.length,0);
 const membership=db({id,status:'paid',kind:'membership',version:1,total_cents:10000});
 assert.equal((await execute(membership,b)).status,409);assert.equal(membership.calls.length,0);
});
test('shipping edit submits a complete address to audited RPC, with no price mutation',async()=>{
 const database=db({id,status:'paid',kind:'goods',version:1,total_cents:10000});
 const response=await execute(database,{action:'edit_shipping',id,version:1,address,note:'Customer corrected street number'});
 assert.equal(response.status,200);assert.deepEqual(database.calls,[{name:'commerce_admin_edit_shipping',args:{p_invoice:id,p_version:1,p_address:address,p_note:'Customer corrected street number'}}]);
});
test('shipping edit rejects unexpected address fields and unsupported country format',async()=>{
 const database=db({id,status:'paid',kind:'goods',version:1,total_cents:10000});
 const base={action:'edit_shipping',id,version:1,note:'Customer corrected street number'};
 assert.equal((await execute(database,{...base,address:{...address,price_cents:1}})).status,400);
 assert.equal((await execute(database,{...base,address:{...address,country:'United States'}})).status,400);
 assert.equal(database.calls.length,0);
});
