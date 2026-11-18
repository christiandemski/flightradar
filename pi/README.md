# Flugradar auf dem Raspberry Pi (Kiosk)

Nach der Einrichtung gilt: Strom an, dann zeigt der Pi das Flugradar im Vollbild. Tastatur, Maus und Desktop braucht es danach nicht mehr.
Der Pi kann den Flugradar-Server selbst mitbetreiben oder nur die Seite eines anderen Servers anzeigen (z. B. später `flightradar.codekorb.de`).

## Was du brauchst

* Raspberry Pi 4 oder 5 (Zero 2 W geht auch, ist aber knapp bemessen)
* microSD-Karte (ab 16 GB) und passendes Netzteil
* Display per HDMI (bei Pi 4/5: Micro-HDMI-Kabel bzw. -Adapter)

## 1. SD-Karte vorbereiten

1. **Raspberry Pi Imager** auf dem PC installieren (raspberrypi.com/software).
2. Als Betriebssystem **Raspberry Pi OS Lite (64-bit)** wählen, unter „Raspberry Pi OS (other)“.
3. In den Einstellungen (Zahnrad bzw. „Einstellungen bearbeiten“) festlegen:
   * Hostname, z. B. `flugradar`
   * Benutzername und Passwort
   * WLAN (Name und Passwort) sowie Land `DE`
   * Zeitzone `Europe/Berlin` und Tastaturlayout `de`
   * Reiter „Dienste“: **SSH aktivieren**
4. Auf die Karte schreiben, die Karte in den Pi stecken und einschalten. Der erste Start dauert 1–2 Minuten.

## 2. Flugradar auf den Pi kopieren

Vom PC aus, in der Eingabeaufforderung oder PowerShell, im Ordner über `flightradar`:

```bash
scp -r flightradar BENUTZER@flugradar.local:~/
```

Den Unterordner `data/` musst du nicht mitkopieren. Willst du deine bisherigen Bildschirme übernehmen, kopierst du ihn mit.

## 3. Einrichten

```bash
ssh BENUTZER@flugradar.local
cd ~/flightradar
chmod +x pi/*.sh
sudo ./pi/setup.sh
```

Das Skript fragt drei Dinge:

* **Server auf diesem Pi?** Mit „j“ läuft alles auf dem Pi. Mit „n“ zeigt der Pi nur die Seite eines anderen Flugradar-Servers an.
* **Welcher Bildschirm?** Hier gibst du den Namen aus der Adresse `/s/NAME` an. Leer lassen zeigt den ersten Bildschirm.
* **Drehung:** 0, 90, 180 oder 270 Grad, z. B. für ein hochkant montiertes Display.

Danach startet der Pi neu und zeigt das Flugradar.

Ohne Rückfragen geht es z. B. so:

```bash
sudo ./pi/setup.sh --server --screen wohnzimmer -y
sudo ./pi/setup.sh --no-server --url https://flightradar.codekorb.de/s/wohnzimmer -y
```

## Verwaltung

Läuft der Server auf dem Pi, öffnest du die Verwaltung von jedem Gerät im WLAN: **http://flugradar.local:8080/admin**.
Alles, was du dort einstellst, übernimmt der Pi automatisch.

* **Display nachts ausschalten:** Nachtmodus → „Display ausschalten (Pi-Kiosk)“ wählen und die Uhrzeiten setzen. Der Pi schaltet den HDMI-Ausgang aus und morgens wieder ein. Ein Dienst prüft das jede Minute.
  Ein Überflug-Alarm kann ein ausgeschaltetes Display nicht wecken. Dafür ist der Modus „abdunkeln“ gedacht.
* **Ton für den Überflug-Alarm:** Der Kiosk erlaubt Ton ohne vorherigen Klick. Der Ton kommt über HDMI, wenn das Display Lautsprecher hat, sonst über den Klinkenausgang (Pi 4).
* **Passwort für die Verwaltung:** In `~/flightradar/.env` die Zeile `ADMIN_PASSWORD=…` eintragen, dann `sudo systemctl restart flugradar-server`.

## Nützliche Befehle

| Was | Befehl |
|---|---|
| Protokolle ansehen | `journalctl -u flugradar-kiosk -u flugradar-server -u flugradar-display -f` |
| Anzeige neu starten | `sudo systemctl restart flugradar-kiosk` |
| Andere Adresse/Drehung | `/etc/flugradar-kiosk.conf` bearbeiten, dann Anzeige neu starten |
| Server neu starten (nach Update) | `sudo systemctl restart flugradar-server` |
| Kiosk entfernen | `sudo ./pi/uninstall.sh` |

**Update:** Den Ordner erneut per `scp` kopieren (ohne `data/`), dann `sudo systemctl restart flugradar-server flugradar-kiosk` ausführen.

## Wie es funktioniert

| Teil | Aufgabe |
|---|---|
| `flugradar-server.service` | Node.js-Server, startet beim Booten (optional) |
| `flugradar-kiosk.service` | schlanker Kiosk-Compositor **cage** auf dem Bildschirm, darin **Chromium** im Vollbild; bei Absturz automatischer Neustart |
| `flugradar-browser` | wartet, bis der Server antwortet, unterdrückt Absturz-Hinweise, dreht den Bildschirm |
| `flugradar-display.service` | liest den Nachtmodus aus der Verwaltung und schaltet das Display per `wlr-randr` aus und ein |

Läuft auf dem Pi die Desktop-Version, deaktiviert das Skript die Desktop-Anmeldung, weil der Kiosk den Bildschirm übernimmt. `uninstall.sh` erklärt, wie du das rückgängig machst.

> Hinweis: Das Skript ist für Raspberry Pi OS (Bookworm/Trixie) geschrieben, aber noch nicht auf echter Hardware getestet. Läuft etwas nicht, zeigen die Protokolle (siehe oben) meist direkt, woran es liegt.
