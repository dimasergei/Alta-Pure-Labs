'use strict';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function shortOrder(id){if(!UUID.test(String(id||'')))return 'AP-UNKNOWN';return 'AP'+id.replace(/-/g,'').slice(0,10).toUpperCase();}
module.exports={shortOrder};
