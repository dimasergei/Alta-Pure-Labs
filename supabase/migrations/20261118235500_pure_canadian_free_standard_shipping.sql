-- U.S. and Canadian standard shipping is free above the shared USD 150 merchandise threshold.
-- For CAD Interac, calculate eligibility from canonical USD merchandise before FX display conversion.
-- Other destinations remain at their previously quoted rates; premium delivery and extras are unchanged.
-- Leaves invoices, subscriptions, benefits, balances and historical paid shipping snapshots intact.

create or replace function commerce_internal.regular_delivery_quote(p_selection jsonb, p_country text, p_merchandise integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  shipping_id text:=p_selection->>'shipping';
  ids text[]; extra_id text; option_row public.commerce_delivery_options%rowtype;
  ship integer; extras_total integer:=0; extras jsonb:='[]'::jsonb;
begin
  if jsonb_typeof(p_selection) is distinct from 'object'
    or shipping_id is null or shipping_id not in ('standard','express','next_day')
    or jsonb_typeof(p_selection->'extras') is distinct from 'array'
    or jsonb_array_length(p_selection->'extras')>2
    or p_merchandise is null or p_merchandise<0
    or p_country is null or p_country !~ '^[A-Z]{2}$'
    or p_country in ('RU','BY','IR','KP','CU','SY')
    or not (p_country=any(string_to_array('AF,AX,AL,DZ,AS,AD,AO,AI,AQ,AG,AR,AM,AW,AU,AT,AZ,BS,BH,BD,BB,BE,BZ,BJ,BM,BT,BO,BQ,BA,BW,BV,BR,IO,BN,BG,BF,BI,CV,KH,CM,CA,KY,CF,TD,CL,CN,CX,CC,CO,KM,CG,CD,CK,CR,CI,HR,CW,CY,CZ,DK,DJ,DM,DO,EC,EG,SV,GQ,ER,EE,SZ,ET,FK,FO,FJ,FI,FR,GF,PF,TF,GA,GM,GE,DE,GH,GI,GR,GL,GD,GP,GU,GT,GG,GN,GW,GY,HT,HM,VA,HN,HK,HU,IS,IN,ID,IQ,IE,IM,IL,IT,JM,JP,JE,JO,KZ,KE,KI,KR,KW,KG,LA,LV,LB,LS,LR,LY,LI,LT,LU,MO,MG,MW,MY,MV,ML,MT,MH,MQ,MR,MU,YT,MX,FM,MD,MC,MN,ME,MS,MA,MZ,MM,NA,NR,NP,NL,NC,NZ,NI,NE,NG,NU,NF,MK,MP,NO,OM,PK,PW,PS,PA,PG,PY,PE,PH,PN,PL,PT,PR,QA,RE,RO,RW,BL,SH,KN,LC,MF,PM,VC,WS,SM,ST,SA,SN,RS,SC,SL,SG,SX,SK,SI,SB,SO,ZA,GS,SS,ES,LK,SD,SR,SJ,SE,CH,TW,TJ,TZ,TH,TL,TG,TK,TO,TT,TN,TR,TM,TC,TV,UG,UA,AE,GB,UM,US,UY,UZ,VU,VE,VN,VG,VI,WF,EH,YE,ZM,ZW',',')))
  then raise exception 'Invalid delivery selection' using errcode='22023'; end if;
  if not exists(select 1 from public.commerce_delivery_options where id=shipping_id and kind='shipping' and enabled)
  then raise exception 'Shipping option unavailable' using errcode='P0001'; end if;
  ship:=case p_country
    when 'US' then case shipping_id when 'standard' then case when p_merchandise>=15000 then 0 else 1495 end when 'express' then 3495 when 'next_day' then 6995 end
    when 'CA' then case shipping_id when 'standard' then case when p_merchandise>=15000 then 0 else 3995 end when 'express' then 5995 when 'next_day' then 6995 end
    else case shipping_id when 'standard' then 5995 when 'express' then 9995 end end;
  if ship is null then raise exception 'Shipping service unavailable for destination' using errcode='22023'; end if;
  select array_agg(value order by value) into ids from jsonb_array_elements_text(p_selection->'extras');
  if cardinality(ids) is distinct from (select count(distinct value)::integer from unnest(ids) value) and cardinality(ids) is not null
  then raise exception 'Duplicate delivery extra' using errcode='22023'; end if;
  foreach extra_id in array coalesce(ids,array[]::text[]) loop
    if extra_id not in ('priority','protection') then raise exception 'Unsupported delivery extra' using errcode='22023'; end if;
    select * into option_row from public.commerce_delivery_options where id=extra_id and kind='extra' and enabled;
    if not found then raise exception 'Delivery extra unavailable' using errcode='P0001'; end if;
    extras:=extras||jsonb_build_array(jsonb_build_object('id',option_row.id,'label',option_row.label,'amount_cents',option_row.price_cents));
    extras_total:=extras_total+option_row.price_cents;
  end loop;
  return jsonb_build_object('selection',jsonb_build_object('shipping',shipping_id,'extras',to_jsonb(coalesce(ids,array[]::text[]))),
    'shipping_cents',ship,'country',p_country,'rate_version','shipping-2026-11-v3',
    'extras',extras,'extras_cents',extras_total,'total_cents',ship+extras_total);
end $$;

revoke all on function commerce_internal.regular_delivery_quote(jsonb,text,integer) from public,anon,authenticated,service_role;

