'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, randomUUID } = require('node:crypto');
const { handle, normalizeItem, normalizeBatch, normalizeCommand } = require('../lib/standalone-inventory');

const secret='standalone-inventory-fixture-at-least-32-characters';
const sessionToken='i'.repeat(43);
const env={ADMIN_ORDERS_PASSWORD:secret,ADMIN_AUTH_SIGNING_SECRET:secret,ADMIN_AUTH_EMAIL:'owner@example.test',SITE_URL:'https://getpurelabs.com'};
const csrf=createHmac('sha256',createHmac('sha256',secret).update('PURE admin authentication v1').digest()).update('csrf\n'+sessionToken).digest('base64url');
const uuid=n=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0');

function fakeDb({items=[],events=[],commandResult={item:{id:uuid(1)}},commandError=null}={}) {
  const calls={reads:[],commands:[],auth:0};
  return {calls,from(table){
    assert.ok(['pure_stock_items','pure_stock_events'].includes(table),'no outside tables may be queried');
    const spec={table,orders:[]}; calls.reads.push(spec);
    const query={
      select(columns){spec.columns=columns;return this;},order(column,options){spec.orders.push({column,...options});return this;},
      limit(n){spec.limit=n;return this;},gt(column,value){spec.after={column,value};return this;},
      range(start,end){spec.range=[start,end];return this;},in(column,values){spec.in={column,values};return this;},
      then(resolve,reject){
        let rows=[...(table==='pure_stock_items'?items:events)];
        if(spec.after)rows=rows.filter(row=>row[spec.after.column]>spec.after.value);
        if(spec.in)rows=rows.filter(row=>spec.in.values.includes(row[spec.in.column]));
        if(spec.range)rows=rows.slice(spec.range[0],spec.range[1]+1);
        if(spec.limit!==undefined)rows=rows.slice(0,spec.limit);
        return Promise.resolve({data:rows}).then(resolve,reject);
      }
    };return query;
  },async rpc(name,args){
    if(name==='pure_admin_get_session'){calls.auth++;return{data:{expires_at:new Date(Date.now()+60000).toISOString()}};}
    assert.equal(name,'pure_stock_command','no catalog, order, supplier, or payment command');
    calls.commands.push(args);return commandError?{error:commandError}:{data:commandResult};
  }};
}
async function request({db=fakeDb(),method='GET',url='/api/customer-config?inventory=1',body,auth=true,headers={}}={}) {
  const res={statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;}};
  await handle({method,url,body,headers:{...(auth?{cookie:'__Host-pure_admin='+sessionToken}:{}),
    ...(!['GET','HEAD','OPTIONS'].includes(method)?{'content-type':'application/json',origin:'https://getpurelabs.com','x-pure-admin-csrf':csrf}:{}),...headers}},res,{db,env});
  return res;
}

test('independent items preserve unknown counts, normalized SKUs, units and nullable costs',()=>{
  assert.deepEqual(normalizeItem({sku:' my-custom_1 ',product_name:' My item '}),{sku:'MY-CUSTOM_1',product_name:'My item',strength:'',unit:'vial',quantity:null,minimum:0,unit_cost:null,currency:'USD',location:'',notes:''});
  for(const unit of ['vial','pen','bottle','pack','unit'])assert.equal(normalizeItem({sku:'SKU',product_name:'Item',unit,quantity:0,unit_cost:0}).unit,unit);
  for(const item of [
    {sku:'A B',product_name:'Item'},{sku:'A',product_name:''},{sku:'A',product_name:'Item',quantity:-1},
    {sku:'A',product_name:'Item',quantity:1.5},{sku:'A',product_name:'Item',minimum:null},
    {sku:'A',product_name:'Item',unit_cost:1.234},{sku:'A',product_name:'Item',unit:'dose'},
    {sku:'A',product_name:'Item',supplier_id:uuid(2)},{sku:'A',product_name:'Item',catalog_id:'retatrutide'},
    {sku:'A',product_name:'Item',order_id:uuid(2)},{sku:'A',product_name:'Item',quantity:'10'}
  ])assert.throws(()=>normalizeItem(item),error=>error.status===400);
  assert.deepEqual(normalizeItem({unit_cost:null,notes:'line one\nline two'},true),{unit_cost:null,notes:'line one\nline two'});
  assert.throws(()=>normalizeItem({quantity:5},true),error=>error.status===400);
  assert.throws(()=>normalizeBatch([{sku:'same',product_name:'A'},{sku:'SAME',product_name:'B'}]),error=>error.code==='DUPLICATE_SKU');
  assert.throws(()=>normalizeBatch(Array.from({length:501},(_,n)=>({sku:'ROW-'+n,product_name:'Item'}))),error=>error.status===400);
});

