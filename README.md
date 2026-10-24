# Allgäu Tourenatlas 3D

3D-Karte für Wander-, Berg- und Radtouren im Allgäu, in Tirol, Vorarlberg und am Bodensee.
Gebaut nur aus Open-Source-Software und offenen, kostenlosen Daten. Kein API-Schlüssel, keine laufenden Kosten.

## Die drei Kernbausteine

| Baustein | Rolle | Lizenz |
|---|---|---|
| **MapLibre GL JS 5** | Kartenengine: Vektorkarte, 3D-Gelände, Neigen/Drehen | BSD-3 (liegt in `vendor/`, kein CDN nötig) |
| **OpenFreeMap** | Online-Grundkarte (Stil „Liberty“): Orte, Strassen, Wege, Wald, Fels, Gipfel | Daten ODbL, Dienst kostenlos |
| **Protomaps / PMTiles** | Offline-Grundkarte aus einer einzigen Datei, kein Server nötig | Software BSD-3, Daten ODbL |

Ergänzende offene Daten:

| Quelle | Wofür | Lizenz |
|---|---|---|
| Terrain Tiles (AWS Open Data; im Allgäu EU-DEM/Copernicus) | 3D-Gelände, Schummerung, Höhenprofile, Gipfel-Check | offen, Namensnennung |
| OpenStreetMap live über Overpass | alle Wege mit SAC-Skala, Sichtbarkeit, Seilbahnen/Lifte, Hütten, Gipfel | ODbL |
| Open-Meteo (DWD ICON) | Wetter-Paket: Punktvorhersage | CC BY 4.0, nicht-kommerziell frei |
| Nominatim | Ortssuche | ODbL, Nutzungsregeln: max. 1 Anfrage/s |
| BRouter (brouter.de) | Touren-Routing auf Wegen | Software MIT, Daten ODbL |
| Luftbild Bayern DOP40 (Bayerische Vermessungsverwaltung) | Luftbild Bayern, 40 cm | CC BY 4.0 |
| basemap.at Orthofoto | Luftbild Österreich, 30 cm | CC BY 4.0 |
| Sentinel-2 cloudless **2016** (EOX) | Luftbild-Fallback, z. B. Baden-Württemberg | CC BY 4.0 (nur Jahrgang 2016; neuere sind nicht-kommerziell) |

Google Maps ist bewusst nicht eingebunden: In der EU seit Juli 2025 keine neuen Satelliten-/3D-Kacheln, Export und Druck sind verboten, und Bergwege fehlen weitgehend.

## Validität: wie die Quellen sich gegenseitig prüfen

Die App korrigiert keine Daten still. Sie zeigt Befunde mit drei Stufen (ok / Hinweis / Warnung) und verlinkt jedes Objekt zur Korrektur in OSM.

1. **Gipfel: OSM-Höhe gegen Höhenmodell.** Verglichen wird `ele` aus OSM mit dem *höchsten* DEM-Wert im Umkreis von 45 m, denn ein Gipfel ist ein lokales Maximum, und so werden Positions- und Rasterversatz abgefangen.
   Kalibriert an echten DEM-Werten:

   | Gipfel | OSM | Δ Punktwert | Δ Umkreis-Max. |
   |---|---|---|---|
   | Zugspitze | 2962 m | +21 m | **+8 bis +10 m** |
   | Hoher Ifen | 2230 m | +34 m | **+20 m** |
   | Hochvogel (spitz) | 2592 m | +115 m | +73 m (Raster kappt die Spitze) |

   Regel: |Δ| ≤ 25 m ist konsistent. 0 < Δ ≤ 80 m ist durch Rasterglättung erklärbar. OSM bis 40 m tiefer als das Gelände gilt als Hinweis. Alles darüber hinaus ist eine Warnung, also wahrscheinlich ein Höhen- oder Positionsfehler.
   *Status: Hypothese auf kleiner Stichprobe. Bei mehr Daten nachjustieren (`VALIDATION` in `js/config.js`).*
