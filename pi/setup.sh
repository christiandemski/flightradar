#!/usr/bin/env bash
# =============================================================================
#  Flugradar – Kiosk-Einrichtung für den Raspberry Pi
#
#  Macht aus einem frischen Raspberry Pi OS (Lite empfohlen) ein Flugradar-Gerät:
#  Strom an → Flugradar im Vollbild. Optional läuft der Server gleich mit auf dem Pi.
#
#  Aufruf (im Flugradar-Ordner auf dem Pi):
#     sudo ./pi/setup.sh                      # fragt alles ab
#     sudo ./pi/setup.sh --server --screen wohnzimmer --rotate 0 -y
#     sudo ./pi/setup.sh --no-server --url https://flightradar.codekorb.de/s/wohnzimmer -y
#
#  Optionen:
#     --server / --no-server   Flugradar-Server auf diesem Pi installieren (Standard: ja)
#     --screen NAME            anzuzeigender Bildschirm (Adresse /s/NAME); leer = erster Bildschirm
#     --url URL                komplette Bildschirm-Adresse (z. B. auf einem anderen Server)
#     --rotate 0|90|180|270    Bildschirm drehen
#     --no-display-control     Display nachts nicht ausschalten (nur abdunkeln)
#     --user NAME              Benutzer, unter dem alles läuft (Standard: der sudo-Aufrufer)
#     -y                       keine Rückfragen
# =============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER=""
SCREEN=""
URL=""
ROTATE=""
DISPLAY_CONTROL=1
KUSER="${SUDO_USER:-}"
ASSUME_YES=0

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mFehler: %s\033[0m\n' "$*" >&2; exit 1; }
ask()  { # ask "Frage" "Standard" → Antwort
  local a
  if [ "$ASSUME_YES" = 1 ] || [ ! -t 0 ]; then echo "$2"; return; fi
  read -r -p "$1 [$2]: " a
  echo "${a:-$2}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER=1 ;;
    --no-server) SERVER=0 ;;
    --screen) SCREEN="${2:-}"; shift ;;
    --url) URL="${2:-}"; shift ;;
    --rotate) ROTATE="${2:-}"; shift ;;
    --no-display-control) DISPLAY_CONTROL=0 ;;
    --user) KUSER="${2:-}"; shift ;;
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) die "Unbekannte Option: $1 (Hilfe: --help)" ;;
  esac
  shift
done

[ "$(id -u)" -eq 0 ] || die "Bitte mit sudo starten: sudo $0"
[ -n "$KUSER" ] && [ "$KUSER" != root ] || die "Benutzer unbekannt – bitte per sudo als normaler Benutzer starten oder --user NAME angeben."
id "$KUSER" >/dev/null 2>&1 || die "Benutzer '$KUSER' gibt es nicht."
[ -f "$APP_DIR/server/index.js" ] || die "Flugradar-Dateien nicht gefunden in $APP_DIR"
command -v apt-get >/dev/null || die "Dieses Skript ist für Raspberry Pi OS / Debian gedacht."
KHOME="$(getent passwd "$KUSER" | cut -d: -f6)"
KUID="$(id -u "$KUSER")"