test('commands reject client actors, count edits in metadata, absent reason, and invalid versions',()=>{
  const base={request_id:uuid(1),id:uuid(2),expected_version:1};
  for(const command of [
    {...base,action:'adjust',mode:'add',quantity:0,reason:'Nothing'},
    {...base,action:'adjust',mode:'remove',quantity:1,reason:''},
    {...base,action:'update',item:{quantity:4}},
    {...base,action:'archive',archived:true,actor:'owner'},
    {...base,action:'archive',archived:true,expected_version:0},
    {...base,action:'delete'},
    {action:'create',item:{sku:'X',product_name:'Item'}}
  ])assert.throws(()=>normalizeCommand(command),error=>error.status===400);
  assert.equal(normalizeCommand({...base,action:'adjust',mode:'set',quantity:0,reason:' Counted '}).payload.reason,'Counted');
});

test('private inventory requires existing admin authentication and CSRF before reads or writes',async()=>{
  const db=fakeDb();
  for(const args of [{auth:false},{auth:false,method:'POST',body:{}},{headers:{'sec-fetch-site':'cross-site',origin:'https://evil.test'}}]){
    const res=await request({db,...args});assert.ok([401,403].includes(res.statusCode));
    assert.equal(db.calls.reads.length,0);assert.equal(db.calls.commands.length,0);
  }
  for(const headers of [{'x-pure-admin-csrf':''},{origin:'https://evil.test'},{'sec-fetch-site':'cross-site'}]){
    const res=await request({db,method:'POST',headers,body:{action:'create',request_id:uuid(1),item:{sku:'ITEM',product_name:'Item'}}});
    assert.equal(res.statusCode,403);assert.equal(db.calls.commands.length,0);
  }
  const res=await request({db});assert.equal(res.statusCode,200);assert.deepEqual(res.body,{items:[]});
  assert.equal(res.headers['Cache-Control'],'private, no-store, max-age=0');
  assert.equal(res.headers['X-Content-Type-Options'],'nosniff');
});

test('all items include archived rows with keyset pagination and explicit overflow instead of truncation',async()=>{
  const items=Array.from({length:1205},(_,n)=>({id:uuid(n+1),sku:'ROW-'+n,archived:n===0,quantity:n===1?null:0}));
  const db=fakeDb({items}),res=await request({db});
  assert.equal(res.statusCode,200);assert.deepEqual(res.body.items,items);assert.equal(db.calls.reads.length,2);
  assert.deepEqual(db.calls.reads[1].after,{column:'id',value:uuid(1000)});
  const tooMany=fakeDb({items:Array.from({length:5001},(_,n)=>({id:uuid(n+1)}))});
  const limited=await request({db:tooMany});assert.equal(limited.statusCode,503);assert.equal(limited.body.code,'LIMIT_EXCEEDED');
  assert.equal(Object.hasOwn(limited.body,'items'),false);
});

