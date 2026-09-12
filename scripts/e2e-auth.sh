#!/bin/bash
set -e
B=http://localhost:3001
J=/tmp/e2e-cookies.txt
rm -f $J
echo "== 1. register =="
curl -s -m 15 -c $J -X POST $B/api/auth/register -H 'Content-Type: application/json' -H 'Origin: http://localhost:3001' \
  -d '{"email":"tester@myblogs.local","password":"Passw0rd123","username":"tester","displayName":"测试者","agree":true}'
echo; echo "== 2. read verify token from DB (simulates email link) =="
TOKEN=$(docker exec myblogs-postgres psql -U blog -d myblogs -t -A -c "select 1")
VERIFY=$(docker exec myblogs-postgres psql -U blog -d myblogs -t -A -c \
  "select substr(token_hash,1,8) from auth_tokens where type='email_verify' and used_at is null order by created_at desc limit 1")
# real link uses plaintext token; we can't reverse hash — use resend + capture via mailpit instead
echo "token_hash_prefix=$VERIFY (plaintext unknowable; check mailpit API)"
curl -s -m 10 "http://localhost:8025/api/v1/messages?limit=3" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for m in d.get('messages',[]):
    print('mail:', m['Subject'], '->', m['To']['Address'])
" 2>/dev/null || echo "(mailpit not reachable — SMTP dev catcher not started)"
