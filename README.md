# Flugradar

Zwei Teile, ein Server (Node.js ohne Abhängigkeiten):

1. **Live-Karte** (`/`): Flugradar zum Selbst-Erkunden, ähnlich wie Flightradar24 oder RadarBox. Die Karte ist frei beweglich, Flugzeuge lassen sich anklicken, die Suche findet Flüge und Flughäfen, Karten und Ebenen sind umschaltbar.
2. **Bildschirme** (`/s/<name>`, verwaltet unter `/admin`): feste Anzeigen für einen Standort, z. B. ein Pi mit Monitor im Bilderrahmen oder ein Tablet. Ansicht und Design wählst du pro Bildschirm.

## Starten

```bash
npm start          # http://localhost:8080/
npm run dev        # mit Auto-Neustart bei Code-Änderungen
```

* **Live-Karte:** `http://localhost:8080/`
* **Verwaltung:** `http://localhost:8080/admin`. Dort legst du Bildschirme an (Name, PLZ/Ort/Koordinaten, Umkreis, Ansicht, Design, Filter, Nachtmodus).
* **Bildschirm:** `http://localhost:8080/s/<id>` (z. B. `/s/wohnzimmer`). Diese Adresse öffnest du im Kiosk-Browser.
  * Tasten: `1` Radar · `2` Karte · `3` Info · `4` Tafel · `5` Himmelsblick · `0` wie konfiguriert · `F` Vollbild · `A` Test-Alarm
  * Ein Klick auf die Kopfzeile wechselt zur nächsten Ansicht, ein Doppelklick schaltet Vollbild.
  * Änderungen in der Verwaltung übernimmt der Bildschirm automatisch, ohne Neuladen.

## Live-Karte

* **Flugzeuge anklicken:** Das Panel zeigt Foto, Airline mit Logo, Route mit Fortschritt und Restflugzeit sowie Typ, Kennzeichen und Halter. Dazu kommen Höhe (barometrisch, GPS, eingestellte Zielhöhe), Geschwindigkeiten (Grund, TAS/IAS, Mach), Wind und Außentemperatur (soweit gesendet), Squawk, Signalart, Datenquellen und ein Höhen-/Geschwindigkeitsprofil. Die Spur reicht bis zu 60 Minuten zurück, ab dem Zeitpunkt, an dem der Server das Flugzeug zum ersten Mal sieht.
* **Folgen:** Die Karte wandert mit dem Flugzeug mit.
* **Favoriten** (★ oben rechts): Flugnummern, Rufzeichen oder Kennzeichen mit Notiz speichern, z. B. „LH 400 – Anna nach New York“, oder im Detail-Panel mit „☆ Merken“. Die Liste zeigt, wer gerade fliegt (weltweit, nicht nur im Ausschnitt), ein Klick springt zum Flug. Auf der Karte haben Favoriten einen goldenen Ring und sind immer beschriftet. „Nur Favoriten“ blendet alles andere aus. Gespeichert wird im Browser.
* **Teilen:** „↗ Teilen“ erzeugt einen Direktlink wie `/f/LH400` (auf dem Handy über das Teilen-Menü). Ist der Flug noch nicht in der Luft, zeigt die Seite das an und wählt ihn automatisch aus, sobald er startet. Flugzeuge ohne Rufzeichen und Kennzeichen (z. B. FLARM) bekommen einen Link `/#ac=<id>`.
* **Suche** (Taste `/`): Flugnummer (`LH 400`, `FR1234`), Rufzeichen (`DLH400`), Kennzeichen (`D-AIXA` oder `DAIXA`), ICAO-Hex, Typ (`A388`) und Flughäfen (Name, Stadt, IATA/ICAO). Flugzeuge außerhalb des Ausschnitts findet die Suche weltweit über adsb.fi.
* **Karten:** Dunkel, Straße, Grau (OpenStreetMap), Gelände (OpenTopoMap), Satellit (Esri)
* **Ebenen:** Flughäfen (OurAirports, Klick zeigt das aktuelle METAR), Regenradar (RainViewer), Tag/Nacht-Grenze, Lufträume (openAIP, nur mit `OPENAIP_KEY`)
* **Filter:** Flugzeugklassen, FLARM, am Boden, nur Militär, nur bei FR24 gesperrte, Höhenbereich. Einheiten metrisch oder Luftfahrt.
* Einstellungen und Kartenausschnitt merkt sich der Browser. Die Ansicht funktioniert auch auf dem Handy.

