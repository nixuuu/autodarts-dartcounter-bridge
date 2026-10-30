# AutoDarts → DartCounter Bridge

Userscript (Tampermonkey) that takes the darts detected by [Autodarts](https://autodarts.io) and enters each visit into [DartCounter](https://app.dartcounter.net) automatically — once per visit, after the darts are pulled.

Userscript dla Tampermonkey. Bierze lotki rozpoznane przez Autodarts i sam wpisuje turę do DartCounter. Wpis idzie **raz na turę**, dopiero **gdy tura się skończy** (wyjęcie lotek albo następna tura).

Wersja: **3.2.1**.

## Instalacja

1. Zainstaluj [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Edge; na Macu także „Tampermonkey for Safari” z App Store).
2. Otwórz link i kliknij **Zainstaluj**:
   https://raw.githubusercontent.com/nixuuu/autodarts-dartcounter-bridge/main/autodarts-dartcounter-bridge.user.js
3. Safari: Ustawienia → Rozszerzenia → Tampermonkey: włącz i zezwól na `app.dartcounter.net` oraz `play.autodarts.com`.
4. Gdy Tampermonkey zapyta o dostęp do `127.0.0.1`, wybierz **Zawsze zezwalaj** (potrzebne tylko dla źródła lokalnego).
5. Usuń inne skrypty tego typu. Dwa mosty naraz mogą wpisać wynik podwójnie.

Tampermonkey sam sprawdza aktualizacje (`@updateURL`).

## Skąd skrypt bierze lotki (przycisk „Źródło” w panelu)

### Gra Autodarts (domyślnie, zalecane)

1. Włącz Autodarts Desktop (albo board) z kamerami.
2. **Karta 1:** https://play.autodarts.com → gra **X01** sam ze sobą, ze swoją tarczą w lobby. Po starcie gry odśwież kartę raz (Cmd+R / F5).
3. **Karta 2:** https://app.dartcounter.net → mecz X01.
4. Najlepiej dwa osobne okna obok siebie (przeglądarki spowalniają karty w tle).

Skrypt czyta stan meczu z WebSocketu strony gry (kanał `autodarts.matches`). **Poprawki lotek zrobione w grze Autodarts** przed końcem tury trafiają do wyniku. Tura idzie do DartCounter, gdy Autodarts przejdzie do następnej tury albo skończy lega.

### Lokalne `/api/state` (zapasowe)

Karta DartCounter odpytuje `http://127.0.0.1:3180/api/state` (Autodarts Desktop / Board Manager) przez `GM_xmlhttpRequest`. Karta Autodarts nie jest potrzebna. Tura idzie po wyjęciu lotek z tarczy. Obsługiwane są oba formaty `/api/state` (stary z `segment{...}` i nowy z płaskimi polami `segmentName`, `segmentNumber`, `multiplier`).

W tym trybie lotkę można poprawić w pasku **„Tura:”** nad kółkiem AD2DC: kliknij lotkę, wybierz S/D/T + numer, 25, Bull albo pudło. Przycisk **Opóźnienie** (0/3/5/10 s) daje czas na poprawkę po wyjęciu lotek.

## Sposób wpisu (zależy od klawiatury w DartCounter)

Sposób wpisu wynika z klawiatury wybranej w meczu DartCounter (ikona klawiatury przy polu wyniku):

- **Klawiatura pojedynczych lotek** (Single / Double / Treble + liczby) → **lotka po lotce**, np. `T20`, `T20`, `S9`. Skrypt klika mnożnik i przycisk liczby dla każdej lotki (np. „20” to jeden przycisk 20), sprawdza każdą lotkę, potem zatwierdza turę. Przerzucenie i końcówkę na podwójnej liczy sam DartCounter (skrypt klika „Potwierdź”).
- **Pole „Wpisz wynik i naciśnij Enter”** albo **klawiatura z cyframi** → **suma tury**, np. `129`.
- Klawiatura z klikaną tarczą i „hotkeys” nie są obsługiwane: skrypt nic nie wpisuje, pokazuje błąd i czeka z turą (do 2 min), aż wybierzesz jedną z klawiatur powyżej.

Przycisk **Wpis** w panelu ustawia preferencję, ale klawiatura DartCounter ma pierwszeństwo: przy klawiaturze lotek skrypt zawsze wpisuje lotka po lotce, przy polu tekstowym lub klawiaturze z cyframi — sumę.

## Mecz w DartCounter

- Graj lokalnie → Mecz (X01) → Start. Adres strony: `app.dartcounter.net/game/match`.
- Gdy grasz z DartBotem, wpis czeka, aż DartBot skończy.
- Po zamknięciu lega DartCounter pyta o liczbę lotek — odpowiedz ręcznie.

## Panel AD2DC

Małe kółko w prawym dolnym rogu (kliknij, żeby rozwinąć). Kolor kropki: zielony = działa, żółty = otwórz mecz / grę, czerwony = błąd, szary = most wyłączony.

Przyciski: Włącz/Wyłącz most, Źródło, Wpis, Kopiuj log, Kopiuj surowy stan, Adres API, Double out, Opóźnienie, Zwiń. „Kopiuj log” i „Kopiuj surowy stan” służą do zgłaszania błędów.

## Zasady wpisu

- Jedna tura = jeden wpis (ID tury, trwała lista ostatnich wpisów, jedna aktywna karta DartCounter).
- Nic nie jest wpisywane, gdy nie ma nowych lotek ani gdy lotki zostają w tarczy.
- Automatyczne 0 tylko przy przerzuceniu odrzuconym przez DartCounter oraz przy końcu bez podwójnej (opcja „Double out”).
- „Cofnij” w grze Autodarts po wysłaniu tury nie wysyła jej drugi raz — DartCounter trzeba wtedy poprawić ręcznie.

## Gdy coś nie działa

- Panel AD2DC → **Kopiuj log** i dołącz go do zgłoszenia.
- Przy błędzie wpisu skrypt zapisuje w konsoli przeglądarki jeden czytelny wpis `[AD2DC] BŁĄD wpisu (wersja): …` ze szczegółami (źródło, klawiatura DartCounter, tura).
- Błędy `Invalid value for <svg> attribute width="1.688rem"` w konsoli pochodzą z kodu DartCounter (ikona lotki na klawiaturze), nie z tego skryptu.

## Znane ograniczenia

- DartCounter nie ma publicznego API. Skrypt działa przez elementy strony (stan na wersję aplikacji z października 2026). Zmiana wyglądu DartCounter może wymagać poprawki skryptu.
- Źródło „gra” wymaga, żeby skrypt zdążył podpiąć się pod WebSocket strony gry. Jeśli panel karty gry pokazuje „brak stanu”, odśwież kartę.
- Rozpoznanie gracza na ruchu przy 2+ graczach w trybie sumy jest przybliżone (dotyczy tylko końca bez podwójnej i potwierdzenia przerzucenia).
- Klawiatura DartCounter z klikaną tarczą („dartboard”) nie jest obsługiwana w trybie lotka po lotce.
- Przy źródle lokalnym w Autodarts v2+ lokalne API może zależeć od wersji Board Managera.

## Testy

```sh
npm install
npm test
```

Testy logiki (parser, wykrywanie końca tury, decyzja o wyniku) oraz symulacje stron (jsdom): DartCounter (oba sposoby wpisu, DartBot, przerzucenie, zakończenie) i karta gry Autodarts.

## Licencja

MIT © 2026 nixuuu