2. **Wege: OSM-Attribute gegen Höhenprofil.** Länge, Auf- und Abstieg (Rauschfilter mit 5 m Hysterese) und maximale Steigung über 50 m werden aus dem DEM berechnet. Geprüft werden: fehlende SAC-Skala, `incline` im Vergleich zur DEM-Steigung, T1 bei mehr als 45 % Steigung, schlecht sichtbare Spur und Datenalter über 5 Jahre. Wege kürzer als 3 Rasterzellen bekommen kein Steigungsurteil.
3. **Overpass-Antwort.** Ein Timeout oder Speicherlimit (HTTP 200 mit `remark`) gilt als Fehler, nicht als vollständige Daten. Kaputte Geometrien werden verworfen und gezählt. Der OSM-Datenstand wird angezeigt.
4. **PMTiles-Datei.** Vor dem Einbinden werden Kacheltyp (Vektor), Abdeckung der Region, Zoomtiefe und Schema (Protomaps) geprüft.
5. **Quellenstatus.** Jede Quelle zeigt live „aktiv“ oder „Fehler“ mit Lizenzlink. Die Pflicht-Namensnennungen stehen unten rechts in der Karte.

Bekannte Grenzen:
- **DEM-Auflösung:** Das Höhenmodell hat ca. 30 m Auflösung bei ±7 m vertikalem RMSE. Für Planung reicht das. Felsstufen und Grate unter ca. 30 m Breite bildet es nicht ab.
- **Luftbild Bayern:** Der Ebenenname `by_dop40c` stammt aus der Dokumentation und ist von hier aus nicht live geprüft. Zeigt der Statuspunkt „Fehler“, muss der Name in `js/config.js` angepasst werden.
- **Overpass:** Overpass ist ein öffentlicher Dienst. Die App fragt nur kleine Zellen von etwa 10 km² ab, höchstens zwei gleichzeitig, mit 30 s Zeitlimit und drei Servern zur Ausweichnutzung.

## Bedienung

Unten liegt eine Tab-Leiste. Jeder Tab öffnet ein Blatt mit genau einem Thema, ein zweiter Tipp schliesst es wieder.

| Tab | Inhalt |
|---|---|
| **Karte** | Grundkarte (OpenFreeMap, Luftbild, Offline), Ebenen (3D, Überhöhung, Schummerung, Bergwege, Lifte, Gipfel), Legende |
| **Touren** | Touren-Paket: Touren mit Stationen, Routing, Fotos mit 3D-Blick |
| **Plakat** | Plakat-Paket: Ausschnitt im Papierformat, Export in Druckauflösung |
| **Wetter** | Wetter-Paket: Punktvorhersage, Warnsignale, Regenradar |
| **Info** | Datenqualität des Ausschnitts, alle Quellen mit Status und Lizenz |

- **Ortssuche** oben: Ort, Gipfel oder Hütte eingeben und mit Enter suchen. Koordinaten wie `47.42, 10.34` werden direkt angeflogen.
  Die Suche läuft über Nominatim (OSM), bevorzugt die Region und fragt nur beim Absenden ab, höchstens einmal pro Sekunde, wie es die Nominatim-Regeln verlangen.
- Die Knöpfe **⌂** (zurück ins Allgäu) und **3D** sitzen direkt an der Karte.
- **Weg antippen:** Öffnet das Weg-Blatt mit Höhenprofil, Kennzahlen, Befunden und GPX-Export.
- **Gipfel oder Hütte antippen:** Öffnet ein Popup, bei Gipfeln mit OSM- und DEM-Höhe samt Bewertung.
- **Bergnamen mit Höhe:** In der Übersicht kommen sie aus der Grundkarte. Ab Zoom 12 stammen sie aus den Live-OSM-Daten und stehen neben dem farbigen Prüfpunkt.
- **Bergwege laden:** Die Wege werden in Zellen von etwa 3 × 3,3 km nachgeladen, von der Bildmitte nach aussen. Jede Zelle wird nur einmal geladen. Fortschritt und Fehler erscheinen oben als Meldung.
- Die URL merkt sich Position und Blickwinkel, Links lassen sich also teilen.
- **Radrouten:** Ausgeschilderte Rad- und MTB-Routen (OSM-Relationen `route=bicycle|mtb`) erscheinen als breite, halbtransparente Bänder unter den Wegen. Farbe nach Netz: national blau, regional violett, lokal türkis, MTB orange. Ab Zoom 12 steht die Nummer oder der Name an der Linie. Die Geometrie wird pro Zelle serverseitig beschnitten, `out geom(bbox)`.
- **Offline unterwegs:**
  - **Service Worker** (`sw.js`): App-Dateien kommen bevorzugt aus dem Netz, bei Funkloch aus dem Cache. Kacheln, Höhenmodell und Schriften kommen aus dem Cache, das Limit liegt bei 6000 Kacheln. Bergwege und Radrouten kommen aus dem Netz, offline gilt die zuletzt geladene Antwort. Overpass wird deshalb per GET abgefragt.
  - **„Ausschnitt offline speichern“ (Tab Karte) und „Tour offline speichern“:** laden Vektorkarte (Zoom 8–14), Höhenmodell (8–13), Schriften sowie Bergwege und Radrouten des Gebiets vorab, höchstens 4000 Kacheln.
  - **Grenzen:** Ortssuche, Routing und Wetter brauchen Netz.