Die Datenquellen fragen im Umkreis von höchstens 250 NM (ca. 460 km) ab. Ist der Ausschnitt größer, markiert ein gestrichelter Kreis den abgedeckten Bereich. Nutzer mit ähnlichem Ausschnitt teilen sich ein Abfragegebiet, insgesamt höchstens 6 Gebiete gleichzeitig. Abfragen an adsb.fi laufen gedrosselt (höchstens 1 pro Sekunde).

## Bildschirme: Ansichten & Designs

| Ansicht | Inhalt |
|---|---|
| Radar | Radarschirm mit Entfernungsringen, Gradskala, Radarstrahl, Spuren und Höhenfarben, daneben die Liste „In der Nähe“ |
| Karte | OpenStreetMap-Karte mit Flugzeugen und Spuren |
| Info | Nächstes Flugzeug groß: Foto, Airline, Route mit Fortschrittsbalken, Typ, Höhe, „Wo am Himmel?“ (Richtung + Höhenwinkel) |
| Tafel | Abflugtafel mit Klapp-Effekt |
| Himmelsblick | „Was sehe ich aus dem Fenster?“ – waagerecht Himmelsrichtung, senkrecht Höhenwinkel; Himmelsfarbe und Sonne nach echtem Sonnenstand, Größe nach Entfernung. Blickrichtung/Sichtfeld pro Bildschirm |
| Wechsel | Mehrere der obigen Ansichten im Wechsel |

