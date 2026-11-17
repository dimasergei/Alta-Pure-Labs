-- Direct native Polygon USDC. No keys, wallet addresses, routes or payments are seeded.
-- Only service-owned verifier code can create, reconcile or release an intent.
alter table public.commerce_payment_methods drop constraint commerce_payment_methods_native_provider_check;
alter table public.commerce_payment_methods add constraint commerce_payment_methods_native_provider_check check(native_provider in ('nmi','payerurl','peptidepay','rampex','polygon_usdc'));
alter table public.commerce_gateway_accounts drop constraint commerce_gateway_accounts_provider_check;
alter table public.commerce_gateway_accounts add constraint commerce_gateway_accounts_provider_check check(provider in ('nmi','payerurl','peptidepay','rampex','polygon_usdc'));
alter table public.commerce_gateway_attempts drop constraint commerce_gateway_attempts_provider_check;
alter table public.commerce_gateway_attempts add constraint commerce_gateway_attempts_provider_check check(provider in ('nmi','payerurl','peptidepay','rampex','polygon_usdc'));
alter table public.commerce_gateway_accounts add column polygon_recipient text;
alter table public.commerce_gateway_accounts drop constraint commerce_gateway_accounts_countries_check;
alter table public.commerce_gateway_accounts add constraint commerce_gateway_accounts_countries_check check(cardinality(countries) between 1 and case when provider='polygon_usdc' then 250 else 60 end);
alter table public.commerce_gateway_accounts add constraint polygon_usdc_account_destination check(provider<>'polygon_usdc' or (mode='live' and polygon_recipient is not null and polygon_recipient ~ '^0x[0-9a-f]{40}$' and polygon_recipient<>'0x0000000000000000000000000000000000000000'));

