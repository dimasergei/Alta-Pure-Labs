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
 const w=dom.window,assigned=[],panels=[],signins=[],signups=[],oauth=[],resets=[],requests=[];
 if(storedReturn)w.sessionStorage.setItem('ap-account-return',storedReturn);
 let onState;
 const auth={auth:{
  onAuthStateChange(callback){onState=callback;},
  getSession:async()=>({data:{session:signedIn?{user,access_token:'fixture-token'}:null}}),
  signInWithPassword:async value=>{signins.push(value);return {error:null};},
  signUp:async value=>{signups.push(value);return {data:{session:null},error:null};},
  signInWithOAuth:async value=>{oauth.push(value);return {error:null};},
  resetPasswordForEmail:async(email,options)=>{resets.push({email,options});return {};},
  updateUser:async()=>({error:null}),signOut:async()=>({})
 }};
 w.supabase={createClient:()=>auth};
 w.AltaWorkspace={renderAccountPanel:(route,element)=>{panels.push(route);element.textContent='Authenticated '+route;}};
 w.AccountExperience={profile:()=>panels.push('/account/profile')};
 w.DirectCheckout={overview:()=>panels.push('/account'),checkout:()=>panels.push('/checkout')};
 const url=new URL(w.location.href),location={origin:url.origin,pathname:url.pathname,search:url.search,assign:next=>assigned.push(next)};
 const context={window:w,document:w.document,location,sessionStorage:w.sessionStorage,FormData:w.FormData,URL,URLSearchParams,Intl,Date,
  fetch:async endpoint=>{requests.push(endpoint);assert.equal(endpoint,'/api/customer-config');return {ok:true,json:async()=>({supabaseUrl:'https://fixture.invalid',anonKey:'fixture-public-key'})};}};
 vm.runInNewContext(source,context,{timeout:1000});await tick();
 return {dom,w,assigned,panels,signins,signups,oauth,resets,requests,recovery:()=>onState('PASSWORD_RECOVERY',{user})};
}
function authLink(env,route){
 const link=[...env.w.document.querySelectorAll('a[href]')].find(a=>new URL(a.href).pathname===route);
 assert.ok(link,'expected an auth link to '+route);return link.getAttribute('href');
}
function assertDestination(href,route,destination){
 const url=new URL(href,'https://pure.example');
 assert.equal(url.origin,'https://pure.example');assert.equal(url.pathname,route);
 assert.equal(url.searchParams.get('returnTo'),destination);
}
async function submit(env,id,values){
 const form=env.w.document.getElementById(id);assert.ok(form,'expected '+id+' form');
 for(const [name,value] of Object.entries(values)){
  const input=form.elements.namedItem(name);assert.ok(input,'expected '+name+' field');
  if(input.type==='checkbox')input.checked=Boolean(value);else input.value=value;
 }
 await form.onsubmit({preventDefault(){},currentTarget:form});
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

test('auth cross-links retain membership checkout in fresh page contexts and through password reset feedback',async()=>{
 for(const destination of ['/checkout?plan=vip&period=monthly','/checkout?plan=elite&period=annual']){
  const pages=[];
  try{
   const login=await page('/account/login?returnTo='+encodeURIComponent(destination));pages.push(login);
   const signupHref=authLink(login,'/account/signup'),resetHref=authLink(login,'/account/reset-password');
   assertDestination(signupHref,'/account/signup',destination);
   assertDestination(resetHref,'/account/reset-password',destination);
   // No session storage is copied: these links work in independently opened tabs.
   const signup=await page(signupHref);pages.push(signup);
   assert.equal(signup.w.sessionStorage.getItem('ap-account-return'),destination);
   const loginHref=authLink(signup,'/account/login');assertDestination(loginHref,'/account/login',destination);
   const returned=await page(loginHref);pages.push(returned);
   await submit(returned,'login',{email:user.email,password:'Fixture-only-password1!'});
   assert.deepEqual(returned.assigned,[destination]);
   const reset=await page(resetHref);pages.push(reset);
   assert.equal(reset.w.sessionStorage.getItem('ap-account-return'),destination);
   assertDestination(authLink(reset,'/account/login'),'/account/login',destination);
   await submit(reset,'forgot',{email:user.email});
   assert.equal(reset.w.document.querySelector('h1').textContent,'Check your email');
   assertDestination(authLink(reset,'/account/login'),'/account/login',destination);
   assert.equal(reset.resets[0].options.redirectTo,'https://pure.example/account/reset-password','provider callback stays on its existing query-free URL');
  }finally{for(const env of pages)env.dom.window.close();}
 }
});

test('signup and password-update confirmation links carry the saved destination without changing email callback URLs',async()=>{
 const destination='/checkout?plan=vip&period=annual',signup=await page('/account/signup?returnTo='+encodeURIComponent(destination));
 let reset;
 try{
  await submit(signup,'signup',{name:'Fixture Researcher',email:user.email,password:'Fixture-only-password1!',confirm:'Fixture-only-password1!',research:true});
  assert.equal(signup.signups.length,1);assert.equal(signup.w.document.querySelector('h1').textContent,'Check your email');
  assertDestination(authLink(signup,'/account/login'),'/account/login',destination);
  assert.equal(signup.signups[0].options.emailRedirectTo,'https://pure.example/account','confirmation callback stays on its existing URL');
  reset=await page('/account/reset-password?type=recovery',{storedReturn:destination});
  await submit(reset,'newpw',{password:'Fixture-only-new-password2!',confirm:'Fixture-only-new-password2!'});
  assert.equal(reset.w.document.querySelector('h1').textContent,'Password updated');
  assertDestination(authLink(reset,'/account/login'),'/account/login',destination);
 }finally{signup.dom.window.close();reset?.dom.window.close();}
});

test('auth cross-links reuse only allowed saved destinations and never propagate external or private admin targets',async()=>{
 const destination='/account/membership?view=benefits';
 const saved=await page('/account/login',{storedReturn:destination});
 try{
  assertDestination(authLink(saved,'/account/signup'),'/account/signup',destination);
  assertDestination(authLink(saved,'/account/reset-password'),'/account/reset-password',destination);
 }finally{saved.dom.window.close();}
 for(const value of ['https://outside.example/checkout','//outside.example/checkout','/admin','/checkout\\outside','/checkout\r\nX-Test: yes']){
  const env=await page('/account/login?returnTo='+encodeURIComponent(value),{storedReturn:value});
  try{
   assert.equal(authLink(env,'/account/signup'),'/account/signup');
   assert.equal(authLink(env,'/account/reset-password'),'/account/reset-password');
  }finally{env.dom.window.close();}
 }
});

test('Google sign-in precedes the alternative divider and email form on both auth pages',async()=>{
 for(const route of ['/account/login','/account/signup']){
  const env=await page(route+'?returnTo='+encodeURIComponent('/checkout?plan=vip&period=monthly'));
  try{
   const google=env.w.document.getElementById('google-signin'),divider=env.w.document.querySelector('.account-divider'),form=env.w.document.querySelector('.account-form');
   assert.ok(google&&divider&&form);
   const follows=env.w.Node.DOCUMENT_POSITION_FOLLOWING;
   assert.ok(google.compareDocumentPosition(divider)&follows,'Google comes before the divider');
   assert.ok(divider.compareDocumentPosition(form)&follows,'the divider separates Google from email');
   assert.equal(env.w.document.querySelectorAll('.account-divider').length,1);
   await google.onclick();assert.equal(env.oauth.length,1);assert.equal(env.oauth[0].provider,'google');
   const callback=new URL(env.oauth[0].options.redirectTo);
   assert.equal(callback.pathname,'/account');assert.equal(callback.search,'','OAuth callback URL remains query-free');
  }finally{env.dom.window.close();}
 }
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
