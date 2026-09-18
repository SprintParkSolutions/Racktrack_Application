#!/usr/bin/env bash
# One deploy of the RackTrack demo: the application, RackTrack Approvals and
# the host configuration. Run it from the repository root.
#
#   deploy/deploy-demo.sh            the application and Approvals
#   deploy/deploy-demo.sh approvals  only the Approvals bundle and Caddy
#
# It never touches server/data on the host, so the plans, the database and the
# scans stay where they are.
set -euo pipefail
HOST=root@82.29.164.213
KEY=~/.ssh/racktrack_demo
SSH="ssh -i $KEY $HOST"
DIR=/opt/racktrack-demo
APPROVALS=/Volumes/Racktrack/racktrack_approvals
ONLY=${1:-all}

say() { printf '\n== %s\n' "$1"; }

say "RackTrack Approvals: build"
( cd "$APPROVALS" && VITE_BASE=/approvals/ npm run build >/dev/null && echo "built $(ls dist/assets | wc -l | tr -d ' ') asset files" )

say "RackTrack Approvals: send the bundle"
$SSH "mkdir -p $DIR/approvals-dist"
rsync -az --delete -e "ssh -i $KEY" "$APPROVALS/dist/" "$HOST:$DIR/approvals-dist/"

say "Host configuration"
rsync -az -e "ssh -i $KEY" deploy/caddy/Caddyfile docker-compose.demo.yml "$HOST:$DIR/" --no-relative
$SSH "cd $DIR && docker run --rm -v $DIR/deploy/caddy/Caddyfile:/tmp/C:ro caddy:2-alpine caddy validate --config /tmp/C --adapter caddyfile 2>&1 | grep -E 'Valid|error' | tail -1"

if [ "$ONLY" != "approvals" ]; then
  say "Application: send the code"
  rsync -az --exclude-from=deploy/demo-rsync-excludes.txt -e "ssh -i $KEY" ./ "$HOST:$DIR/"
  say "Application: build and restart"
  # `&&`, not `;`. With a semicolon the ssh exit status is tail's, which always
  # succeeds, so `set -e` could not see a failed build and the script went on to
  # report a healthy deploy that had never been built.
  $SSH "cd $DIR && docker compose -f docker-compose.demo.yml up -d --build racktrack > /tmp/demo-build.log 2>&1 && tail -2 /tmp/demo-build.log"
  # And prove the new code is actually in the container. config.json is COPYed
  # into the image rather than mounted, so a deploy that rsynced but did not
  # rebuild leaves the container on the old models while the host tree looks
  # right - which is exactly what a half finished deploy looked like once.
  say "Application: confirm the container has the new configuration"
  $SSH "docker exec racktrack-demo grep -o '\"ports_typed\": \"[^\"]*\"' /app/config.json"
fi

say "Caddy: pick up the new configuration and the Approvals mount"
$SSH "cd $DIR && docker compose -f docker-compose.demo.yml up -d caddy 2>&1 | tail -2"

say "Check"
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://demo.racktrack.ai/api/version || true)
  [ "$code" = "200" ] && break
  sleep 4
done
printf 'application  %s\n' "$(curl -s --max-time 5 https://demo.racktrack.ai/api/version)"
printf 'approvals    %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://demo.racktrack.ai/approvals/)"
printf 'portal       %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://portal.racktrack.ai/)"