test('history returns deterministic paging and one extra row only for has_more',async()=>{
  const events=Array.from({length:55},(_,n)=>({id:uuid(n+1),action:'adjust',product_name:'Historical name',quantity_before:10,quantity_after:9,reason:'Manual use'}));
  const db=fakeDb({events}),res=await request({db,url:'/api/customer-config?inventory=1&view=activity&offset=0&page_size=50'});
  assert.equal(res.statusCode,200);assert.equal(res.body.events.length,50);assert.equal(res.body.has_more,true);
  assert.deepEqual(db.calls.reads[0].orders,[{column:'created_at',ascending:false},{column:'id',ascending:false}]);
  assert.deepEqual(db.calls.reads[0].range,[0,50]);
  const last=await request({db,url:'/api/customer-config?inventory=1&view=activity&offset=50&page_size=50'});
  assert.equal(last.body.events.length,5);assert.equal(last.body.has_more,false);
  assert.equal((await request({db,url:'/api/customer-config?inventory=1&view=activity&page_size=0'})).statusCode,400);
});

test('import preview validates new rows without any mutation and never overwrites archived SKUs',async()=>{
  const db=fakeDb(),body={action:'preview_import',request_id:randomUUID(),items:[{sku:'new',product_name:'New item',quantity:0}]};
  const res=await request({db,method:'POST',body});
  assert.equal(res.statusCode,200);assert.equal(res.body.count,1);assert.equal(res.body.items[0].sku,'NEW');
  assert.equal(db.calls.commands.length,0);
  const duplicate=fakeDb({items:[{sku:'NEW',archived:true}]});
  const rejected=await request({db:duplicate,method:'POST',body});
  assert.equal(rejected.statusCode,409);assert.equal(rejected.body.code,'DUPLICATE_SKU');assert.equal(duplicate.calls.commands.length,0);
});

test('mutation sends only normalized independent fields and a server-derived actor',async()=>{
  const db=fakeDb({commandResult:{item:{id:uuid(4),sku:'PERSONAL',quantity:null,version:1}}});
  const res=await request({db,method:'POST',body:{action:'create',request_id:uuid(10),item:{sku:'personal',product_name:'Any personal stock'}}});
  assert.equal(res.statusCode,200);assert.equal(res.body.item.quantity,null);
  assert.equal(db.calls.commands.length,1);assert.equal(db.calls.commands[0].p_request_id,uuid(10));
  assert.equal(db.calls.commands[0].p_payload.item.sku,'PERSONAL');
  assert.match(db.calls.commands[0].p_actor,/^admin-session:[0-9a-f]{32}$/);
  assert.ok(!JSON.stringify(db.calls.commands).includes(sessionToken),'raw session never stored as actor');
});

test('stale versions and replay conflicts are actionable and internal database details remain private',async()=>{
  const body={action:'adjust',request_id:uuid(20),id:uuid(1),expected_version:1,mode:'remove',quantity:1,reason:'Used one'};
  for(const [error,status,code] of [
    [{code:'40001',message:'private row details'},409,'VERSION_CONFLICT'],
    [{code:'23505',message:'private key details'},409,'DUPLICATE_SKU'],
    [{code:'P0001',message:'STOCK_REQUEST_CONFLICT'},409,'REQUEST_CONFLICT'],
    [{code:'P0001',message:'STOCK_QUANTITY_UNCONFIRMED'},409,'INVALID_QUANTITY'],
    [{code:'P0001',message:'STOCK_NEGATIVE_QUANTITY'},409,'INVALID_QUANTITY'],
    [{code:'P0001',message:'STOCK_ITEM_ARCHIVED'},409,'ITEM_ARCHIVED'],
    [{code:'XX000',message:'private connection diagnostic'},503,'UNAVAILABLE']
  ]){
    const res=await request({db:fakeDb({commandError:error}),method:'POST',body});
    assert.equal(res.statusCode,status);assert.equal(res.body.code,code);assert.ok(!JSON.stringify(res.body).includes('private'));
  }
});

test('invalid methods, bodies and read views cannot mutate inventory',async()=>{
  const db=fakeDb();
  assert.equal((await request({db,method:'DELETE'})).statusCode,405);
  assert.equal((await request({db,method:'POST',body:'{'})).statusCode,400);
  assert.equal((await request({db,method:'POST',body:{},headers:{'content-type':'text/plain'}})).statusCode,415);
  assert.equal((await request({db,url:'/api/customer-config?inventory=1&view=suppliers'})).statusCode,400);
  assert.equal(db.calls.commands.length,0);
});
