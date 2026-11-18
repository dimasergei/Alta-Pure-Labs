'use strict';
// Production account transformations run against an in-memory filesystem. These
// fixtures never rebuild the shared output, authenticate a real user, or send mail.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
function generatedAccount(){
 const files=new Map(),key=file=>String(file).replaceAll('\\','/');
 const fakeFs={
  readFileSync(file){const name=key(file);if(files.has(name))return files.get(name);const source=path.join(root,name.replace(/^public-build\//,''));return fs.existsSync(source)?fs.readFileSync(source,'utf8'):'';},
  writeFileSync(file,value){files.set(key(file),String(value));},
  copyFileSync(from,to){files.set(key(to),fakeFs.readFileSync(from));},
  readdirSync(){return [];}
 };
 const run=file=>vm.runInNewContext(read(file),{require:name=>name==='node:fs'?fakeFs:require(name),console:{log(){}}},{filename:file,timeout:1000});
 run('site-build.cjs');run('manual-commerce-build.cjs');
 fakeFs.copyFileSync('account.js','public-build/account.js');fakeFs.copyFileSync('account.html','public-build/account.html');
 run('direct-checkout-build.cjs');run('account-experience-build.cjs');
 const source=files.get('public-build/account.js');new vm.Script(source);return source;
}
const source=generatedAccount(),user={id:'fixture-member',email:'researcher@example.test',user_metadata:{full_name:'Fixture Researcher'}};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function page(route,{signedIn=false,storedReturn=null}={}){
 const dom=new JSDOM('<body class="ap-site ap-account-site"><main class="account-page"><div class="account-shell"><section id="account-root" class="account-card"></section></div></main><span id="year"></span></body>',{url:'https://pure.example'+route});
 const w=dom.window,assigned=[],panels=[],signins=[],oauth=[],requests=[];
 if(storedReturn)w.sessionStorage.setItem('ap-account-return',storedReturn);
 let onState;
 const auth={auth:{
  onAuthStateChange(callback){onState=callback;},
  getSession:async()=>({data:{session:signedIn?{user,access_token:'fixture-token'}:null}}),
  signInWithPassword:async value=>{signins.push(value);return {error:null};},
  signInWithOAuth:async value=>{oauth.push(value);return {error:null};},
  resetPasswordForEmail:async()=>({}),signOut:async()=>({})
 }};
 w.supabase={createClient:()=>auth};
 w.AltaWorkspace={renderAccountPanel:(route,element)=>{panels.push(route);element.textContent='Authenticated '+route;}};
 w.AccountExperience={profile:()=>panels.push('/account/profile')};
 w.DirectCheckout={overview:()=>panels.push('/account'),checkout:()=>panels.push('/checkout')};
 const url=new URL(w.location.href),location={origin:url.origin,pathname:url.pathname,search:url.search,assign:next=>assigned.push(next)};
 const context={window:w,document:w.document,location,sessionStorage:w.sessionStorage,FormData:w.FormData,URL,URLSearchParams,Intl,Date,
  fetch:async endpoint=>{requests.push(endpoint);assert.equal(endpoint,'/api/customer-config');return {ok:true,json:async()=>({supabaseUrl:'https://fixture.invalid',anonKey:'fixture-public-key'})};}};
 vm.runInNewContext(source,context,{timeout:1000});await tick();
 return {dom,w,assigned,panels,signins,oauth,requests,recovery:()=>onState('PASSWORD_RECOVERY',{user})};
}

for(const route of ['/account/membership','/account/subscriptions','/account/partner'])test(route+' keeps its destination through password login and the stored sign-in callback',async()=>{
 const destination=route+'?view=details';
 const guest=await page(destination);
 let login,signed,callback;
 try{
  assert.equal(guest.assigned.length,1);
  const loginUrl=new URL(guest.assigned[0],'https://pure.example');
  assert.equal(loginUrl.pathname,'/account/login');
  assert.equal(loginUrl.searchParams.get('returnTo'),destination);
  assert.deepEqual(guest.panels,[],'unauthenticated visitors never mount private program panels');
  login=await page(loginUrl.pathname+loginUrl.search);
  assert.ok(login.w.document.body.classList.contains('ap-auth-page'));
  assert.equal(login.w.document.querySelector('h1').textContent,'Sign in');
  const stored=login.w.sessionStorage.getItem('ap-account-return');assert.equal(stored,destination);
  const form=login.w.document.getElementById('login');
  form.elements.email.value='researcher@example.test';form.elements.password.value='Fixture-only-password1!';
  await form.onsubmit({preventDefault(){},currentTarget:form});
  assert.equal(login.signins.length,1);assert.equal(login.assigned.at(-1),destination);
  assert.equal(login.w.sessionStorage.getItem('ap-account-return'),null,'successful login consumes the saved destination');
  callback=await page('/account',{signedIn:true,storedReturn:stored});
  assert.deepEqual(callback.assigned,[destination],'OAuth or confirmation callback resumes the saved account page');
  assert.equal(callback.w.sessionStorage.getItem('ap-account-return'),null);
  signed=await page(destination,{signedIn:true});
  assert.deepEqual(signed.panels,[route]);assert.deepEqual(signed.assigned,[]);
  assert.equal(signed.w.document.body.classList.contains('ap-auth-page'),false,'signed-in program layouts remain separate from auth forms');
 }finally{guest.dom.window.close();login?.dom.window.close();callback?.dom.window.close();signed?.dom.window.close();}
});

test('account aliases preserve a safe canonical program destination',async()=>{
 const env=await page('/my-account/membership/?view=benefits');
 try{assert.equal(new URL(env.assigned[0],'https://pure.example').searchParams.get('returnTo'),'/account/membership?view=benefits');}
 finally{env.dom.window.close();}
});

test('the compact auth presentation is applied only by auth renderers, including recovery and success screens',async()=>{
 for(const [route,id,title] of [['/account/login','login','Sign in'],['/account/signup','signup','Create your account'],['/account/reset-password','forgot','Reset your password'],['/account/reset-password?type=recovery','newpw','Choose a new password']]){
  const env=await page(route);
  try{
   assert.ok(env.w.document.body.classList.contains('ap-auth-page'),route);
   assert.ok(env.w.document.getElementById(id),route);assert.equal(env.w.document.querySelector('h1').textContent,title);
   if(id==='forgot'){
    const form=env.w.document.getElementById(id);form.elements.email.value=user.email;
    await form.onsubmit({preventDefault(){},currentTarget:form});
    assert.equal(env.w.document.querySelector('h1').textContent,'Check your email');
    assert.ok(env.w.document.body.classList.contains('ap-auth-page'),'success message retains the compact auth presentation');
   }
  }finally{env.dom.window.close();}
 }
 const account=await page('/account',{signedIn:true}),checkout=await page('/checkout',{signedIn:true});
 try{
  assert.equal(account.w.document.body.classList.contains('ap-auth-page'),false);
  assert.equal(checkout.w.document.body.classList.contains('ap-auth-page'),false);
  assert.ok(checkout.w.document.body.classList.contains('ap-checkout-page'));
  account.recovery();assert.ok(account.w.document.body.classList.contains('ap-auth-page'),'recovery event gets the auth layout');
  assert.ok(account.w.document.getElementById('newpw'));
  checkout.recovery();assert.ok(checkout.w.document.body.classList.contains('ap-auth-page'));
  assert.equal(checkout.w.document.body.classList.contains('ap-checkout-page'),false,'a recovery form replaces checkout rather than inheriting its wide layout');
 }finally{account.dom.window.close();checkout.dom.window.close();}
});
