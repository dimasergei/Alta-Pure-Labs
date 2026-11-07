const {clients,checked}=require('../lib/backend');
module.exports=async(req,res)=>{
  if(req.method!=='POST') return res.status(405).end();
  let event, stripe, db;
  try {
    ({stripe,db}=clients());
    const chunks=[]; let length=0;
    for await (const chunk of req) {const c=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk); length+=c.length; if(length>1048576) return res.status(413).end(); chunks.push(c);}
    event=stripe.webhooks.constructEvent(Buffer.concat(chunks),req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET);
  } catch(e) {return res.status(400).send('Invalid signature or webhook configuration.');}
  const allowed=['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired'];
  if(!allowed.includes(event.type)) return res.status(200).json({received:true,ignored:true});
  try {
    const s=await stripe.checkout.sessions.retrieve(event.data.object.id);
    if(!s.metadata?.order_id) return res.status(200).json({received:true,ignored:true});
    const shipping =
  s.collected_information?.shipping_details ??
  s.shipping_details;
    checked(await db.rpc('apply_store_checkout_event',{
      p_event_id:event.id,p_event_type:event.type,p_order_id:s.metadata.order_id,
      p_session_id:s.id,p_payment_intent:typeof s.payment_intent==='string'?s.payment_intent:s.payment_intent?.id||null,
      p_paid:s.payment_status==='paid',p_currency:s.currency,p_subtotal:s.amount_subtotal,
      p_shipping:s.total_details?.amount_shipping||0,p_tax:s.total_details?.amount_tax||0,p_total:s.amount_total,
      p_shipping_name:shipping?.name||null,p_shipping_address:shipping?.address||null
    }));
    return res.status(200).json({received:true});
  }catch(e){console.error('webhook database error',e.code||e.name);return res.status(500).send('Processing failed; retry.');}
};
module.exports.config={api:{bodyParser:false}};
