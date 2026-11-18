#!/usr/bin/env bash
# Flugradar – Kiosk-Einrichtung wieder entfernen (Programmdateien und Daten im Flugradar-Ordner bleiben erhalten)
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo starten: sudo $0"; exit 1; }

for svc in flugradar-display flugradar-kiosk flugradar-server; do
  systemctl disable --now "$svc.service" 2>/dev/null || true
  rm -f "/etc/systemd/system/$svc.service"
done
rm -f /usr/local/bin/flugradar-browser /usr/local/bin/flugradar-display /etc/flugradar-kiosk.conf /etc/pam.d/flugradar-kiosk
systemctl daemon-reload

echo "Kiosk entfernt. Die installierten Pakete (cage, chromium, nodejs …) bleiben erhalten."
echo "Falls vorher ein Desktop lief, wieder einschalten mit: sudo systemctl enable lightdm && sudo systemctl set-default graphical.target"
