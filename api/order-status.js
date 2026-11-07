const {clients,checked}=require('../lib/backend');
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).end();
  const id=req.query.session_id;
  if(typeof id!=='string'||!id.startsWith('cs_test_')||id.length>255) return res.status(400).json({error:'Invalid session.'});
  try{
    const {db}=clients();
    const row=checked(await db.from('store_orders').select('payment_status,total_cents,currency').eq('stripe_checkout_session_id',id).maybeSingle());
    return res.status(200).json(row?{status:row.payment_status,total_cents:row.total_cents,currency:row.currency}:{status:'pending'});
  }catch(e){return res.status(503).json({error:'Status unavailable.'});}
};