# ---------- Fragen ----------
if [ -z "$URL" ]; then
  [ -n "$SERVER" ] || { a="$(ask "Flugradar-Server auf diesem Pi installieren? (j/n)" "j")"; [[ "$a" =~ ^[jJyY] ]] && SERVER=1 || SERVER=0; }
  if [ "$SERVER" = 1 ]; then
    [ -n "$SCREEN" ] || SCREEN="$(ask "Welcher Bildschirm soll angezeigt werden? (Name aus /s/NAME, leer = erster)" "")"
    URL="http://localhost:8080/s/${SCREEN}"
  else
    URL="$(ask "Adresse des Bildschirms (z. B. http://mein-pc:8080/s/wohnzimmer)" "")"
    [ -n "$URL" ] || die "Ohne eigenen Server wird die Adresse eines Flugradar-Servers benötigt (--url)."
  fi
else
  SERVER="${SERVER:-0}"
fi
[ -n "$ROTATE" ] || ROTATE="$(ask "Bildschirm drehen? (0, 90, 180, 270)" "0")"
[[ "$ROTATE" =~ ^(0|90|180|270)$ ]] || die "Drehung muss 0, 90, 180 oder 270 sein."

say "Einstellungen"
echo "  Benutzer:         $KUSER"
echo "  Server auf dem Pi: $([ "$SERVER" = 1 ] && echo "ja ($APP_DIR)" || echo nein)"
echo "  Anzeige:          $URL"
echo "  Drehung:          $ROTATE°"
echo "  Display nachts aus: $([ "$DISPLAY_CONTROL" = 1 ] && echo "möglich (in der Verwaltung einstellen)" || echo nein)"

# ---------- Pakete ----------
say "Pakete installieren (dauert ein paar Minuten)"
export DEBIAN_FRONTEND=noninteractive
apt-get update
CHROMIUM_PKG=chromium
if apt-cache policy chromium-browser 2>/dev/null | grep -q 'Candidate: [0-9]'; then CHROMIUM_PKG=chromium-browser; fi
PKGS=(cage wlr-randr curl ca-certificates python3 fonts-noto-color-emoji "$CHROMIUM_PKG")
[ "$SERVER" = 1 ] && PKGS+=(nodejs)
apt-get install -y --no-install-recommends "${PKGS[@]}"

if [ "$SERVER" = 1 ]; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$NODE_MAJOR" -lt 20 ]; then
    die "Node.js $NODE_MAJOR ist zu alt (mind. 20 nötig). Aktuelles Raspberry Pi OS (Trixie) verwenden oder Node.js 20+ von nodejs.org installieren und das Skript erneut starten."
  fi
fi

# ---------- Dateien ----------
say "Kiosk einrichten"
install -m 755 "$APP_DIR/pi/flugradar-browser.sh" /usr/local/bin/flugradar-browser
install -m 755 "$APP_DIR/pi/flugradar-display.py" /usr/local/bin/flugradar-display

cat > /etc/flugradar-kiosk.conf <<EOF
# Flugradar-Kiosk – nach Änderungen: sudo systemctl restart flugradar-kiosk
FLUGRADAR_URL=$URL
FLUGRADAR_ROTATE=$ROTATE
EOF

# PAM-Profil, damit cage eine richtige Sitzung (Grafik, Eingabe, Ton) bekommt
cat > /etc/pam.d/flugradar-kiosk <<'EOF'
auth     required pam_unix.so nullok
account  required pam_unix.so
session  required pam_unix.so
session  required pam_systemd.so
EOF

for grp in video render input audio; do
  getent group "$grp" >/dev/null && usermod -aG "$grp" "$KUSER"
done

# ---------- Dienste ----------
if [ "$SERVER" = 1 ]; then
  chown -R "$KUSER": "$APP_DIR"
  cat > /etc/systemd/system/flugradar-server.service <<EOF
[Unit]
Description=Flugradar-Server
After=network-online.target
Wants=network-online.target

[Service]
User=$KUSER
WorkingDirectory=$APP_DIR
EnvironmentFile=-$APP_DIR/.env
ExecStart=$(command -v node) server/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
fi

cat > /etc/systemd/system/flugradar-kiosk.service <<EOF
[Unit]
Description=Flugradar-Kiosk (Chromium im Vollbild)
After=systemd-user-sessions.service network-online.target $([ "$SERVER" = 1 ] && echo flugradar-server.service)
Wants=network-online.target
Conflicts=getty@tty1.service
After=getty@tty1.service

[Service]
User=$KUSER
PAMName=flugradar-kiosk
WorkingDirectory=$KHOME
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes
StandardInput=tty-fail
StandardOutput=journal
StandardError=journal
UtmpIdentifier=tty1
UtmpMode=user
ExecStart=/usr/bin/cage -s -- /usr/local/bin/flugradar-browser
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

if [ "$DISPLAY_CONTROL" = 1 ]; then
  cat > /etc/systemd/system/flugradar-display.service <<EOF
[Unit]
Description=Flugradar – Display nachts aus- und morgens einschalten
After=flugradar-kiosk.service

[Service]
User=$KUSER
Environment=XDG_RUNTIME_DIR=/run/user/$KUID
ExecStart=/usr/bin/python3 /usr/local/bin/flugradar-display
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
EOF
fi

# Desktop-Anmeldung (falls Desktop-Image) abschalten – der Kiosk übernimmt den Bildschirm
for dm in lightdm gdm3 sddm; do
  if systemctl is-enabled "$dm" >/dev/null 2>&1; then
    warn "Desktop-Anmeldung ($dm) wird deaktiviert – rückgängig mit: sudo systemctl enable $dm"
    systemctl disable "$dm"
  fi
done

systemctl daemon-reload
[ "$SERVER" = 1 ] && systemctl enable flugradar-server.service
systemctl enable flugradar-kiosk.service
[ "$DISPLAY_CONTROL" = 1 ] && systemctl enable flugradar-display.service
systemctl set-default multi-user.target >/dev/null

# ---------- Fertig ----------
HOST="$(hostname)"
say "Fertig!"
echo "  Nach dem Neustart zeigt der Pi das Flugradar im Vollbild."
if [ "$SERVER" = 1 ]; then
  echo "  Verwaltung (von einem anderen Gerät im WLAN):  http://$HOST.local:8080/"
  echo "  Tipp: vorher ADMIN_PASSWORD in $APP_DIR/.env setzen, wenn andere im Netz sind."
fi
echo "  Display nachts ausschalten: in der Verwaltung → Nachtmodus → \"Display ausschalten (Pi-Kiosk)\""
echo "  Protokolle: journalctl -u flugradar-kiosk -u flugradar-server -u flugradar-display -f"
echo "  Entfernen:  sudo $APP_DIR/pi/uninstall.sh"
a="$(ask "Jetzt neu starten? (j/n)" "j")"
[[ "$a" =~ ^[jJyY] ]] && reboot || echo "  Neustart später mit: sudo reboot"
