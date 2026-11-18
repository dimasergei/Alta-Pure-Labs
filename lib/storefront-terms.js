'use strict';
const terms=require('../config/launch-commercial-terms.json');
const checkout=require('../config/checkout.json');
const conversion=require('../config/conversion.json');
module.exports=function storefrontTerms(){
 return {version:terms.version,base_currency:terms.base_currency,manual_fulfillment:terms.manual_fulfillment,
  invoice_expiry_hours:terms.invoice_expiry_hours,memberships_enabled:conversion.memberships_enabled,rewards_earning_enabled:true,
  affiliate_commissions_enabled:terms.affiliate_commissions_enabled,gift_cards_enabled:false,
  conversion:{...conversion,free_shipping_threshold_cents:checkout.free_shipping_threshold_cents}};
};
