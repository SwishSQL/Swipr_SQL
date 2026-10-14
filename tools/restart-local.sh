#!/bin/bash
# LOCAL TEST helper: restart the SQL Server edition on :3411 (kills whatever listens there)
for p in $(netstat -ano | grep ":3411 " | grep LISTENING | awk '{print $5}' | sort -u); do taskkill //PID $p //F >/dev/null 2>&1; done
sleep 2
cd "$(dirname "$0")/.."
PORT=3411 nohup node server.js > _boot.log 2> _boot.err &
sleep 12
curl -s -m 5 localhost:3411/api/health; echo
tail -5 _boot.log