**Airline-Logos** (Option pro Bildschirm): klein in Radar, Karte, Himmelsblick, Listen, Info, Tafel und Alarm. Quellen (der Reihe nach, per ICAO-Code aus dem Callsign): [sexym0nk3y/airline-logos](https://github.com/sexym0nk3y/airline-logos), dann [Jxck-S/airline-logos](https://github.com/Jxck-S/airline-logos) (FlightAware- und RadarBox-Stil); der Server lädt jedes Logo einmal und speichert es unter `data/logos/` (fehlende werden eine Woche lang nicht erneut angefragt). In Phosphor/Amber werden die Logos passend eingefärbt.

Die Adresse (`/s/<slug>`) lässt sich in der Verwaltung ändern; alte Adressen leiten weiter.

## Überflug-Alarm (optional, pro Bildschirm)

Blendet eine Meldung ein (optional mit Gong und Aufheben der Nachtdimmung), wenn innerhalb des Alarm-Umkreises etwas Besonderes vorbeikommt:
Notfall-Squawk (im ganzen Umkreis) · Militär · besondere Typen (A380, 747-8, Beluga, An-124 …) · Hubschrauber tief · FR24-gesperrt · sehr nah · eigene Merkliste (Typen, Kennzeichen, Callsign-Anfänge, Hex).
Jedes Flugzeug meldet sich höchstens einmal pro Pause (Standard 30 min). Antippen schließt die Meldung.
Browser spielen Ton erst nach einer ersten Interaktion – im Pi-Kiosk Chromium mit `--autoplay-policy=no-user-gesture-required` starten.

Designs: **Nacht** (modern, dunkel) · **Phosphor** (grüner Röhrenradar) · **Amber** (Flughafenanzeige) · **Hell**

## Datenquellen – warum mehr als bei Flightradar24 zu sehen ist

| Quelle | Was | Hinweis |
|---|---|---|
| adsb.fi | ADS-B + MLAT, **ungefiltert** | Hauptquelle, alle 5 s |
| adsb.lol | ADS-B + MLAT, **ungefiltert** | 500 Abfragen/Tag → ca. alle 3 min als Ergänzung |
| OGN (live.glidernet.org) | **FLARM**: Segelflieger, UL, Kleinflugzeuge, Hubschrauber | fehlt bei FR24 meist komplett |
| eigener Empfänger (optional) | readsb/tar1090 `aircraft.json` | `READSB_URL` setzen |
| airplanes.live (optional) | ADS-B | blockt derzeit (HTTP 403), per `SOURCES` zuschaltbar |

Alle Quellen werden pro ICAO-Adresse zusammengeführt. Die neueste Position gewinnt, fehlende Felder werden aus den anderen Quellen ergänzt.
FLARM-Dubletten von ADS-B-Flugzeugen entfernt der Server über Kennzeichen bzw. Position und Höhe.

FR24 & Co. blenden Flugzeuge auf **LADD/PIA**-Sperrlisten (Business-Jets, teils Militär/Behörden) aus.
Die Community-Netze oben filtern nicht. Solche Flugzeuge bekommen das Abzeichen „FR24-gesperrt“, Militär das Abzeichen „MIL“.
Was trotzdem fehlen kann: Flugzeuge ganz ohne Positionssender (nur Mode-S/Mode-C, ohne MLAT-Abdeckung).
Dagegen hilft ein **eigener Empfänger** (RTL-SDR-Stick + 1090-MHz-Antenne am Pi, `readsb`) und optional ein OGN-Empfänger (868 MHz).

Stammdaten/Route: adsbdb.com · Fotos: adsbdb (airport-data.com) oder planespotters.net (`PHOTO_CONTACT` setzen) · Wetter: Open-Meteo · Geocoding: OpenStreetMap Nominatim · Flughäfen: OurAirports (gemeinfrei, monatlich nach `data/airports.json` geladen) · METAR: aviationweather.gov

## Konfiguration (`.env`, siehe `.env.example`)

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | 8080 | Port |
| `HOST` | 0.0.0.0 | Bind-Adresse |
| `DATA_DIR` | ./data | Bildschirme (`screens.json`) und Tagesstatistik |
| `SOURCES` | adsbfi,adsblol,ogn | aktive Quellen |
| `READSB_URL` | – | eigener Empfänger, z. B. `http://raspberrypi.local/tar1090/data/aircraft.json` |
| `PHOTO_CONTACT` | – | Kontakt-URL/E-Mail für den planespotters-User-Agent (deren Bedingung) |
| `LOGO_URLS` | 3 GitHub-Sammlungen | Logo-Quellen, kommagetrennt, der Reihe nach probiert; `{icao}` wird ersetzt; müssen für Unbekannte 404 liefern |
| `ADMIN_PASSWORD` | – | schützt Verwaltung (`/admin`) und Schreib-APIs per Basic-Auth. **Setzen, bevor es ins Internet geht.** |
| `PUBLIC_MAP` | 1 | `0` = auch die Live-Karte braucht das Passwort |
| `OPENAIP_KEY` | – | kostenloser Schlüssel von openaip.net für die Luftraum-Ebene |

## Raspberry Pi als Flugradar-Gerät (optional)

Mit `pi/setup.sh` wird ein Raspberry Pi zum Kiosk: Er startet direkt ins Flugradar im Vollbild, optional mit dem Server auf dem Pi. In der Verwaltung lässt sich dann auch „Display nachts ausschalten“ wählen. Anleitung: [pi/README.md](pi/README.md).

## Später: flightradar.codekorb.de

Den Server hinter einen Reverse-Proxy (Caddy/nginx) stellen und `ADMIN_PASSWORD` setzen.
Live-Karte und Bildschirm-URLs `/s/<id>` bleiben öffentlich, die Verwaltung ist dann geschützt.
Soll die Live-Karte nicht öffentlich sein (jeder Besucher löst Abfragen bei den Datenquellen aus), zusätzlich `PUBLIC_MAP=0` setzen.
