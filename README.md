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

### Pakete

Erweiterungen hängen sich als Paket ein: eine Datei in `js/packages/` anlegen und sie in `js/packages/index.js` eintragen. Jedes Paket bekommt automatisch einen eigenen Tab und ein eigenes Blatt. Die Schnittstelle besteht aus `mount`, `onStyle` (eigene Ebenen nach einem Wechsel der Grundkarte neu anlegen), `onActivate`/`onDeactivate` und `onMapClick`.

**Touren-Paket** (`js/packages/tours*.js`):
- **Stationen:** „Neue Tour“ anlegen und Stationen durch Tippen auf die Karte setzen. Jede Station hat Name und Höhe aus dem DEM.
- **Verbindung:** „Wegen folgen“ routet zwischen den Stationen über [BRouter](https://brouter.de) mit dem Profil `hiking-mountain`. Die Route muss höchstens 300 m von beiden Stationen beginnen und enden, sonst gilt der Abschnitt als nicht geprüft. Schlägt das Routing fehl, bleibt der Abschnitt Luftlinie, gestrichelt dargestellt und mit Hinweis.
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