create table public.commerce_polygon_usdc_intents(
 attempt_id uuid primary key references public.commerce_gateway_attempts(id),
 invoice_id uuid not null references public.commerce_invoices(id),
 account_tag text not null check(account_tag ~ '^[a-f0-9]{64}$'),
 chain_id integer not null check(chain_id=137),
 token text not null check(token='0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'),
 recipient text not null check(recipient ~ '^0x[0-9a-f]{40}$'),
 payer text not null check(payer ~ '^0x[0-9a-f]{40}$' and payer<>'0x0000000000000000000000000000000000000000'),
 amount_units numeric(30,0) not null check(amount_units>0),
 nonce text not null unique check(nonce ~ '^0x[0-9a-f]{64}$'),
 valid_after bigint not null check(valid_after>=0),
 valid_before bigint not null check(valid_before>valid_after),
 start_block bigint not null check(start_block>=0),
 candidate_tx_hash text check(candidate_tx_hash ~ '^0x[0-9a-f]{64}$'),
 status text not null default 'open' check(status in ('open','submitted','paid','review','expired')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index polygon_usdc_invoice_intents on public.commerce_polygon_usdc_intents(invoice_id);
create index polygon_usdc_pending_intents on public.commerce_polygon_usdc_intents(updated_at) where status in ('open','submitted');
create table public.commerce_polygon_usdc_proofs(
 attempt_id uuid primary key references public.commerce_polygon_usdc_intents(attempt_id),
 chain_id integer not null check(chain_id=137),
 tx_hash text not null check(tx_hash ~ '^0x[0-9a-f]{64}$'),
 log_index integer not null check(log_index>=0),
 block_number bigint not null check(block_number>=0),
 block_hash text not null check(block_hash ~ '^0x[0-9a-f]{64}$'),
 block_timestamp bigint not null,
 proof jsonb not null, created_at timestamptz not null default now(),
 unique(chain_id,tx_hash,log_index)
);
alter table public.commerce_polygon_usdc_intents enable row level security;
alter table public.commerce_polygon_usdc_proofs enable row level security;
revoke all on public.commerce_polygon_usdc_intents,public.commerce_polygon_usdc_proofs from public,anon,authenticated,service_role;
grant select on public.commerce_polygon_usdc_intents,public.commerce_polygon_usdc_proofs to service_role;

create function public.commerce_configure_polygon_usdc_gateway(p_data jsonb,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare mid uuid:=(p_data->>'id')::uuid; m public.commerce_payment_methods%rowtype; codes text[]; country text; recipient text:=lower(p_data->>'polygon_recipient'); tag text;
begin
 tag:=encode(sha256(convert_to('polygon_usdc:live:137:0x3c499c542cef5e3811e1192ce70d8cc03d5c3359:'||recipient,'UTF8')),'hex');
 if mid is null or p_data->>'provider' is distinct from 'polygon_usdc' or p_data->>'mode' is distinct from 'live'
  or p_data->>'currency' is distinct from 'USD' or p_data->>'sale_scope' is distinct from 'goods'
  or p_data->>'confirmed' is distinct from 'true' or p_data->>'account_tag' is distinct from tag
  or recipient is null or recipient !~ '^0x[0-9a-f]{40}$' or recipient='0x0000000000000000000000000000000000000000'
  or length(coalesce(p_actor,''))<8 then raise exception 'Invalid Polygon USDC route' using errcode='22023'; end if;
 select array_agg(value) into codes from jsonb_array_elements_text(p_data->'countries');
 if codes is null or cardinality(codes) not between 1 and 250 or cardinality(codes)<>(select count(distinct value) from unnest(codes) value) then raise exception 'Supported destinations required' using errcode='22023'; end if;
 foreach country in array codes loop if country is null or country !~ '^[A-Z]{2}$' then raise exception 'Invalid country' using errcode='22023'; end if; end loop;
 select * into m from public.commerce_payment_methods where id=mid for update;
 if found then
  if m.version is distinct from (p_data->>'version')::integer then raise exception 'Gateway changed' using errcode='40001'; end if;
  if m.native_provider is distinct from 'polygon_usdc' or m.currency is distinct from 'USD'
   or not exists(select 1 from public.commerce_gateway_accounts where method_id=mid and account_tag=tag and polygon_recipient=recipient and provider='polygon_usdc')
  then raise exception 'Use a new route for a different receiving wallet' using errcode='22023'; end if;
  update public.commerce_payment_methods set label=p_data->>'label',payee=p_data->>'payee',acceptance_reference=p_data->>'approval_reference',active=(p_data->>'active')::boolean,version=version+1,updated_at=now() where id=mid;
  update public.commerce_gateway_accounts set countries=codes where method_id=mid;
 else
  if (p_data->>'version')::integer is distinct from 0 then raise exception 'Unknown gateway' using errcode='P0002'; end if;
  insert into public.commerce_payment_methods(id,kind,label,currency,payee,instructions,allowed_host,acceptance_reference,active,provider_key,display_order,sale_scope,native_provider)
  values(mid,'hosted_link',p_data->>'label','USD',p_data->>'payee','Pay native USDC on Polygon from a compatible wallet. Exact order authorization and finalized receipt are required.','getpurelabs.com',p_data->>'approval_reference',(p_data->>'active')::boolean,'custom',5,'goods','polygon_usdc');
  insert into public.commerce_gateway_accounts(method_id,provider,mode,account_tag,countries,polygon_recipient) values(mid,'polygon_usdc','live',tag,codes,recipient);
 end if;
 insert into public.commerce_events(method_id,action,actor,details) values(mid,'polygon_usdc_gateway_configured',p_actor,jsonb_build_object('provider','polygon_usdc','active',p_data->'active','chain_id',137,'recipient_tail',right(recipient,6)));
 return jsonb_build_object('id',mid,'saved',true);
end $$;

create function public.commerce_create_polygon_usdc_intent(p_id uuid,p_invoice uuid,p_customer uuid,p_account_tag text,p_intent jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare i public.commerce_invoices%rowtype; a public.commerce_gateway_accounts%rowtype; prior public.commerce_polygon_usdc_intents%rowtype; attempt jsonb;
begin
 select * into i from public.commerce_invoices where id=p_invoice and customer_id=p_customer for update;
 if not found then raise exception 'Order not found' using errcode='P0002'; end if;
 select * into a from public.commerce_gateway_accounts where method_id=i.method_id;
 if i.currency<>'USD' or i.kind<>'goods' or i.total_cents<1 or a.provider is distinct from 'polygon_usdc' or a.account_tag is distinct from p_account_tag
 then raise exception 'Invalid native USDC order route' using errcode='22023'; end if;
 select * into prior from public.commerce_polygon_usdc_intents where invoice_id=i.id order by created_at desc limit 1;
 if found then return to_jsonb(prior); end if;
 if p_intent->>'chain_id' is distinct from '137' or p_intent->>'token' is distinct from '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'
  or p_intent->>'recipient' is distinct from a.polygon_recipient or (p_intent->>'amount_units')::numeric is distinct from i.total_cents::numeric*10000
  or p_intent->>'payer' is null or p_intent->>'payer' !~ '^0x[0-9a-f]{40}$' or p_intent->>'payer'='0x0000000000000000000000000000000000000000'
  or p_intent->>'nonce' is null or p_intent->>'nonce' !~ '^0x[0-9a-f]{64}$'
  or (p_intent->>'valid_after')::bigint is null or (p_intent->>'valid_after')::bigint>extract(epoch from now())
  or (p_intent->>'valid_before')::bigint is null or (p_intent->>'valid_before')::bigint<=extract(epoch from now())
  or (p_intent->>'valid_before')::bigint>extract(epoch from least(i.expires_at,now()+interval '1 hour'))
  or (p_intent->>'start_block')::bigint is null then raise exception 'Invalid immutable USDC authorization' using errcode='22023'; end if;
 attempt:=public.commerce_begin_gateway_attempt(p_id,p_invoice,p_customer,'sale',p_account_tag);
 if attempt->>'provider' is distinct from 'polygon_usdc' or attempt->>'state' is distinct from 'started' then raise exception 'Existing payment requires reconciliation' using errcode='P0001'; end if;
 insert into public.commerce_polygon_usdc_intents(attempt_id,invoice_id,account_tag,chain_id,token,recipient,payer,amount_units,nonce,valid_after,valid_before,start_block)
 values((attempt->>'id')::uuid,i.id,p_account_tag,137,p_intent->>'token',a.polygon_recipient,p_intent->>'payer',(p_intent->>'amount_units')::numeric,p_intent->>'nonce',(p_intent->>'valid_after')::bigint,(p_intent->>'valid_before')::bigint,(p_intent->>'start_block')::bigint) returning * into prior;
 return to_jsonb(prior);
end $$;

create function public.commerce_note_polygon_usdc_submission(p_id uuid,p_hash text,p_account_tag text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare intent public.commerce_polygon_usdc_intents%rowtype;
begin
 if p_hash is not null and p_hash !~ '^0x[0-9a-f]{64}$' then raise exception 'Invalid transaction reference' using errcode='22023'; end if;
 select * into intent from public.commerce_polygon_usdc_intents where attempt_id=p_id for update;
 if not found or intent.account_tag is distinct from p_account_tag then raise exception 'Unknown payment authorization' using errcode='P0002'; end if;
 if intent.status in ('paid','review','expired') then return to_jsonb(intent); end if;
 update public.commerce_polygon_usdc_intents set candidate_tx_hash=coalesce(p_hash,candidate_tx_hash),status=case when p_hash is null then status else 'submitted' end,updated_at=now() where attempt_id=p_id returning * into intent;
 return to_jsonb(intent);
end $$;

create function public.commerce_finish_polygon_usdc_payment(p_id uuid,p_account_tag text,p_proof jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare intent public.commerce_polygon_usdc_intents%rowtype; i public.commerce_invoices%rowtype; attempt public.commerce_gateway_attempts%rowtype; previous public.commerce_polygon_usdc_proofs%rowtype; result jsonb;
begin
 select invoice_id into intent.invoice_id from public.commerce_polygon_usdc_intents where attempt_id=p_id;
 select * into i from public.commerce_invoices where id=intent.invoice_id for update;
 select * into attempt from public.commerce_gateway_attempts where id=p_id for update;
 select * into intent from public.commerce_polygon_usdc_intents where attempt_id=p_id for update;
 if intent.attempt_id is null or intent.account_tag is distinct from p_account_tag or attempt.provider is distinct from 'polygon_usdc' or attempt.mode is distinct from 'live'
  or attempt.account_tag is distinct from p_account_tag or attempt.amount_cents is distinct from i.total_cents or attempt.currency is distinct from 'USD'
  or p_proof->>'chain_id' is distinct from '137' or p_proof->>'token' is distinct from intent.token
  or p_proof->>'recipient' is distinct from intent.recipient or p_proof->>'payer' is distinct from intent.payer or p_proof->>'nonce' is distinct from intent.nonce
  or (p_proof->>'amount_units')::numeric is distinct from intent.amount_units
  or p_proof->>'tx_hash' is null or p_proof->>'tx_hash' !~ '^0x[0-9a-f]{64}$'
  or p_proof->>'block_hash' is null or p_proof->>'block_hash' !~ '^0x[0-9a-f]{64}$'
  or (p_proof->>'log_index')::integer is null or (p_proof->>'log_index')::integer<0
  or (p_proof->>'block_number')::bigint is null or (p_proof->>'block_number')::bigint<intent.start_block
  or (p_proof->>'finalized_number')::bigint is null or (p_proof->>'finalized_number')::bigint<(p_proof->>'block_number')::bigint
  or (p_proof->>'block_timestamp')::bigint is null or (p_proof->>'block_timestamp')::bigint<=intent.valid_after or (p_proof->>'block_timestamp')::bigint>=intent.valid_before
 then raise exception 'Finalized USDC proof does not match the saved authorization' using errcode='22023'; end if;
 select * into previous from public.commerce_polygon_usdc_proofs where attempt_id=p_id;
 if found then
  if previous.tx_hash is distinct from p_proof->>'tx_hash' or previous.log_index is distinct from (p_proof->>'log_index')::integer or previous.block_hash is distinct from p_proof->>'block_hash'
  then raise exception 'Conflicting USDC receipt' using errcode='23505'; end if;
  return jsonb_build_object('state',intent.status,'invoice_id',i.id,'replayed',true);
 end if;
 insert into public.commerce_polygon_usdc_proofs(attempt_id,chain_id,tx_hash,log_index,block_number,block_hash,block_timestamp,proof)
 values(p_id,137,p_proof->>'tx_hash',(p_proof->>'log_index')::integer,(p_proof->>'block_number')::bigint,p_proof->>'block_hash',(p_proof->>'block_timestamp')::bigint,p_proof);
 if i.status<>'accepted' or i.expires_at<=now() or attempt.state in ('declined','refunded','review') then
  update public.commerce_gateway_attempts set state='review',error_code='usdc_late_payment_review',updated_at=now() where id=p_id;
  update public.commerce_polygon_usdc_intents set status='review',candidate_tx_hash=p_proof->>'tx_hash',updated_at=now() where attempt_id=p_id;
  return jsonb_build_object('state','review','invoice_id',i.id);
 end if;
 result:=public.commerce_finish_gateway_attempt(p_id,'polygon-usdc-paid:'||p_id::text,'approved','137:'||(p_proof->>'tx_hash')||':'||(p_proof->>'log_index'),i.total_cents,'USD',null,null);
 update public.commerce_polygon_usdc_intents set status=case when result->>'state'='paid' then 'paid' else 'review' end,candidate_tx_hash=p_proof->>'tx_hash',updated_at=now() where attempt_id=p_id;
 return result;
end $$;

create function public.commerce_release_polygon_usdc_intent(p_id uuid,p_account_tag text,p_finalized_block bigint,p_finalized_timestamp bigint,p_nonce_unused boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare intent public.commerce_polygon_usdc_intents%rowtype; i public.commerce_invoices%rowtype; attempt public.commerce_gateway_attempts%rowtype;
begin
 select invoice_id into intent.invoice_id from public.commerce_polygon_usdc_intents where attempt_id=p_id;
 select * into i from public.commerce_invoices where id=intent.invoice_id for update;
 select * into attempt from public.commerce_gateway_attempts where id=p_id for update;
 select * into intent from public.commerce_polygon_usdc_intents where attempt_id=p_id for update;
 if intent.attempt_id is null or intent.account_tag is distinct from p_account_tag or p_nonce_unused is distinct from true
  or p_finalized_block is null or p_finalized_block<intent.start_block or p_finalized_timestamp is null or p_finalized_timestamp<=intent.valid_before
  or i.status<>'accepted' or attempt.provider<>'polygon_usdc' or attempt.state in ('paid','refunded','review')
  or exists(select 1 from public.commerce_polygon_usdc_proofs where attempt_id=p_id)
 then raise exception 'Crypto payment cannot safely be released' using errcode='P0001'; end if;
 perform public.commerce_finish_gateway_attempt(p_id,'polygon-usdc-expired:'||p_id::text,'declined',null,null,null,null,'authorization_expired_unused');
 update public.commerce_polygon_usdc_intents set status='expired',updated_at=now() where attempt_id=p_id;
 return jsonb_build_object('confirmed_unpaid',true,'invoice_id',i.id);
end $$;

revoke all on function public.commerce_configure_polygon_usdc_gateway(jsonb,text),public.commerce_create_polygon_usdc_intent(uuid,uuid,uuid,text,jsonb),public.commerce_note_polygon_usdc_submission(uuid,text,text),public.commerce_finish_polygon_usdc_payment(uuid,text,jsonb),public.commerce_release_polygon_usdc_intent(uuid,text,bigint,bigint,boolean) from public,anon,authenticated;
grant execute on function public.commerce_configure_polygon_usdc_gateway(jsonb,text),public.commerce_create_polygon_usdc_intent(uuid,uuid,uuid,text,jsonb),public.commerce_note_polygon_usdc_submission(uuid,text,text),public.commerce_finish_polygon_usdc_payment(uuid,text,jsonb),public.commerce_release_polygon_usdc_intent(uuid,text,bigint,bigint,boolean) to service_role;


-- Reuse the signed, nonce-protected worker. No secret is placed in pg_net's queue.
-- Mail and supplier queues retain their independent wake conditions.
create or replace function commerce_internal.dispatch_due_invoice_emails()
returns bigint language plpgsql set search_path to 'pg_catalog','pg_temp' as $$
declare signing_key text; ts text; nonce text; signature text;
begin
 if not exists(select 1 from public.commerce_notifications where state in ('queued','failed','sending') and next_attempt_at<=now())
 and not exists(select 1 from public.commerce_supplier_jobs j where j.status in ('queued','retry','working','submitted') and j.next_attempt_at<=now() and (j.lease_until is null or j.lease_until<now()) and exists(select 1 from public.commerce_supplier_settings where enabled and verified_at is not null and max_order_cents>0))
 and not exists(select 1 from public.commerce_polygon_usdc_intents where status in ('open','submitted') and updated_at<=now()-interval '45 seconds') then return null; end if;
 select decrypted_secret into signing_key from vault.decrypted_secrets where name='altapure_invoice_worker';
 if signing_key is null or length(signing_key)<32 then return null; end if;
 ts:=floor(extract(epoch from clock_timestamp()))::bigint::text;
 nonce:=gen_random_uuid()::text;
 signature:=encode(extensions.hmac(convert_to('invoice-email-retry'||chr(10)||ts||chr(10)||nonce,'UTF8'),convert_to(signing_key,'UTF8'),'sha256'),'hex');
 return net.http_post(url:='https://getpurelabs.com/api/customer-config?commerce=worker',
 headers:=jsonb_build_object('Content-Type','application/json','x-commerce-job-time',ts,'x-commerce-job-nonce',nonce,'x-commerce-job-signature',signature),
 body:='{}'::jsonb,timeout_milliseconds:=55000);
end $$;
revoke all on function commerce_internal.dispatch_due_invoice_emails() from public,anon,authenticated,service_role;
-- Update the existing job by name rather than creating a second worker schedule.
select cron.schedule('altapure-invoice-email-retry','* * * * *','select commerce_internal.dispatch_due_invoice_emails();');
