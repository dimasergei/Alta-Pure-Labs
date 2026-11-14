'use strict';
// Legacy Stripe collection remains retired. Raw bodies preserve webhook signatures.
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store, max-age=0');res.setHeader('X-Content-Type-Options','nosniff');
 const params=new URL(req.url||'/api/checkout','https://altapurelabs.com').searchParams;
 if(['rampex-readiness','rampex-webhook'].includes(params.get('native')))return require('../lib/rampex-connection').handle(req,res,params);
 if(params.has('native'))return require('../lib/native-gateway').handle(req,res,params);
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Use POST.'});}
 return res.status(503).json({error:'Online checkout is temporarily unavailable while payment options are updated.'});
};
module.exports.config={api:{bodyParser:false}};
