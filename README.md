# AutoDarts → DartCounter Bridge

Userscript (Tampermonkey) that takes the darts detected by [Autodarts](https://autodarts.io) and enters each visit into [DartCounter](https://app.dartcounter.net) automatically — once per visit, after the darts are pulled. Optional fun sounds for some darts (laugh, cheer, boo, combo) and fireworks on a bullseye (50).

Userscript dla Tampermonkey. Bierze lotki rozpoznane przez Autodarts i sam wpisuje turę do DartCounter. Wpis idzie **raz na turę**, dopiero **gdy tura się skończy** (wyjęcie lotek albo następna tura).

Wersja: **3.5.0**. Zmiany: [CHANGELOG.md](CHANGELOG.md).

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

## Around the Clock (od 3.5.0)

Gra **Around the Clock** w Autodarts trafia do gry **Around the Clock** w DartCounter, lotka po lotce. Obsługiwany wariant: **od 1 do 20, na koniec bull 50**.

Ustawienia:

1. **Autodarts:** Around the Clock, Order **1-20-Bull**, Mode **Full**, Hits **1**.
2. **DartCounter:** Graj lokalnie → Around the Clock: **Play from 1 to 20**, **Finish by hitting the bullseye**, segmenty **All**, trafienia **Once**, „**Increase by segment**” wyłączone.
3. W meczu DartCounter zostaw zwykłą klawiaturę z przyciskami **S/D/T** bieżącego celu i **Miss** (klawiatura z klikaną tarczą nie jest obsługiwana).
4. Adres strony: `app.dartcounter.net/game/around-the-clock`. Panel AD2DC pokazuje „Strona meczu: TAK (Around the Clock)” i wiersz z ustawieniami DartCounter.

Jak to działa: po każdej turze z Autodarts skrypt klika w DartCounter każdą lotkę: trafienie w bieżący cel (S, D albo T — każde przesuwa o jeden cel) albo **Miss**, a na końcu zatwierdza turę. O tym, co jest trafieniem, decyduje **DartCounter** i jego ustawienia.

**Różnica przy bullu:** w Autodarts na końcu wystarcza też zewnętrzny bull (25). DartCounter z „Finish by hitting the bullseye” zalicza tylko **50**. Skrypt wysyła lotki tak, jak padły, więc przy 25 Autodarts może już skończyć grę, a DartCounter dalej czeka na 50. Tak jest celowo: grę kończy bull 50, a DartCounter jest wynikiem odniesienia.

Od 3.5.3, tylko w Around the Clock: Autodarts nie ma ustawienia „bull tylko 50” (w trybie Full cel bull przyjmuje 25 i 50). Dlatego gdy na celu bull padnie 25, karta gry od razu poprawia tę lotkę w Autodarts na pudło. Używa do tego korekty lotki z samej aplikacji. Autodarts gra dalej i kończy dopiero na 50, tak jak DartCounter z „Finish by hitting the bullseye”. Korekty nie ma, gdy DartCounter liczy też 25 („bull or bullseye”). Wymaga otwartej karty gry.

Gdy Autodarts nie przyjmie korekty (od 3.5.5): Autodarts zamyka grę po 25, a DartCounter gra dalej (25 wpisane jako Miss). **Karta gry sama** od razu zaczyna wtedy grę w Autodarts od nowa, bez polecenia z DartCountera. Robi to jak przycisk „Dalej” w Autodarts (ta sama droga co przejście do kolejnego lega po wygranym legu X01), a gdy to nie zadziała, zakłada nowy mecz jak „Zagraj ponownie”. Kolejne lotki znów płyną do DartCountera i bull 50 kończy grę. Nic nie trzeba klikać. Wymaga otwartej karty gry i otwartego Around the Clock w DartCounterze z włączonym mostem (bez DartCountera karta gry nie rusza gier Autodarts). Przycisk „Reset Autodarts: wyłączony” wyłącza też to wznawianie. Gdy obie strony skończą na 50, nic się nie dzieje. X01 działa jak wcześniej.

Cel gry (np. bull) skrypt czyta ze stanu gry Autodarts (`state.targets` / `state.currentTargets`, także pod innymi nazwami pól). Gdy celu nie ma w stanie, 25 kończące grę i tak jest rozpoznane: przy kolejności 1-20-Bull grę kończy tylko bull.

Bez wpisu (z czytelnym błędem w panelu i w konsoli):

- inna kolejność w Autodarts (20-1-Bull, Random-Bull) albo w DartCounter (20 → 1, losowa) — bull jest wtedy w innym miejscu po każdej stronie,
- „Increase by segment” w DartCounter, segmenty „Single small/big”, tryb Autodarts „Outer Single”,
- różne ustawienia po obu stronach (np. Hits 2 w Autodarts, Once w DartCounter),
- gra Autodarts inna niż otwarta w DartCounter (X01 przy otwartym Around the Clock i odwrotnie).

Źródło lokalne (`/api/state`, bez ustawień gry z Autodarts) też działa: lotki idą do Around the Clock, decyduje DartCounter.

## Fajerwerki przy bullseye (od 3.4.0, tylko 50 od 3.4.1)

Gdy lotka trafi w **bullseye (50, D-Bull)**, na ekranie DartCounter wybuchają fajerwerki (7 wybuchów u góry i po bokach ekranu) i gra krótki dźwięk fajerwerków (`fireworks-1.mp3`). Zewnętrzny bull (25) nie daje fajerwerków.

Efekt to przezroczysta warstwa (canvas) nad stroną, z `pointer-events: none`: nie przechwytuje kliknięć, nie zasłania pola wyniku (wybuchy są w górnej części i przy bokach) i znika po ok. 2,6 s. Bez zewnętrznych bibliotek. Przy ustawieniu systemowym „ogranicz ruch” (`prefers-reduced-motion`) jest jeden mały wybuch.

Safari: od 3.4.1 animacja działa tak samo jak w Chrome — `requestAnimationFrame` jest wywoływany na `window` (WebKit w piaskownicy skryptu odrzucał wywołanie bez kontekstu i zostawiał puste płótno), ruch jest liczony od czasu (ta sama prędkość przy 60 i 120 Hz), a warstwa znika po czasie także w karcie w tle. Sprawdzone w silnikach WebKit i Chromium (Playwright).

Włączanie i wyłączanie: **ten sam okrągły przycisk głośnika** obok kółka AD2DC włącza i wyłącza razem dźwięki i fajerwerki (domyślnie włączone, stan zapisany jak inne ustawienia). W rozwiniętym panelu przycisk **Test fajerwerków** pokazuje duże fajerwerki na próbę.

## Dźwięki lotek (od 3.3.0)

Karta DartCounter gra krótki dźwięk przy niektórych lotkach:

| Lotka | Dźwięk |
|---|---|
| S1, D1, T1 | śmiech (`laugh-2.mp3`) |
| T20 | brawa (`cheer-2.mp3`) |
| pudło (lotka poza tarczą, Miss / 0) | buczenie (`boo-3.mp3`) |
| tura S1 + S5 + S20 w dowolnej kolejności | combo (`combo-6.mp3`) |

- **Combo ma pierwszeństwo.** Przy turze S1 + S5 + S20 gra tylko combo, na koniec tury (po trzeciej lotce), a śmiech za S1 nie gra. Dlatego śmiech za S1 czeka, dopóki combo jest jeszcze możliwe. Gdy kolejna lotka psuje combo, śmiech gra wtedy (albo gra dźwięk tej nowszej lotki, jeśli ma własny), a gdy tura kończy się bez combo — na koniec tury.
- **Jeden dźwięk naraz:** nowy dźwięk przerywa poprzedni. Bez kolejki, bo kolejka z dźwiękami po ~3 s zostawałaby w tyle za lotkami.
- Pozostałe lotki są ciche. Poprawka lotki w grze nie jest nową lotką i nie gra dźwięku.

Jak włączyć:

1. Obok kółka **AD2DC** (prawy dolny róg DartCounter) jest okrągły przycisk z **głośnikiem**. Jest widoczny też przy zwiniętym panelu.
2. Jedno kliknięcie przełącza dźwięki i efekty (fajerwerki): zielony głośnik = włączone (domyślnie), szary głośnik z krzyżykiem = wyłączone. Stan zapisuje się w pamięci skryptu (`GM_setValue`) i zostaje po odświeżeniu strony.
3. Przeglądarka pozwala grać dźwięk dopiero po kliknięciu na stronie. Pierwsze kliknięcie w DartCounter (np. w głośnik albo **Test dźwięku** w panelu) odblokowuje audio. Do tego czasu nic nie gra i nie ma błędów w konsoli; wiersz „Dźwięki” w panelu pokazuje „zablokowane do pierwszego kliknięcia”.
4. W rozwiniętym panelu: suwak **Głośność** (domyślnie 60%) i przycisk **Test dźwięku**.

Dźwięki działają obok mostu: nie opóźniają i nie zmieniają wpisu do DartCounter. Grają tylko w aktywnej karcie DartCounter, dla obu źródeł lotek.

Pliki leżą w `sounds/` w tym repo. Skrypt pobiera je raz (po odblokowaniu audio) z `raw.githubusercontent.com` (gałąź `main`) przez `GM_xmlhttpRequest` i gra przez WebAudio. Dlaczego tak, a nie data URI w skrypcie: skrypt zostaje mały (aktualizacje są lekkie, ~80 KB zamiast ~250 KB), zostaje czytelnym ASCII, a dźwięki można wymienić bez zmiany kodu. `GM_xmlhttpRequest` + WebAudio omija ograniczenia CSP strony DartCounter dla zewnętrznych plików audio.

### Licencje dźwięków

Wszystkie pliki są CC0 1.0 (bez wymogu podania autora; podany dla porządku). Zmiany: przycięcie, wyciszenie na początku i końcu, normalizacja głośności (ffmpeg), MP3 mono 44,1 kHz 96 kbit/s.

| Plik | Źródło | Autor | Licencja |
|---|---|---|---|
| `sounds/laugh-2.mp3` | [Scotcampbell - clown laugh (cc0) (freesound).mp3](https://commons.wikimedia.org/wiki/File:Scotcampbell_-_clown_laugh_(cc0)_(freesound).mp3) (Wikimedia Commons, import z Freesound) | scotcampbell | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `sounds/cheer-2.mp3` | [277021 sandermotions applause-2.wav](https://commons.wikimedia.org/wiki/File:277021_sandermotions_applause-2.wav) (Wikimedia Commons, import z Freesound #277021) | Sandermotions | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `sounds/boo-3.mp3` | [Red_Library_Crowds_Men](https://archive.org/details/Red_Library_Crowds_Men), plik „R08-34-Men Booing” (Internet Archive) | USC Cinema / Sunset Editorial Collection | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `sounds/combo-6.mp3` | [Bicycle Horn](https://opengameart.org/content/bicycle-horn), plik „bicycle-horn-1.wav” (OpenGameArt) | antumdeluge | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `sounds/fireworks-1.mp3` | [Fire crackers - New Year 2023 - 2022-12-31T23-53-56.ogg](https://commons.wikimedia.org/wiki/File:Fire_crackers_-_New_Year_2023_-_2022-12-31T23-53-56.ogg) (Wikimedia Commons), fragment 72,15–74,85 s | Almanta | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

## Mecz w DartCounter

- Graj lokalnie → Mecz (X01) → Start. Adres strony: `app.dartcounter.net/game/match`.
- Gdy grasz z DartBotem, wpis czeka, aż DartBot skończy.
- Okno DartCountera „Darts used on a double” / „Darts used for checkout” (po zakończeniu lega, po przerzuceniu albo gdy zostaje ≤ 50) skrypt wypełnia sam (od 3.5.1):
  - lotki na zakończenie: którą lotką tury padło zakończenie (1–3),
  - lotki na podwójnej: ile lotek tury poleciało, gdy reszta wynosiła 50 albo parzystą liczbę 2–40 (tak liczy DartCounter).
  - Jeśli skrypt nie zna reszty, wpisuje przybliżenie i zaznacza to w logu. Okna, którego skrypt nie otworzył swoim wpisem, nie rusza: panel prosi o odpowiedź, a kolejne tury czekają i wpisują się potem.

## Reset gry w Autodarts (od 3.5.1)

Gdy w DartCounterze kończy się leg (albo cały mecz), karta gry Autodarts od razu zaczyna X01 od początkowego wyniku. Dzięki temu gra w Autodarts nie kończy tur ani lega wcześniej niż DartCounter.

Przycisk **„Reset Autodarts”** w panelu przełącza tryb:

| Ustawienie | Kiedy reset |
|---|---|
| koniec każdego lega (domyślnie) | każdy koniec lega i meczu w DartCounterze |
| tylko po przegranym legu | gdy leg (albo mecz) wygrał przeciwnik |
| koniec meczu | tylko gdy DartCounter pokaże koniec meczu |
| wyłączony | nigdy |

Jak to działa:

- DartCounter: koniec lega to licznik legów + 1, powrót wszystkich reszt do wyniku startowego (ktoś miał wcześniej ≤ 170) albo (od 3.5.5, mecz lokalny) zapisany stan meczu samego DartCountera: liczba skończonych legów i kto wygrał ostatni. Działa też, gdy tablica na chwilę znika między legami i przy handicapie. Koniec meczu = ekran końca meczu. Leg jest przegrany, gdy według DartCountera wygrał go DartBot; bez DartBota leg jest wygrany, jeśli zakończyła go Twoja tura.
- Karta gry Autodarts (musi być otwarta, źródło „gra Autodarts”) robi to, co przyciski Autodarts, przez API gry z logowaniem samej strony. Skrypt nie zapisuje żadnych haseł ani tokenów.
  - Leg w Autodarts już skończony → następny leg.
  - Leg w toku (od 3.5.5) → cofnięcie lega do startu przyciskiem **Undo** samej aplikacji (jedna lotka albo jedna zmiana tury na raz, Autodarts nie cofa dalej niż do początku lega). Gdy Undo nie zadziała → `games/restart`. Gdy i to nie zadziała → nowy mecz.
  - Mecz w Autodarts skończony → nowy mecz z tymi samymi ustawieniami (jak „Zagraj ponownie”). Niedokończony mecz jest wcześniej przerywany albo opuszczany (jak przycisk „Opuść” w Autodarts). Karta przechodzi do nowego meczu.
  - Lotka rzucona w Autodarts w trakcie cofania też zostaje cofnięta. Skrypt pokazuje ją w DartCounterze w wierszu „Niewpisane tury”, żeby wpisać ją ręcznie.
- Polecenie i odpowiedź (od 3.5.5): karta gry od razu potwierdza odbiór (ze swoim numerem wersji). Gdy potwierdzenie nie przyjdzie w 3 s, DartCounter wysyła to samo polecenie jeszcze raz (najwyżej 3 razy, wykonane zostaje raz). Po 3 próbach bez odpowiedzi panel mówi wprost, co jest nie tak: karta gry zamknięta, uśpiona, w innej wersji albo nie czyta poleceń.
- Każdy krok jest w logu. W karcie DartCountera: wykryty koniec lega (którym sygnałem), wygrany czy przegrany i dlaczego, wysłane polecenie, potwierdzenie odbioru, każda odpowiedź API Autodarts z kodem HTTP i wynik. W karcie gry: odebrane polecenie, stan meczu, plan i każda odpowiedź API. Przy zgłoszeniu dołącz „Kopiuj log” z obu kart.
- Po wygranym legu (od 3.5.4): gdy Twoja tura zakończy leg w Autodarts (wynik 0), Autodarts sam przechodzi do kolejnego lega, 2,5 s po wysłaniu tury do DartCountera. Gdy mecz w Autodarts się skończył, zaczyna nowy. Działa niezależnie od DartCountera, wyłącza go tylko „Reset Autodarts: wyłączony”. Wynik jest w wierszu „Reset Autodarts” w panelu DartCountera.
- Lotki tury w toku nigdy nie przepadają. Gdy w Autodarts są już lotki nowej tury, reset czeka, aż ta tura trafi do DartCountera.
- Tury po resecie dostają nowe ID, więc nie są odrzucane jako duplikaty.
- Gdy reset się nie uda (brak karty gry, brak logowania, Autodarts odmówi), panel DartCountera pokazuje czerwony komunikat. Wtedy zacznij nową grę X01 w Autodarts ręcznie. Tury dalej się wpisują.
- Najmniej kroków daje gra w Autodarts z wyłączonym „Match mode” (bez legów i setów): mecz nigdy nie kończy się sam.

## Panel AD2DC

Małe kółko w prawym dolnym rogu (kliknij, żeby rozwinąć). Kolor kropki: zielony = działa, żółty = otwórz mecz / grę, czerwony = błąd, szary = most wyłączony.

Obok kółka: przycisk głośnika (dźwięki i fajerwerki wł./wył.). Przyciski w panelu: Włącz/Wyłącz most, Źródło, Wpis, Kopiuj log, Kopiuj surowy stan, Adres API, Double out, Test fajerwerków, Test dźwięku, suwak Głośność, Reset Autodarts, Wyczyść niewpisane, Opóźnienie, Zwiń.

Wiersz **„Karta gry”** (DartCounter) i **„Karta DartCounter”** (karta gry), od 3.5.5: obie karty co sekundę wysyłają sygnał życia ze swoim numerem wersji. Gdy druga karta ma inną wersję, panel pisze np. „Karta gry ma starszą wersję (sprzed 3.5.5), ta karta 3.5.5. Odśwież kartę gry (Cmd+R)”, a kółko pokazuje „odśwież kartę gry”. Gdy sygnału nie ma od 15 s, panel pisze „brak sygnału (karta w tle?)”, a po ponad 90 s „ZAMKNIĘTA”.

Wiersz **„Niewpisane tury”** (od 3.5.1) pokazuje każdą turę, której nie udało się wpisać, z powodem. Kropka jest wtedy czerwona, a kółko pokazuje „niewpisane: N”. Takie tury wpisz ręcznie, potem kliknij „Wyczyść niewpisane”. „Kopiuj log” i „Kopiuj surowy stan” służą do zgłaszania błędów.

## Zasady wpisu

- Jedna tura = jeden wpis (ID tury, trwała lista ostatnich wpisów, jedna aktywna karta DartCounter).
- Nic nie jest wpisywane, gdy nie ma nowych lotek ani gdy lotki zostają w tarczy.
- Automatyczne 0 tylko przy przerzuceniu odrzuconym przez DartCounter oraz przy końcu bez podwójnej (opcja „Double out”).
- „Cofnij” w grze Autodarts po wysłaniu tury nie wysyła jej drugi raz — DartCounter trzeba wtedy poprawić ręcznie.
- Żadna tura nie znika po cichu. Wpis, który nie zostawił śladu w DartCounterze, jest powtarzany (do 3 prób). Czas, gdy DartCounter pyta o lotki, nie liczy się do limitu 120 s. Tura, której nie da się wpisać, trafia na listę „Niewpisane tury”.

## Gdy coś nie działa

- Najpierw odśwież obie karty (DartCounter i grę na play.autodarts) po każdej aktualizacji skryptu. Panel pokaże ostrzeżenie, gdy któraś karta ma inną wersję.
- Panel AD2DC → **Kopiuj log** w obu kartach (DartCounter i karta gry) i dołącz oba do zgłoszenia. Przy Around the Clock dodaj z karty gry **Kopiuj surowy stan** zaraz po rzucie, którego dotyczy problem.
- Przy błędzie wpisu skrypt zapisuje w konsoli przeglądarki jeden czytelny wpis `[AD2DC] BŁĄD wpisu (wersja): …` ze szczegółami (źródło, klawiatura DartCounter, tura).
- Błędy `Invalid value for <svg> attribute width="1.688rem"` w konsoli pochodzą z kodu DartCounter (ikona lotki na klawiaturze), nie z tego skryptu.

## Znane ograniczenia

- DartCounter nie ma publicznego API. Skrypt działa przez elementy strony (stan na wersję aplikacji z października 2026). Zmiana wyglądu DartCounter może wymagać poprawki skryptu.
- Źródło „gra” wymaga, żeby skrypt zdążył podpiąć się pod WebSocket strony gry. Jeśli panel karty gry pokazuje „brak stanu”, odśwież kartę.
- Rozpoznanie gracza na ruchu przy 2+ graczach w trybie sumy jest przybliżone (dotyczy tylko końca bez podwójnej i potwierdzenia przerzucenia).
- Klawiatura DartCounter z klikaną tarczą („dartboard”) nie jest obsługiwana w trybie lotka po lotce.
- Przy źródle lokalnym w Autodarts v2+ lokalne API może zależeć od wersji Board Managera.
- Around the Clock: obsługiwany tylko wariant 1 → 20 + bull (patrz sekcja „Around the Clock”); klawiatura DartCounter z klikaną tarczą i Omni nie są obsługiwane.
- Reset Autodarts korzysta z API gry Autodarts (te same wywołania co aplikacja: Undo, „Dalej”, „Zagraj ponownie”). Nie dało się go sprawdzić na prawdziwym koncie Autodarts. Strona DartCountera jest sprawdzona na prawdziwym app.dartcounter.net (konto gościa, mecz lokalny z DartBotem i Around the Clock), karta gry na atrapie serwera Autodarts, w silnikach WebKit i Chromium. `games/restart` jest w kliencie API aplikacji, ale żaden przycisk aplikacji go nie używa, dlatego od 3.5.5 jest tylko zapasem.
- Dźwięki wymagają jednego kliknięcia na stronie DartCounter po jej otwarciu (zasady autoodtwarzania) oraz dostępu do `raw.githubusercontent.com`.

## Testy

```sh
npm install
npm test
```

Testy logiki (parser, wykrywanie końca tury, decyzja o wyniku, dźwięki lotek i combo, wykrywanie bulla 25/50, ustawienia i przyciski Around the Clock, cel ATC ze stanu gry, sygnał życia i wersja, stan meczu DartCountera z IndexedDB) oraz symulacje stron (jsdom): DartCounter X01 (oba sposoby wpisu, DartBot, przerzucenie, zakończenie, dźwięki, fajerwerki, przycisk głośnika), okno lotek DartCountera (zakończenie 1, 2 i 3 lotkami, przerzucenie, kolejka po oknie), koniec lega i meczu z poleceniem resetu i ponawianiem, DartCounter Around the Clock i karta gry Autodarts (reset: Undo do startu lega, lotka w trakcie cofania, `games/restart`, następny leg, nowy mecz, tura w toku, ponowione polecenie, ATC zakończone na 25, błędy).

Testy w prawdziwych silnikach przeglądarek (WebKit jak Safari i Chromium), ze skryptem w osłonie jak w Tampermonkey (`window` to proxy, pamięć skryptu wspólna dla kart):

```sh
npx playwright install webkit chromium
npm run test:browser
```

Scenariusze: przegrany leg X01 (DartBot wygrywa leg → wykrycie końca lega → polecenie → potwierdzenie → Undo do startu lega → kolejna tura dalej trafia do DartCountera), Around the Clock z 25 na bullu (DartCounter: Miss, karta gry sama zaczyna nową grę w Autodarts, 50 kończy grę) oraz ostrzeżenie o innej wersji drugiej karty. Atrapy stron są zbudowane z prawdziwego kodu HTML DartCountera i prawdziwego kształtu stanu gry Autodarts.

## Licencja

Kod: MIT © 2026 nixuuu. Dźwięki: CC0 1.0 (tabela w sekcji „Licencje dźwięków”).
