-- A cancellation request immediately freezes checkout and fulfillment, but does
-- not claim a still-valid EIP-3009 authorization is revoked or unpaid.
-- The existing verifier keeps watching; unused finalized expiry completes void,
-- while a valid transfer is retained for review without receipts/fulfillment.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.commerce_invoices
 add column cancellation_requested_at timestamptz,
 add column cancellation_status text,
 add constraint commerce_cancellation_state_check check(
  (cancellation_requested_at is null)=(cancellation_status is null)
  and (cancellation_status is null or cancellation_status in ('pending','review','canceled'))
 );

create function commerce_internal.guard_requested_cancellation()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if old.cancellation_requested_at is not null then
  if new.cancellation_requested_at is distinct from old.cancellation_requested_at or new.cancellation_status is null
   or (new.status is distinct from old.status and new.status<>'void')
  then raise exception 'Cancellation is already requested; payment and fulfillment remain on hold' using errcode='P0001'; end if;
  if new.status='void' and old.status<>'void' then
   if old.cancellation_status='review' then raise exception 'Review the received crypto payment before resolving cancellation' using errcode='P0001'; end if;
   new.cancellation_status:='canceled';
  end if;
 end if;
 return new;
end $$;
revoke all on function commerce_internal.guard_requested_cancellation() from public,anon,authenticated,service_role;
create trigger invoice_requested_cancellation_guard before update of status,cancellation_status,cancellation_requested_at on public.commerce_invoices
 for each row execute function commerce_internal.guard_requested_cancellation();

