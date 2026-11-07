# Masters of Chess ♟

Een moderne schaakapp om **met twee personen op één apparaat** te spelen. De app is mobielvriendelijk en kan direct als statische website via GitHub Pages draaien.

## Functies

- Interactief 8×8-schaakbord met legale zetten, schaakmat, pat, rokade, en passant en promotie.
- Schaakregels via [chess.js](https://github.com/jhlywa/chess.js).
- Bedenktijd: 3+2, 5+0, 10+5, 15+10, 30+0 en zonder klok.
- Automatische secondenincrement, starten/pauzeren en tijdsoverschrijding.
- Remise in overleg, claimen bij driemaal herhaling of na 50 zetten.
- Automatische remise bij vijfmaal herhaling, 75 zetten en onvoldoende materiaal.
- Zetgeschiedenis, zet terugnemen, opgeven, bord draaien, FEN kopiëren en PGN exporteren.
- Lokale opslag: na herladen wordt de partij hersteld met **gepauzeerde klok**.

## Starten

De app is opgebouwd uit gewone HTML, CSS en JavaScript. Er is geen buildstap nodig.

1. Open de repository via GitHub Pages; of
2. Start in de lokale repository een HTTP-server:

~~~bash
python -m http.server 8000
~~~

Open vervolgens http://localhost:8000 in je browser.

De browser laadt chess.js@1.4.0 als ECMAScript-module vanaf jsDelivr. Hiervoor is een internetverbinding nodig. Open de site via HTTP(S), niet als file://-bestand.

## Publiceren via GitHub Pages

De workflow in .github/workflows/deploy.yml publiceert de website bij iedere push naar main.

In een nieuwe repository moet GitHub Pages mogelijk nog eenmalig worden geactiveerd:

1. Open **Settings → Pages** op GitHub.
2. Kies bij **Build and deployment → Source** voor **GitHub Actions**.
3. Controleer de workflow **Deploy Masters of Chess** onder **Actions**.

Beoogde website: https://barloss94.github.io/mastersoffchess/

## Spelgedrag

- Kies een stuk en vervolgens een gemarkeerd doelveld.
- Start bij voorkeur de klok vóór de eerste zet. Anders begint de klok automatisch **na de eerste zet**, zonder de voorafgaande bedenktijd van wit af te trekken.
- Bij pionpromotie kun je een dame, toren, loper of paard kiezen.
- **Zet terug** herstelt de klok van het moment van de teruggenomen zet en pauzeert de klok.
- Een herladen partij wordt altijd gepauzeerd hervat.

## Technologie en uitbreidingen

Dit is bewust een **frontend-only versie**: geen accounts, online multiplayer of database. De gebruikersinterface gebruikt gewone JavaScript zonder buildstap, met chess.js als spelregelbibliotheek. Een volgende fase kan worden uitgebreid met React, Supabase, online partijen en server-side zetvalidatie.

## Dependencylicentie

[chess.js](https://github.com/jhlywa/chess.js) is beschikbaar onder de BSD-2-Clause-licentie en wordt extern geladen.