### Pakete

Erweiterungen hängen sich als Paket ein: eine Datei in `js/packages/` anlegen und sie in `js/packages/index.js` eintragen. Jedes Paket bekommt automatisch einen eigenen Tab und ein eigenes Blatt. Die Schnittstelle besteht aus `mount`, `onStyle` (eigene Ebenen nach einem Wechsel der Grundkarte neu anlegen), `onActivate`/`onDeactivate` und `onMapClick`.

**Touren-Paket** (`js/packages/tours*.js`):
- **Stationen:** „Neue Tour“ anlegen. Stationen lassen sich auf drei Wegen setzen:
  - **Orte eintippen**, auch mehrere: `Sonthofen, Burgberg, Immenstadt`. Für jeden Ort wird der plausibelste Treffer gesetzt: in der Region und höchstens 25 km von der vorherigen Station. Gleichnamige Orte wie Rohrmoos, Tiefenbach oder Hirschsprung gibt es mehrfach. Ohne plausiblen Treffer meldet die App den Ort mit Grund, statt ihn falsch zu setzen.
  - **Pinnen aus der Ortssuche** mit „+ Station“. Ist keine Tour offen, wird eine neue angelegt.
  - **Tippen auf die Karte.**
  
  Jede Station hat Name und Höhe aus dem DEM.
- **Aktivität je Tour:** Wandern, Rad oder E-Bike. Das Routing nutzt dafür das passende BRouter-Profil: `hiking-mountain` für Wanderwege, `trekking` für Rad- und Wirtschaftswege. Die zuletzt gewählte Aktivität gilt für die nächste neue Tour.
  - **Zeit:** Wandern nach DIN 33466. Rad rechnet mit 16 km/h und 450 Hm/h, E-Bike mit 20 km/h und 900 Hm/h. Beides sind Faustregeln, ±30 %.
  - **Unterstützungsstufe** Eco, Tour, Sport oder Turbo als Verbrauchsfaktor (0,62 / 1 / 1,3 / 1,65). Faustregel nach Reichweitenangaben der Hersteller.
  - **Lernt aus echten Fahrten:** Nach der Tour „Tatsächlich … Akkus“ eintragen. Der Median des Verhältnisses echt zu geschätzt über alle Fahrten (begrenzt auf 0,4–2,5) wird dein persönlicher Faktor für alle Schätzungen.
  - **Plausibilität:** Über 90 Hm/km beim Rad oder 300 Hm/km beim Wandern warnt die App. Meist steckt eine Luftlinie über Gelände dahinter.
  - **E-Bike-Akku:** etwa 6 Wh/km plus 0,25 Wh je Höhenmeter. Grundlage ist ein System von 100 kg mit 0,27 Wh/Hm potenzieller Energie, davon trägt der Motor etwa 65 % bei einem Wirkungsgrad von etwa 75 %. Die Akkugrösse ist wählbar. Wind, Unterstützungsstufe und Temperatur verschieben den Wert deutlich.
