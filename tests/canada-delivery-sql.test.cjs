'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const delivery=require('../lib/delivery-options');
let PGlite;try{({PGlite}=require('@electric-sql/pglite'));}catch{}
const migration=fs.readFileSync('supabase/migrations/20261117192240_pure_canada_next_day_delivery.sql','utf8');

test('isolated PostgreSQL delivery quote matches JavaScript rates, selections and opt-outs',{skip:!PGlite,timeout:60000},async()=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon;create role authenticated;create role service_role;create schema commerce_internal;create table public.commerce_delivery_options(id text primary key,kind text,label text,price_cents integer,enabled boolean,description text);');
  for(const option of delivery.defaults)await db.query('insert into public.commerce_delivery_options(id,kind,label,price_cents,enabled,description) values($1,$2,$3,$4,$5,$6)',[option.id,option.kind,option.label,option.price_cents,option.enabled,option.description]);
  await db.exec(migration);
  const quote=async(country,shipping,extras,merchandise)=>(await db.query('select commerce_internal.regular_delivery_quote($1::jsonb,$2,$3) as quote',[JSON.stringify({shipping,extras}),country,merchandise])).rows[0].quote;
  for(const country of ['US','CA','GB'])for(const shipping of ['standard','express','next_day'])for(const merchandise of [14999,15000])for(const extras of [[],['protection'],['priority'],['priority','protection']]){
   if(country==='GB'&&shipping==='next_day'){
    await assert.rejects(quote(country,shipping,extras,merchandise),/unavailable/);
    continue;
   }
   const expected=delivery.price({shipping,extras},merchandise>=15000,delivery.defaults,country);
   assert.deepEqual(await quote(country,shipping,extras,merchandise),expected,[country,shipping,extras,merchandise].join(' / '));
  }
  await assert.rejects(quote('CA','next_day',['protection','protection'],20000),/Duplicate delivery extra/);
  await db.query("update public.commerce_delivery_options set enabled=false where id='protection'");
  await assert.rejects(quote('CA','next_day',['protection'],20000),/Delivery extra unavailable/);
  assert.equal((await quote('CA','next_day',[],20000)).total_cents,6995);
  for(const role of ['anon','authenticated','service_role']){
   const rights=(await db.query("select has_function_privilege($1,'commerce_internal.regular_delivery_quote(jsonb,text,integer)','EXECUTE') as allowed",[role])).rows[0];
   assert.equal(rights.allowed,false,'Internal delivery helper stays private for '+role);
  }
  const updated=(await db.query("select description from public.commerce_delivery_options where id='next_day'")).rows[0];
  assert.equal(updated.description,delivery.defaults.find(option=>option.id==='next_day').description);
 }finally{await db.close();}
});
