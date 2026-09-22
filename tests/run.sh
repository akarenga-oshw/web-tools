#!/usr/bin/env bash
# Run tests/index.html in headless Chrome and exit non-zero if anything failed.
#
# The tests need a server because ES modules do not load over file://. This
# starts one on a free port, runs the page, prints the result and cleans up.
#
#   ./tests/run.sh          names of failing cases only
#   ./tests/run.sh -v       every case

set -u
cd "$(dirname "$0")/.."

CHROME=$(command -v google-chrome || command -v chromium-browser || command -v chromium) || {
  echo "no chrome found" >&2; exit 2; }

PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1]);s.close()')
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT

for _ in $(seq 40); do
  python3 -c "import socket,sys;s=socket.socket();sys.exit(s.connect_ex(('127.0.0.1',$PORT)))" && break
  sleep 0.1
done

DOM=$("$CHROME" --headless --disable-gpu --no-sandbox --dump-dom \
      --virtual-time-budget=8000 "http://127.0.0.1:$PORT/tests/" 2>/dev/null)

VERBOSE=${1:-}
DOM="$DOM" VERBOSE="$VERBOSE" python3 - <<'PY'
import os, re, sys, html

dom = os.environ['DOM']
strip = lambda s: html.unescape(re.sub(r'<[^>]+>', ' ', s)).strip()

m = re.search(r'<div id="summary" class="(pass|fail)">(.*?)</div>', dom, re.S)
if not m:
    # The page only sets that class once every group has run. Without it the
    # script died early - a bad import, a syntax error - and the page still
    # renders, with no failing case on it. Looking only for the word failed
    # would read that as a pass.
    where = re.search(r'<div id="summary"[^>]*>(.*?)</div>', dom, re.S)
    print('the test page did not finish: ' + (strip(where.group(1)) if where else 'no summary'),
          file=sys.stderr)
    sys.exit(2)

for g in re.finditer(r'<h2>(.*?)</h2>|<div class="case (ok|bad)">(.*?)</div>', dom, re.S):
    if g.group(1):
        if os.environ['VERBOSE'] in ('-v', '--verbose'):
            print('\n' + strip(g.group(1)))
    elif g.group(2) == 'bad':
        print('  FAIL  ' + strip(g.group(3)))
    elif os.environ['VERBOSE'] in ('-v', '--verbose'):
        print('  ok    ' + strip(g.group(3)))

summary = strip(m.group(2))
print(('\n' if os.environ['VERBOSE'] in ('-v', '--verbose') else '') + summary)
sys.exit(1 if 'failed' in summary else 0)
PY