- **Höhenprofil der Tour** mit nummerierten Stationen. Fürs E-Bike zusätzlich die Akku-Restladung in Prozent und der **Wechselpunkt** (⚡ km). Ein Tipp oder Wisch über das Profil zeigt die Stelle auf der Karte.
- **Fotos automatisch zuordnen:** mehrere Fotos auf einmal auswählen. Die App liest das EXIF der Fotos mit einem eigenen Leser ohne Fremdbibliothek.
  - **Aufnahmeort (GPS):** Das Foto kommt an die nächste Station innerhalb von 5 km.
  - **Kein GPS:** Das Foto kommt an die Station des zeitlich nächsten Fotos mit GPS, sonst an die gewählte Rückfallstation.
  - **3D-Blick:** Mit `GPSImgDirection` steht die Kamera am Aufnahmeort und schaut in Fotorichtung (Neigung 72°). Aufnahmeorte erscheinen als gelbe Punkte auf der Karte.
  - **iPhone:** Beim Auswählen unter „Optionen“ den Ort mitsenden, sonst entfernt iOS die GPS-Daten.
- **Ortsalternativen:** `Altmummen|Alt Mummen|Mummen` probiert die Schreibweisen der Reihe nach. Eine Vorlage mit höherer `version` baut eine bereits übernommene Tour neu auf, statt sie zu verdoppeln.
- **GPX-Import:** Aufgezeichnete Touren (Komoot, Strava, Garmin …) werden als Tour übernommen. Start, Ziel und etwa alle 10 km eine Station. Die gemessene Spur wird nie durch Routing überschrieben.
- **Meine Touren übernehmen:** `data/touren.json` enthält Touren als Ortslisten. Ein Tipp setzt sie auf dem Gerät mit Ortssuche und Routing. Jede Tour wird nur einmal übernommen, Notizen markieren unsichere Deutungen. Achtung: Das Repository ist öffentlich, also auch diese Liste.
- **Touren unterscheiden:**
  - **Farbe:** Jede Tour hat eine eigene Farbe auf der Karte und in der Liste, wählbar.
  - **Gruppe:** Touren mit gleichem Hinweg und unterschiedlichen Rückwegen stehen als Varianten unter einer Gruppenüberschrift. Ein Tipp auf die Überschrift zeigt nur diese Gruppe auf der Karte.
  - **„Als Variante kopieren“:** dupliziert eine Tour ohne Fotos, danach den Rückweg ersetzen.
