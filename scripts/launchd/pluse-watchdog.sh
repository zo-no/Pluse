#!/bin/zsh
set -u

LABEL="com.pluse.server"
DOMAIN="gui/$(/usr/bin/id -u)"
HEALTH_URL="http://127.0.0.1:7760/health"
LOG_PATH="/Users/kualshown/.pluse/runtime/pluse-watchdog.log"
WORKDIR="/Users/kualshown/Desktop/pulse"

timestamp() {
  /bin/date -u +"%Y-%m-%dT%H:%M:%SZ"
}

log() {
  /bin/mkdir -p "$(/usr/bin/dirname "$LOG_PATH")"
  printf "[%s] %s\n" "$(timestamp)" "$*" >> "$LOG_PATH"
}

healthy() {
  /usr/bin/curl -fsS --max-time 5 "$HEALTH_URL" | /usr/bin/grep -q '"service":"pluse"'
}

kickstart() {
  /bin/launchctl kickstart -k "$DOMAIN/$LABEL" >> "$LOG_PATH" 2>&1
}

kill_pulse_listeners() {
  local pids pid cwd
  pids=$(/usr/sbin/lsof -tiTCP:7760 -sTCP:LISTEN 2>/dev/null || true)
  for pid in ${(f)pids}; do
    [ -n "$pid" ] || continue
    cwd=$(/usr/sbin/lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | /usr/bin/sed -n 's/^n//p' | /usr/bin/head -1)
    case "$cwd" in
      "$WORKDIR"*)
        log "killing unhealthy Pluse listener pid=$pid cwd=$cwd"
        /bin/kill "$pid" 2>/dev/null || true
        ;;
      *)
        log "port 7760 is held by pid=$pid cwd=$cwd; not killing non-Pluse process"
        ;;
    esac
  done
}

if healthy; then
  exit 0
fi

log "health check failed; kickstarting $LABEL"
kickstart || log "kickstart failed"

/bin/sleep 8
if healthy; then
  log "service recovered after kickstart"
  exit 0
fi

kill_pulse_listeners
kickstart || log "second kickstart failed"
