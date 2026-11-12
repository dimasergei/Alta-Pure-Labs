"""Run only against the disposable, loopback PostgreSQL fixture database."""
import concurrent.futures
import json
import os
import pathlib
import re
import subprocess

if os.environ.get('RAMPEX_DISPOSABLE_TEST') != 'true':
    raise SystemExit('Set RAMPEX_DISPOSABLE_TEST=true for an isolated local fixture database only.')
port = os.environ.get('RAMPEX_TEST_PORT', '55432')
if not port.isdigit():
    raise SystemExit('Invalid local port')
command = ['psql', '-X', '-q', '-t', '-A', '-h', '127.0.0.1', '-p', port,
           '-U', 'postgres', '-d', 'rampex_test', '-v', 'ON_ERROR_STOP=1']
def query(sql):
    result = subprocess.run(command, input=sql, text=True, capture_output=True, check=True, timeout=20)
    return result.stdout.strip(), result.stderr

# Use the exact tested invoice setup, stopping before it begins/settles an attempt.
fixture = pathlib.Path('tests/fixtures/rampex-checks.sql').read_text()
setup = fixture[fixture.index('set role service_role;'):fixture.index(' r:=public.commerce_begin_rampex_attempt(a,i,u,tag);')]
setup += "\n raise notice 'RAMPEX_RACE_CONTEXT:%',json_build_object('invoice',i,'customer',u,'tag',tag);\nend $$;"
_, stderr = query(setup)
context = json.loads(re.search(r'RAMPEX_RACE_CONTEXT:(\{[^\n]+\})', stderr).group(1))
for key in ('invoice', 'customer'):
    assert re.fullmatch('[a-f0-9-]{36}', context[key])
assert re.fullmatch('[a-f0-9]{64}', context['tag'])

def start(_):
    sql = "set role service_role; select public.commerce_begin_rampex_attempt(gen_random_uuid(),'%s','%s','%s');" % (context['invoice'], context['customer'], context['tag'])
    return json.loads(query(sql)[0])
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    starts = list(pool.map(start, range(8)))
assert sum(row['claimed'] is True for row in starts) == 1, starts
ids = {row['id'] for row in starts}
assert len(ids) == 1, starts
attempt = ids.pop()
link = 'race-' + attempt
tx = '0x' + context['invoice'].replace('-', '') * 2
query("set role service_role; select public.commerce_bind_rampex_link('%s','%s','https://checkout.rampex.io/pay/%s','%s');" % (attempt,link,link,context['tag']))
def complete(_):
    sql = "set role service_role; select public.commerce_finish_rampex_payment('%s','%s','%s','%s',4900,4900,'USD');" % (attempt,link,context['tag'],tx)
    return json.loads(query(sql)[0])
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    finishes = list(pool.map(complete, range(8)))
assert sum(row['newly_paid'] is True for row in finishes) == 1, finishes
assert all(row['state'] == 'paid' for row in finishes), finishes
count = query("select count(*) from public.commerce_gateway_events where attempt_id='%s' and outcome='approved';" % attempt)[0]
assert count == '1', count
print('PASS: eight concurrent start requests produced one attempt; eight concurrent confirmations produced one paid transition and one approval event.')