create function public.commerce_request_polygon_usdc_cancellation(p_id uuid,p_customer uuid,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare i public.commerce_invoices%rowtype; intent public.commerce_polygon_usdc_intents%rowtype; attempt public.commerce_gateway_attempts%rowtype;
begin
 if p_id is null or p_customer is null or p_actor is null or p_actor not in ('customer:'||p_customer::text,'admin:unpaid-cancellation')
 then raise exception 'Invalid cancellation request' using errcode='22023'; end if;
 select * into i from public.commerce_invoices where id=p_id and customer_id=p_customer and checkout_version is not null for update;
 if not found then raise exception 'Order not found' using errcode='P0002'; end if;
 if i.status='void' then return jsonb_build_object('id',i.id,'status','void','cancellation_status',i.cancellation_status,'already_canceled',true); end if;
 select * into intent from public.commerce_polygon_usdc_intents where invoice_id=i.id;
 select * into attempt from public.commerce_gateway_attempts where id=intent.attempt_id for update;
 select * into intent from public.commerce_polygon_usdc_intents where invoice_id=i.id for update;
 if i.cancellation_requested_at is not null then
  return jsonb_build_object('id',i.id,'status',i.status,'cancellation_status',i.cancellation_status,'cancellation_requested_at',i.cancellation_requested_at,'authorization_expires_at',to_timestamp(intent.valid_before));
 end if;
 if i.status<>'accepted' or intent.attempt_id is null or attempt.provider is distinct from 'polygon_usdc' or attempt.mode is distinct from 'live'
  or exists(select 1 from public.commerce_receipts where invoice_id=i.id and kind='payment')
  or exists(select 1 from public.commerce_gateway_attempts where invoice_id=i.id and state<>'declined' and (id<>attempt.id or state<>'started'))
  or exists(select 1 from public.commerce_polygon_usdc_proofs where attempt_id=intent.attempt_id)
 then raise exception 'This payment needs reconciliation before cancellation' using errcode='P0001'; end if;
 if intent.status='expired' and attempt.state='declined' then return public.commerce_cancel_checkout(i.id,p_customer); end if;
 if intent.status not in ('open','submitted') or attempt.state<>'started' then raise exception 'This payment needs reconciliation before cancellation' using errcode='P0001'; end if;
 update public.commerce_invoices set cancellation_requested_at=now(),cancellation_status='pending',version=version+1,updated_at=now() where id=i.id returning * into i;
 insert into public.commerce_events(invoice_id,action,actor,details) values(i.id,'cancellation_requested',p_actor,jsonb_build_object('attempt_id',intent.attempt_id,'authorization_expires_at',to_timestamp(intent.valid_before),'payment_check_pending',true));
 return jsonb_build_object('id',i.id,'status',i.status,'cancellation_status','pending','cancellation_requested_at',i.cancellation_requested_at,'authorization_expires_at',to_timestamp(intent.valid_before));
end $$;

create or replace function public.commerce_create_polygon_usdc_intent(p_id uuid,p_invoice uuid,p_customer uuid,p_account_tag text,p_intent jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare i public.commerce_invoices%rowtype; a public.commerce_gateway_accounts%rowtype; prior public.commerce_polygon_usdc_intents%rowtype; attempt jsonb;
begin
 select * into i from public.commerce_invoices where id=p_invoice and customer_id=p_customer for update;
 if not found then raise exception 'Order not found' using errcode='P0002'; end if;
 if i.cancellation_requested_at is not null then raise exception 'Cancellation requested; do not authorize payment' using errcode='P0001'; end if;
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

create or replace function public.commerce_finish_polygon_usdc_payment(p_id uuid,p_account_tag text,p_proof jsonb)
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
 if i.cancellation_requested_at is not null or i.status<>'accepted' or i.expires_at<=now() or attempt.state in ('declined','refunded','review') then
  update public.commerce_gateway_attempts set state='review',error_code='usdc_late_payment_review',updated_at=now() where id=p_id;
  update public.commerce_polygon_usdc_intents set status='review',candidate_tx_hash=p_proof->>'tx_hash',updated_at=now() where attempt_id=p_id;
  if i.cancellation_requested_at is not null then
   update public.commerce_invoices set cancellation_status='review',version=version+1,updated_at=now() where id=i.id returning * into i;
   insert into public.commerce_events(invoice_id,action,actor,details) values(i.id,'cancellation_payment_review','verified-gateway:polygon_usdc',jsonb_build_object('attempt_id',p_id,'transaction_hash',p_proof->>'tx_hash','fulfillment_held',true));
  end if;
  return jsonb_build_object('state','review','invoice_id',i.id,'cancellation_status',i.cancellation_status);
 end if;
 result:=public.commerce_finish_gateway_attempt(p_id,'polygon-usdc-paid:'||p_id::text,'approved','137:'||(p_proof->>'tx_hash')||':'||(p_proof->>'log_index'),i.total_cents,'USD',null,null);
 update public.commerce_polygon_usdc_intents set status=case when result->>'state'='paid' then 'paid' else 'review' end,candidate_tx_hash=p_proof->>'tx_hash',updated_at=now() where attempt_id=p_id;
 return result;
end $$;

create or replace function public.commerce_release_polygon_usdc_intent(p_id uuid,p_account_tag text,p_finalized_block bigint,p_finalized_timestamp bigint,p_nonce_unused boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare intent public.commerce_polygon_usdc_intents%rowtype; i public.commerce_invoices%rowtype; attempt public.commerce_gateway_attempts%rowtype; result jsonb;
begin
 select invoice_id into intent.invoice_id from public.commerce_polygon_usdc_intents where attempt_id=p_id;
 select * into i from public.commerce_invoices where id=intent.invoice_id for update;
 select * into attempt from public.commerce_gateway_attempts where id=p_id for update;
 select * into intent from public.commerce_polygon_usdc_intents where attempt_id=p_id for update;
 if intent.attempt_id is null or intent.account_tag is distinct from p_account_tag or p_nonce_unused is distinct from true
  or p_finalized_block is null or p_finalized_block<intent.start_block or p_finalized_timestamp is null or p_finalized_timestamp<=intent.valid_before
  or attempt.provider is distinct from 'polygon_usdc' or attempt.mode is distinct from 'live' or attempt.account_tag is distinct from p_account_tag
  or attempt.state in ('paid','refunded','review') or exists(select 1 from public.commerce_polygon_usdc_proofs where attempt_id=p_id)
 then raise exception 'Crypto payment cannot safely be released' using errcode='P0001'; end if;
 if i.status='void' and i.cancellation_status='canceled' and intent.status='expired' and attempt.state='declined' then
  return jsonb_build_object('id',i.id,'status','void','cancellation_status','canceled','confirmed_unpaid',true,'invoice_id',i.id,'replayed',true);
 end if;
 if i.status<>'accepted' then raise exception 'Crypto payment cannot safely be released' using errcode='P0001'; end if;
 perform public.commerce_finish_gateway_attempt(p_id,'polygon-usdc-expired:'||p_id::text,'declined',null,null,null,null,'authorization_expired_unused');
 update public.commerce_polygon_usdc_intents set status='expired',updated_at=now() where attempt_id=p_id;
 if i.cancellation_requested_at is not null then
  result:=public.commerce_cancel_checkout(i.id,i.customer_id);
  return result||jsonb_build_object('cancellation_status','canceled','confirmed_unpaid',true,'invoice_id',i.id);
 end if;
 return jsonb_build_object('confirmed_unpaid',true,'invoice_id',i.id);
end $$;

revoke all on function public.commerce_request_polygon_usdc_cancellation(uuid,uuid,text),public.commerce_create_polygon_usdc_intent(uuid,uuid,uuid,text,jsonb),public.commerce_finish_polygon_usdc_payment(uuid,text,jsonb),public.commerce_release_polygon_usdc_intent(uuid,text,bigint,bigint,boolean) from public,anon,authenticated;
grant execute on function public.commerce_request_polygon_usdc_cancellation(uuid,uuid,text),public.commerce_create_polygon_usdc_intent(uuid,uuid,uuid,text,jsonb),public.commerce_finish_polygon_usdc_payment(uuid,text,jsonb),public.commerce_release_polygon_usdc_intent(uuid,text,bigint,bigint,boolean) to service_role;
commit;
