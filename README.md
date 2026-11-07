# Masters of Chess ♟

Een moderne schaakapp voor **twee spelers op één apparaat** of **tegen de computer**. Draait in de browser op mobiel en desktop, zonder account.

## Functies

- Volledig 8×8-schaakbord met legale zetten, schaakmat, pat, rokade, en passant en pionpromotie via [chess.js](https://github.com/jhlywa/chess.js).
- **Vijf niveaus tegen de computer:** Oefenen (zeer makkelijk), Beginner, Recreatief, Gevorderd en Expert.
- **Oefenen, Beginner en Recreatief** gebruiken bewust een eenvoudige, foutgevoelige tegenstander. Hij kiest alleen geldige zetten, maar mist geregeld kansen en ziet geen ingewikkelde tactiek.
- **Gevorderd en Expert** gebruiken Stockfish 19 Lite (single-threaded), zodat de hogere niveaus uitdagend blijven.
- Zelf kiezen met wit of zwart; het bord draait automatisch mee voor zwart.
- Bestaande lokale modus voor twee spelers blijft werken.
- Bedenktijd: 3+2, 5+0, 10+5, 15+10, 30+0 of onbeperkt.
- Zetgeschiedenis, terugnemen (tegen de computer meestal een volledige beurt), opgeven, FEN kopiëren en PGN exporteren.
- Lokale opslag: partij en instellingen worden opgeslagen en na herladen **gepauzeerd** hersteld.
- Bij uitval van de Stockfish-engine speelt een eenvoudige reservecomputer verder; de app vermeldt dit duidelijk.

## GitHub Pages

De publicatieworkflow onder .github/workflows/deploy.yml installeert het npm-pakket `stockfish@19.0.1`, kopieert de ongewijzigde **lite single-threaded** JavaScript- en WASM-bestanden naar de website en publiceert de statische bestanden. Dit is bewust de single-threaded variant, zodat GitHub Pages geen speciale cross-origin-isolationheaders nodig heeft.

Website: **https://barloss94.github.io/mastersoffchess/**

## Lokaal ontwikkelen

~~~bash
npm install
python -m http.server 8000
~~~

Open http://localhost:8000. `npm install` voert automatisch `scripts/prepare-engine.mjs` uit en zet de Stockfish-werknemer plus WASM in `engine/`. Die gegenereerde bestanden staan in .gitignore.

De browser laadt chess.js 1.4.0 vanaf jsDelivr. Hiervoor is internet nodig. Op de twee hoogste niveaus draait Stockfish lokaal in een Web Worker. De drie laagste niveaus draaien direct in de browser zonder Stockfish. Er worden geen zetten naar een externe schaakserver verstuurd.

## Tests

~~~bash
npm install
npm test
~~~

De tests controleren onder meer schaakmat, rokade, bijzondere zetten, opslag/herladen en computermodus.

## Bedenktijd en spelgedrag

- Start bij voorkeur de klok vóór de eerste zet. Anders begint deze automatisch **na de eerste zet**.
- De computer doet zelfstandig zijn zet zodra hij aan de beurt is, óók als je zwart kiest.
- **Oefenen** is speciaal bedoeld om zetten en slaan rustig te oefenen. De tegenstander maakt veel fouten en gebruikt geen openingstheorie of diepe berekeningen. **Beginner** is iets sterker, maar nog steeds duidelijk onder Stockfish-niveau. Bij **Recreatief** let de computer meer op eenvoudig materiaalwinst.
- In de computermodus doet **Zet terug** ook de voorafgaande computerzet ongedaan, zodat je een andere zet kunt proberen.
- Het opgeven van een partij tegen de computer betekent altijd dat **jij** opgeeft, ook wanneer de computer nadenkt.
- Remise onderling afspreken is alleen in de lokale modus mogelijk. Reglementair remise claimen kan wel in de computermodus.
- De klok wordt na herladen van de pagina altijd gepauzeerd.

## Licenties en herkomst

- Schaakregels: [chess.js](https://github.com/jhlywa/chess.js), BSD-2-Clause.
- Schaakengine: [Stockfish.js van nmrugg](https://github.com/nmrugg/stockfish.js), versie 19.0.1 van het npm-pakket [stockfish](https://www.npmjs.com/package/stockfish), onder **GNU GPLv3**. De ongewijzigde enginebestanden worden bij de Pages-build apart gedistribueerd. Broncode en licentiebepalingen van Stockfish zijn beschikbaar via de genoemde upstreamrepository. De engine wordt gebruikt via het UCI-protocol in een aparte Web Worker.
