-- Owner-approved checkout shipping and opt-in fulfillment add-ons.
-- These are fixed storefront charges, not carrier-calculated postage or guaranteed delivery dates.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
update public.commerce_delivery_options set
 price_cents=case id
  when 'standard' then 1495
  when 'express' then 3495
  when 'next_day' then 6995
  when 'priority' then 999
  when 'cold_chain' then 999
  when 'protection' then 500
  else price_cents end,
 enabled=true,
 label=case id
  when 'standard' then 'Standard UPS'
  when 'express' then 'Express UPS'
  when 'next_day' then 'UPS Next Day'
  else label end,
 description=case id
  when 'standard' then 'Tracked standard shipping; carrier dates depend on destination and dispatch.'
  when 'express' then 'Expedited shipping where carrier coverage is available; no guaranteed arrival date.'
  when 'next_day' then 'Next-business-day shipping for eligible US destinations, subject to cutoffs and carrier availability.'
  when 'priority' then 'Priority order preparation, subject to daily dispatch capacity.'
  when 'cold_chain' then 'Insulated packaging with cooling materials; a specific transit temperature is not guaranteed.'
  when 'protection' then 'Optional seller-backed loss/damage protection, subject to published coverage terms.'
  else description end
where id in ('standard','express','next_day','priority','cold_chain','protection');
do $$
declare n int;
begin
 select count(*) into n from public.commerce_delivery_options
 where id in ('standard','express','next_day','priority','cold_chain','protection') and enabled=true;
 if n<>6 then raise exception 'All six checkout delivery options must exist before activation';end if;
end $$;
commit;