- **Zeitverlauf:** Die Tourenliste lässt sich nach Jahr filtern. Alle Touren der Auswahl erscheinen gemeinsam auf der Karte, ein Tipp auf eine Linie öffnet die Tour. Zusammen mit dem Tab „Plakat“ ergibt das ein Jahresplakat.
- **Verbindung:** „Wegen folgen“ routet zwischen den Stationen über [BRouter](https://brouter.de) mit dem Profil `hiking-mountain`. Die Route muss höchstens 500 m von beiden Stationen beginnen und enden (Orte, Seen und Gipfel liegen als Mittelpunkt oft etwas neben dem Weg), sonst gilt der Abschnitt als nicht geprüft. Schlägt das Routing fehl, bleibt der Abschnitt Luftlinie, gestrichelt dargestellt und mit Hinweis.
- **Kennzahlen:** Länge, Auf- und Abstieg aus dem DEM. Die Gehzeit folgt DIN 33466 wie beim DAV: 4 km/h, 300 Hm/h aufwärts, 500 Hm/h abwärts; der grössere Wert plus die Hälfte des kleineren.
- **Fotos je Station:** Beim Hochladen wird der aktuelle 3D-Blick (Mitte, Zoom, Neigung, Richtung) mit dem Foto gespeichert. „3D-Blick“ in der Fotoansicht fliegt genau dorthin zurück. Fotos werden auf höchstens 1600 px verkleinert, die EXIF-Drehung wird übernommen.
- **Speicher:** IndexedDB, nur auf dem Gerät. Safari löscht Website-Daten nach 7 Tagen ohne Besuch, ausser die App liegt auf dem Home-Bildschirm. Darum gibt es „Sicherung“, eine JSON-Datei mit Fotos, die sich wieder laden lässt, und den Export als GPX.

**Plakat-Paket** (`js/packages/poster*.js`):
- **Rahmen:** Ein Rahmen im Seitenverhältnis des Papiers (A4 bis A0, hoch oder quer) liegt über der Karte. Was darin zu sehen ist, kommt aufs Plakat, auch eine 3D-Schrägansicht, inklusive Touren und Stationen.
- **Rendering:** Die Karte wird unsichtbar in Druckauflösung neu gerendert, Beschriftungen papiergerecht mit 1 Kartenpixel = 0,25 mm (≈ 9 pt). Dazu kommen Titel, Untertitel, Legende, Nordpfeil und alle Pflicht-Quellenangaben.
- **Massstab** (Zahl und Balken) nur in der Draufsicht. Bei Neigung steht „kein einheitlicher Massstab“ auf dem Plakat.
- **Auflösung:** höchstens 300 dpi, begrenzt durch Bildpixel (iOS ca. 16 MP, Desktop 48 MP) und die WebGL-Grösse des Geräts (höchstens 8192 px). Die App zeigt die erreichbare dpi vorab. Rendert das Gerät weniger, nennt sie die effektive dpi.
- **Luftbild-Plakate:** Bayern, basemap.at und Sentinel-2 2016 stehen unter CC BY 4.0 und dürfen mit Namensnennung gedruckt werden. Die Namensnennung druckt die App automatisch mit.

**Wetter-Paket** (`js/packages/weather*.js`):
- **Quelle:** Open-Meteo mit dem Modell DWD ICON (ICON-D2 mit 2 km im Alpenraum). Daten unter CC BY 4.0, für nicht-kommerzielle Nutzung frei.
- **Höhe:** Die Abfrage übergibt die Geländehöhe aus unserem Höhenmodell. Die Temperatur gilt dadurch für den Punkt am Berg, nicht für den Gitterpunkt des Modells.
- **Faustregeln:** Böen ab 60 km/h sind eine Warnung. CAPE ab 1000 J/kg zusammen mit Niederschlag gilt als Gewitterrisiko. Liegt die 0-°C-Grenze unter der Punkthöhe, droht Frost, Schnee oder Eis. Die Regeln sind konservativ und ersetzen keinen Bergwetterbericht.
- **Regenradar:** DWD-Geoserver (Open Data). Den Ebenennamen habe ich aus der Dokumentation übernommen, live geprüft ist er nicht.

### Offline-Karte erstellen (einmalig, am Computer)

1. Das Programm `pmtiles` von <https://github.com/protomaps/go-pmtiles/releases> herunterladen.
2. Auf <https://maps.protomaps.com/builds/> das aktuelle Datum ablesen.
3. Ausführen, mit dem Datum statt `JJJJMMTT`:
   ```
   pmtiles extract https://build.protomaps.com/JJJJMMTT.pmtiles allgaeu.pmtiles --bbox=9.55,47.22,11,47.98 --maxzoom=15
   ```
4. In der App unter „Offline-Karte“ die Datei wählen, oder sie neben `index.html` hochladen und per URL laden.

## Regionsdaten (schnell und offline)

Bergwege, Radrouten, Gipfel und Hütten der Region (Allgäu, Tirol, Vorarlberg, Bodensee) werden **wöchentlich vorab berechnet**, nicht bei jedem Öffnen live abgefragt.

- **Erzeugung:** `tools/build-region.mjs` läuft in GitHub Actions, montags 03:17 UTC und bei jedem Deploy, mit Cache je Kalenderwoche. Es nutzt dieselbe Overpass-Abfrage und denselben Parser wie die App und fragt die Region in 48 Teilen ab, mit Pausen und Wiederholung. Das Ergebnis wird in die App-Zellen zerlegt (`js/region.js`). Geschrieben wird erst in einen Zwischenordner, halbe Daten werden nie veröffentlicht.
- **App:** Zellen in der Region kommen als statische Datei von GitHub Pages, gecacht und unveränderlich je Generation. Statt 3–30 s je Overpass-Abfrage dauert das Sekundenbruchteile, und die Ladeanzeige entfällt. Ausserhalb der Region oder ohne Regionsdaten fragt die App weiter live ab.
- **„Ganze Region offline speichern“** (Tab Karte): alle Wege-Zellen plus Übersichtskarte und Höhen bis Zoom 12, im Test etwa 400 Dateien. Kartendetails bis Zoom 14 bringen „Tour offline speichern“ bzw. „Ausschnitt offline speichern“.
- **Veröffentlichung:** `gh-pages` wird ohne Verlauf neu geschrieben, damit sich die wöchentlichen Daten nicht im Repository ansammeln.
- **Aktualität:** wöchentlich. Der OSM-Stand steht unter Info → Quellen.

## Ladezeit und Akku (Handy)

Gemessen in Headless-Chromium mit iPhone-Profil (Pixeldichte 3) und 4G-Drosselung (40 ms):

| | vorher | nachher |
|---|---|---|
| Seite geladen | 1,38 s | 1,18 s |
| Menü bedienbar | 1,79 s | 1,61 s |
| Pixel je 3D-Kartenbild | 2,69 MP | 1,19 MP (−56 %) |
| Energiesparmodus | – | 0,47 MP (−82 %) |
| Overpass-Abfragen beim Start | 13 | 9 |

Massnahmen:
- **Pixeldichte:** höchstens 2× statt 3×. Bei 3× fallen 2,25× so viele Pixel an, der sichtbare Unterschied ist kaum wahrnehmbar.
- **Energiesparmodus** (Tab Karte): 1,25× Pixeldichte, keine Schummerung, weniger Nachladen. Die Einstellung bleibt gespeichert.
- **Module:** Alle Module werden per `modulepreload` parallel geladen statt als Kette. Verbindungen zu Kartenservern werden per `preconnect` früh aufgebaut. Ein Test prüft, dass kein Modul in der Liste fehlt.
- **Protomaps:** Die Bibliotheken für Offline-Dateien (~75 kB) laden erst, wenn eine Datei geöffnet wird.
- **Nachladen:** Am Handy höchstens 9 Wege-Zellen je Bewegung. Läuft die App im Hintergrund, lädt sie nichts nach.
- **Zweiter Start:** Der Service Worker liefert App und Kacheln aus dem Gerätespeicher.

## Entwicklung

Es gibt keinen Build-Schritt, die Seite ist reines HTML mit ES-Modulen.

```
npm test          # Unit-Tests der Geo-, DEM-, Overpass- und Validierungslogik
npm start         # lokaler Server auf http://localhost:8080
```

```
index.html          Oberfläche
js/config.js        alle Quellen, Lizenzen, Schwellwerte (einziger Ort für Änderungen)
js/styles.js        baut den MapLibre-Stil je Grundkarte + Overlays + 3D
js/app.js           Karte, Menü, Laden, Interaktion
js/cells.js         Zellenraster für das Nachladen der Wege
js/search.js        Ortssuche (Nominatim)
js/offline-area.js  Gebiet offline speichern (Kachelmathematik, Vorabladen)
js/region.js        Regionsdaten: Zellen zerlegen und laden
tools/build-region.mjs  Regionsdaten erzeugen (GitHub Actions, wöchentlich)
sw.js               Service Worker (Offline-Betrieb)
js/packages/        Pakete (Touren, Plakat, Wetter)
js/textscale.js     Lesbarkeit: Beschriftungen skalieren
js/overpass.js      OSM-Abfrage und Antwortprüfung
js/dem.js           Höhenabfrage direkt aus den Terrarium-Kacheln
js/validate.js      Kreuzvalidierung und Qualitätskennzahlen
js/offline.js       PMTiles-Anbindung
vendor/             MapLibre GL, PMTiles, Protomaps-Stil (feste Versionen)
```

## Veröffentlichen

Live unter **https://thomasschnell-maker.github.io/tourenatlas/**

Automatisch: Jede Änderung an `main` durchläuft die Tests (`.github/workflows/deploy-pages.yml`) und wird nur bei Erfolg nach `gh-pages` übertragen. Von dort veröffentlicht GitHub Pages. `gh-pages` nie direkt bearbeiten, es wird bei jedem Lauf überschrieben.

Alternativ Netlify: Die Site `allgaeu-tourenatlas` mit diesem Repository verknüpfen, `netlify.toml` ist vorbereitet.

Kartendaten © OpenStreetMap-Mitwirkende (ODbL). Planungshilfe, kein Ersatz für die Lagebeurteilung vor Ort.
