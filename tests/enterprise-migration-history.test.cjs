'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../supabase/migrations');
test('production inventory migrations are versioned in exact remote order',()=>{
 const files=fs.readdirSync(root);
 const initial='20261109225035_enterprise_inventory_quality_foundation.sql';
 const correction='20261109225045_enterprise_inventory_event_append_only_privileges.sql';
 assert.ok(files.includes(initial));
 assert.ok(files.includes(correction));
 assert.ok(initial<correction);
 const sql=fs.readFileSync(path.join(root,initial),'utf8');
 const fix=fs.readFileSync(path.join(root,correction),'utf8');
 assert.match(sql,/create table if not exists public\.enterprise_inventory_lots/);
 assert.match(sql,/create table if not exists public\.enterprise_quality_documents/);
 assert.match(sql,/create table if not exists public\.enterprise_inventory_events/);
 assert.match(fix,/revoke update, delete, truncate, references, trigger/);
 assert.match(fix,/grant select, insert/);
});

test('atomic reservation migration is recorded with remote Supabase version',()=>{
 const file='20261109231123_enterprise_atomic_inventory_reservation.sql';
 assert.ok(fs.readdirSync(root).includes(file));
 const sql=fs.readFileSync(path.join(root,file),'utf8');
 assert.match(sql,/security invoker/);
 assert.match(sql,/revoke all on function public\.enterprise_reserve_inventory/);
 assert.match(sql,/grant execute on function public\.enterprise_reserve_inventory/);
 assert.match(sql,/and on_hand - reserved - damaged >= p_quantity/);
 assert.match(sql,/insert into public\.enterprise_inventory_events/);
});

test('atomic reservation cancellation migration matches remote history',()=>{
 const file='20261109231602_enterprise_atomic_reservation_cancellation.sql';
 assert.ok(fs.readdirSync(root).includes(file));
 const sql=fs.readFileSync(path.join(root,file),'utf8');
 assert.match(sql,/security invoker/);
 assert.match(sql,/for update/);
 assert.match(sql,/revoke all on function public\.enterprise_cancel_reservation/);
 assert.match(sql,/grant execute on function public\.enterprise_cancel_reservation/);
});
