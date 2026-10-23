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
- **Overpass:** Overpass ist ein öffentlicher Dienst. Die Abfrage ist auf 300 km² begrenzt, und es gibt drei Server zur Ausweichnutzung.

## Bedienung

- **Grundkarte:** Karte (OpenFreeMap), Luftbild oder Offline (Protomaps).
- **3D:** Mit zwei Fingern neigen und drehen. Die Überhöhung ist einstellbar.
- **Weg antippen:** Zeigt Höhenprofil, Kennzahlen und Befunde, dazu GPX-Export mit DEM-Höhen und ODbL-Hinweis.
- **Gipfel antippen:** Zeigt OSM- und DEM-Höhe mit Bewertung. Ein Hütten-Symbol öffnet Name und Typ.
- Die URL merkt sich Position und Blickwinkel, Links lassen sich also teilen.

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
js/app.js           Karte, Laden, Interaktion
js/overpass.js      OSM-Abfrage und Antwortprüfung
js/dem.js           Höhenabfrage direkt aus den Terrarium-Kacheln
js/validate.js      Kreuzvalidierung und Qualitätskennzahlen
js/offline.js       PMTiles-Anbindung
vendor/             MapLibre GL, PMTiles, Protomaps-Stil (feste Versionen)
```

## Veröffentlichen

- **GitHub Pages:** Settings → Pages → Branch `main`, Ordner `/ (root)` → Save. Danach läuft die App unter `https://thomasschnell-maker.github.io/tourenatlas/`.
- **Netlify:** Die Site `allgaeu-tourenatlas` mit diesem Repository verknüpfen. `netlify.toml` ist vorbereitet.

Kartendaten © OpenStreetMap-Mitwirkende (ODbL). Planungshilfe, kein Ersatz für die Lagebeurteilung vor Ort.
