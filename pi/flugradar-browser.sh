#!/bin/bash
# Flugradar – startet Chromium im Kiosk-Modus. Läuft innerhalb des Kiosk-Compositors "cage".
# Einstellungen: /etc/flugradar-kiosk.conf (wird von setup.sh angelegt)
set -u

CONF=/etc/flugradar-kiosk.conf
[ -r "$CONF" ] && . "$CONF"
URL="${FLUGRADAR_URL:-http://localhost:8080/s/}"
ROTATE="${FLUGRADAR_ROTATE:-0}"
PROFILE="$HOME/.config/flugradar-chromium"
BROWSER="$(command -v chromium-browser || command -v chromium)"

# Bildschirm drehen (0, 90, 180, 270)
if [ "$ROTATE" != "0" ] && command -v wlr-randr >/dev/null; then
  for out in $(wlr-randr | awk '/^[^ ]/ {print $1}'); do
    wlr-randr --output "$out" --transform "$ROTATE" || true
  done
fi

# Warten, bis der Flugradar-Server antwortet (max. 3 Minuten) – sonst zeigt Chromium nur eine Fehlerseite
for _ in $(seq 1 90); do
  curl -s -o /dev/null --max-time 3 "$URL" && break
  sleep 2
done

# Nach Stromausfall keinen "Chromium wurde nicht korrekt beendet"-Hinweis zeigen
PREFS="$PROFILE/Default/Preferences"
if [ -f "$PREFS" ]; then
  sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$PREFS"
fi

exec "$BROWSER" \
  --kiosk "$URL" \
  --user-data-dir="$PROFILE" \
  --ozone-platform=wayland \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --disable-session-crashed-bubble \
  --disable-features=Translate,TranslateUI,MediaRouter \
  --password-store=basic \
  --autoplay-policy=no-user-gesture-required \
  --check-for-update-interval=31536000 \
  --overscroll-history-navigation=0 \
  --disable-pinch
