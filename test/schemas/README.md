# Prüfschemas

Unveränderte offizielle Schemas, am 24. November 2026 abgerufen. Die Dateien werden ausschließlich zur Entwicklung und XSD-Prüfung genutzt; die Anwendung benötigt keinen Schema-Download.

| Datei             | Quelle                                                           | Git-Blob-SHA                               |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| `mets2.xsd`       | https://github.com/mets/METS-schema/blob/main/v2/mets2.xsd       | `7f3b44e00641ead16020fda95cacb7f17b87c39f` |
| `premis-v3-0.xsd` | https://github.com/LibraryOfCongress/premis-v3-0/blob/master/xsd | `be6122b66b0960259444f419db04cbdaf418a723` |

METS 2.0 steht unter CC0; die Lizenzangaben sind im Schema enthalten. PREMIS wird von der Library of Congress gepflegt. Der Test registriert beide Namensräume explizit, verbietet DTDs und externe Auflösung und enthält negative Kontrollen für beide Schemas. Dublin Core und die lokale Bildeigenschaften-Erweiterung werden nicht über externe XSDs validiert; Dublin-Core-Feldnamen und interne Verweise werden in den JavaScript-Tests geprüft.
