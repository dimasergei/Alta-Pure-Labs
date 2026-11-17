'use strict';
const terms=require('../config/launch-commercial-terms.json');
const checkout=require('../config/checkout.json');
const conversion=require('../config/conversion.json');
// Old plan definitions remain private metadata for historical records.
module.exports=function storefrontTerms(){
 return {version:terms.version,base_currency:terms.base_currency,manual_fulfillment:terms.manual_fulfillment,
  invoice_expiry_hours:terms.invoice_expiry_hours,memberships_enabled:false,rewards_earning_enabled:false,
  affiliate_commissions_enabled:terms.affiliate_commissions_enabled,gift_cards_enabled:false,
  conversion:{version:conversion.version,memberships_enabled:false,free_shipping_threshold_cents:checkout.free_shipping_threshold_cents}};
};
