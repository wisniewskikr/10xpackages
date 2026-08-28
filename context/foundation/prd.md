---
project: "10xPackages"
version: 1
status: draft
created: 2026-08-28
context_type: greenfield
product_type: library
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

# PRD — 10xPackages

## Vision & Problem Statement

Zespół programistów w jednej organizacji na platformie hostingu kodu zbudował sobie warsztat pracy z AI — skille domykające powtarzalne zadania, reguły trzymające Agenta w ryzach, prompty dopasowane do własnego stacku. Te artefakty są dziś rozsiane po wielu repozytoriach: kopiowane ręcznie z projektu do projektu, wrzucane na wiki, wklejane na czacie. Po kilku tygodniach krąży kilka wersji tego samego skilla i nikt — ani administrator, który go pisał, ani programista, który go używa w swoim projekcie — nie wie, która jest obowiązująca. Ponieważ te artefakty są wykonywane przy każdej zmianie w kodzie, nieaktualna wersja nie jest „starą notatką", tylko cichym błędem wsiąkającym w system. Brakuje jednego źródła prawdy, wersjonowania i kontrolowanej dystrybucji — i nie ma dziś żadnego mechanizmu, który by to zapewniał.

Insight: artefakty AI to kod. Skoro są wykonywane, zasługują na to samo, co każdy inny kod — semantyczne wersjonowanie, kontrolę zmian i kontrolowaną dystrybucję. A skoro to zwykłe pliki tekstowe, nie trzeba budować własnego mechanizmu: sprawdzona infrastruktura rejestru pakietów już to daje. Zespół trzyma kod na platformie, która oferuje prywatny rejestr pakietów, więc cała „infrastruktura" to jedno pole w konfiguracji. Każde cięższe rozwiązanie — własne CLI, rejestr w chmurze — byłoby dystrybucją pod CV, nie odpowiedzią na realną potrzebę.

_Nota o skali: przy 100x liczbie repozytoriów-konsumentów sama reguła uzgadniania stanu się nie zmienia, ale ręczne wersjonowanie (FR-002) i model jednego repo źródła prawdy (OQ-3) przestają się skalować — to granica, przy której MVP wymaga rewizji, nie przepisania._

## User & Persona

**Persona główna — Administrator paczki (Maintainer).** Programista lub tech lead w zespole, który dziś nieformalnie pełni rolę opiekuna konwencji AI: pisze i poprawia skille oraz reguły i pilnuje, żeby reszta zespołu z nich korzystała. Sięga po to rozwiązanie w momencie, gdy poprawił skilla lub regułę i chce, żeby zmiana dotarła do wszystkich projektów zespołu — bez obchodzenia repo po kolei i bez kopiuj-wklej. Pracuje na współdzielonej platformie hostingu kodu, zna menedżer pakietów od strony konsumenta paczek, ale nie chce utrzymywać serwera rejestru ani infrastruktury chmurowej.

### Secondary persona — Użytkownik paczki (Consumer)

Programista w dowolnym projekcie zespołu, który chce mieć u siebie aktualny zestaw skilli i reguł. Sięga po rozwiązanie, gdy zakłada nowy projekt albo gdy dowiaduje się, że jest nowa wersja skilla — i chce ją zaciągnąć jednym poleceniem, tak jak każdą inną zależność.

## Success Criteria

Zakres MVP (docięty w fazie 3): dystrybucja **tylko do jednego narzędzia AI** (Claude Code); **ręczne** podbijanie wersji w manifeście projektu; **oba** tryby instalacji — wędrujący z repozytorium oraz samodzielna kopia. Budżet: 3 tygodnie pracy po godzinach, przyjęte bez zastrzeżeń.

### Primary

- Pełny cykl przechodzi bez ręcznej interwencji poza podbiciem wersji: administrator merge'uje zmianę skilla do gałęzi głównej repo źródła prawdy → w ciągu jednego przebiegu CI nowa wersja jest opublikowana w prywatnym rejestrze pakietów zespołu, z zachowaną strukturą paczki (manifest paczki, instalator, deinstalator, skille, reguły oraz definicja pipeline'u publikacji).
- W repo-konsumencie standardowa instalacja zależności oraz standardowa aktualizacja układa i aktualizuje skille w katalogu, z którego odczytuje je narzędzie AI, i podmienia blok reguł w pliku reguł narzędzia AI między parą znaczników granicznych; treść poza znacznikami (dopiski dewelopera) przeżywa aktualizację nietknięta.
- Deinstalacja usuwa dokładnie pliki wypisane w manifeście instalacji — po deinstalacji w repo-konsumencie nie zostaje żaden artefakt paczki (sprawdzalne przez kontrolę wersji).

### Secondary

- Jednorazowe polecenie instalacji (tryb samodzielnej kopii) działa w projekcie bez manifestu projektu — np. repo w Pythonie, Go czy Rust — układając te same artefakty w katalogu narzędzia AI.

### Guardrails

- **Idempotencja instalatora** — uruchomiony dwa razy daje ten sam wynik; nie duplikuje bloku reguł ani wpisów w konfiguracji menedżera pakietów / skryptach projektu.
- **Brak sekretów w repo** — żaden trwały token nie trafia do repo-konsumenta ani do historii kontroli wersji; linia z poświadczeniem powstaje tylko przy instalacji ze zmiennej środowiskowej.
- **Łagodne obejście z istniejącymi plikami konsumenta** — instalator nie nadpisuje cudzych skryptów projektu ani treści pliku reguł narzędzia AI spoza znaczników granicznych; uszkodzony blok (jeden znacznik) jest wykrywany, nie duplikowany.
- **Publikacja duplikatu wersji** (klasa błędu, którą wywołuje ręczne podbijanie) kończy się czytelnym błędem CI — nie cichym fail ani fałszywym sukcesem.

## User Stories

### US-01: Administrator publikuje nową wersję skilla

- **Given** administrator z uprawnieniem `write` do repo źródła prawdy i wcześniej opublikowaną wersją paczki
- **When** zmienia treść pliku skilla, podbija wersję w manifeście projektu i merge'uje PR do gałęzi głównej
- **Then** pipeline CI buduje paczkę i publikuje nową wersję do prywatnego rejestru pakietów zespołu w ramach jednego przebiegu

#### Acceptance Criteria

- Publikacja używa krótkotrwałego poświadczenia CI; w repo ani w logach nie pojawia się trwały sekret
- Struktura opublikowanej paczki zawiera manifest paczki, instalator, deinstalator, skille, reguły oraz definicję pipeline'u publikacji
- Merge bez podbicia wersji (wersja już w rejestrze) kończy się czerwonym buildem z czytelnym komunikatem, nie cichym pominięciem
- Nowa wersja jest widoczna na liście wersji paczki w rejestrze

### US-02: Konsument instaluje i aktualizuje paczkę bez utraty własnych reguł

- **Given** repo-konsument w tej samej organizacji, z istniejącym plikiem reguł narzędzia AI zawierającym własne dopiski dewelopera
- **When** deweloper dodaje paczkę do zależności, ustawia mapowanie prywatnego rejestru w konfiguracji menedżera pakietów i uruchamia standardową instalację, a po wydaniu nowej wersji — standardową aktualizację
- **Then** skille lądują w katalogu skilli narzędzia AI, blok reguł zespołu jest wstawiony/podmieniony między znacznikami granicznymi w pliku reguł, a dopiski dewelopera poza znacznikami pozostają nietknięte

#### Acceptance Criteria

- Powtórna instalacja na czystym drzewie nie generuje żadnego diffa (idempotencja)
- Brak zmiennej środowiskowej z poświadczeniem lokalnie nie przerywa instalacji
- Jednorazowe polecenie instalacji w repo bez manifestu projektu (np. Python) układa te same artefakty w katalogu narzędzia AI
- Manifest instalacji zawiera nazwę paczki, wersję, narzędzie docelowe i pełną listę plików
- Deinstalacja usuwa dokładnie pliki z manifestu; kontrola wersji po deinstalacji nie pokazuje pozostałości paczki

## Functional Requirements

### Repo źródła prawdy

- FR-001: Administrator can trzymać skille i reguły w jednym repo źródła prawdy, poukładane w foldery wg typu, i dodać nowy artefakt przez dorzucenie pliku plus podbicie wersji. Priority: must-have
  > Socrates: Rozważony kontrargument: „wspólne repo blokuje zespoły — każda drobna zmiana skilla to PR do centralnego repo w kolejce przeglądów". Rozstrzygnięcie: zostaje. MVP obsługuje jeden zespół w jednej organizacji (faza 1), skala `small` — monorepo artefaktów jest tu zaletą (jedno źródło prawdy), nie wąskim gardłem. Ryzyko realne dopiero przy wielu zespołach → OQ-3 jako sygnał do rewizji przy skalowaniu.

### Publikacja i wersjonowanie

- FR-002: Administrator can ręcznie podbić wersję paczki w manifeście projektu przed merge. Priority: must-have
  > Socrates: Rozważony kontrargument: „ręczne wersjonowanie zawsze w końcu daje konflikt 409 i pomijane release'y — automatyzacja od razu byłaby tańsza". Rozstrzygnięcie: przyjęte świadomie w fazie 3. FR-004 łagodzi objaw (czytelny błąd zamiast cichego fail), a migracja na automatyczne wersjonowanie jest już w OQ-1.

- FR-003: CI can opublikować paczkę do prywatnego rejestru pakietów zespołu po merge do gałęzi głównej — ale tylko gdy pliki wchodzące do paczki faktycznie zmieniły się między ostatnim wydaniem a bieżącym stanem gałęzi (kontrola różnic w CI) — uwierzytelniając się krótkotrwałym poświadczeniem CI bez trwałych sekretów w repo. Priority: must-have
  > Socrates: Rozważony kontrargument: „publikacja na każdy merge do main zaśmieca listę wersji — lepiej wyzwalać z tagu / Release". Rozstrzygnięcie: FR doprecyzowane — dodano bramkę `git diff` na pliki paczki, więc merge bez realnej zmiany treści nie generuje release'u. Wyzwalanie z tagu odrzucone jako dodatkowy ręczny krok sprzeczny z „bardzo łatwo" z kryteriów sukcesu.

- FR-004: CI can odrzucić próbę publikacji już istniejącej wersji z czytelnym błędem buildu. Priority: must-have
  > Socrates: Rozważony kontrargument: „to leczenie objawu — prawdziwym problemem jest ręczne wersjonowanie z FR-002". Rozstrzygnięcie: prawda, to objaw. Zostaje jako must-have dopóki wersjonowanie jest ręczne — czytelny błąd chroni przed cichym rozjechaniem wersji. Po migracji z OQ-1 ten FR traci znaczenie.

### Instalacja u konsumenta

- FR-005: Konsument can zaciągnąć paczkę przez standardową instalację zależności (tryb wędrujący z repozytorium) albo jednorazowym poleceniem instalacji (tryb samodzielnej kopii, działa też w projekcie bez manifestu projektu). Priority: must-have
  > Socrates: Rozważony kontrargument: „dwa tryby podwajają powierzchnię testów i bugów — w MVP jeden by wystarczył". Rozstrzygnięcie: przyjęte świadomie w fazie 3. Copy jest obowiązkowy (ulotny cache `npx`), symlink daje wędrowanie artefaktów z repo. Ryzyko testowe adresują guardraile (idempotencja). Zachowanie symlink na Windows → OQ-4.

- FR-006: Instalator can idempotentnie dołożyć do konfiguracji menedżera pakietów w repo-konsumencie wyłącznie brakującą linię mapowania prywatnego rejestru (bez modyfikacji istniejących wpisów rejestru) oraz linię uwierzytelniającą tylko przy obecnej zmiennej środowiskowej z poświadczeniem, przy czym brak tej zmiennej lokalnie nie blokuje instalacji. Priority: must-have
  > Socrates: Rozważony kontrargument: „instalator grzebiący w `.npmrc` konsumenta wejdzie w konflikt z jego istniejącym mapowaniem rejestru". Rozstrzygnięcie: FR doprecyzowane — instalator dokłada tylko brakującą linię (`ensureLine`), nigdy nie nadpisuje istniejących wpisów. Zależność `echo`/bash na Windows → OQ-4.

- FR-007: Instalator can ułożyć każdy skill w katalogu skilli narzędzia AI w repo-konsumencie, jako osobny plik skilla. Priority: must-have
  > Socrates: Rozważony kontrargument: „hardkodowana ścieżka `.claude/` zamyka w Claude Code — kłóci się z przenośnym SKILL.md". Rozstrzygnięcie: świadomy zakres MVP (faza 3: tylko Claude Code). Sam plik `SKILL.md` pozostaje przenośny — zmienia się tylko katalog docelowy, co v2 rozwiąże profilami narzędzi (OQ-2). Kolizja nazw skilli z artefaktami konsumenta → OQ-5.

- FR-008: Instalator can wstrzyknąć blok reguł zespołu do pliku reguł narzędzia AI między parę znaczników granicznych, nie ruszając treści poza nimi. Priority: must-have
  > Socrates: Rozważony kontrargument: „reguła, której treść sama zawiera sentinel markery, przy kolejnym install skasuje treść konsumenta spoza bloku — trzeba guard na injection". Rozstrzygnięcie: realne → dodano FR-014.

- FR-009: Instalator can zapisać manifest z nazwą paczki, wersją, narzędziem docelowym i pełną listą wgranych plików. Priority: must-have
  > Socrates: Rozważony kontrargument: „manifest rozjedzie się z rzeczywistością, gdy ktoś ręcznie ruszy wgrany plik — deinstalacja i tak będzie zgadywać". Rozstrzygnięcie: zostaje. Manifest jest wciąż najlepszym dostępnym źródłem prawdy dla deinstalacji (lepszym niż zgadywanie po katalogu); niespójność obsługuje FR-013. Polityka commit vs ignore manifestu → OQ-6.

### Aktualizacja i deinstalacja

- FR-010: Konsument can zaktualizować paczkę i dostać nową treść artefaktów oraz podmieniony blok reguł, z zachowaniem treści pliku reguł narzędzia AI spoza znaczników granicznych, przy czym instalator usuwa też artefakty wycofane z paczki (porównanie manifestu poprzedniej i nowej wersji). Priority: must-have
  > Socrates: Rozważony kontrargument: „update podmienia i dodaje, ale nie usuwa skilla wycofanego z paczki — u konsumenta zostają martwe artefakty". Rozstrzygnięcie: realna luka → FR rozszerzony o usuwanie wycofanych artefaktów na podstawie porównania manifestów.

- FR-011: Konsument can zdeinstalować paczkę, przy czym deinstalator czyta manifest i usuwa dokładnie te pliki, które dodał, niezależnie od obecności wewnętrznych plików menedżera pakietów. Priority: must-have
  > Socrates: Rozważony kontrargument: „deinstalacja niezależna od hooków npm znaczy, że konsument musi ją odpalić ręcznie — większość zapomni i zostawi śmieci". Rozstrzygnięcie: samodzielny manifest to celowa własność (hooki bywają pomijane przy usuwaniu zależności). Best-effort hook `npm` jako uzupełnienie → OQ-7.

### Stany brzegowe

- FR-012: Instalator can wykryć uszkodzony blok reguł (jeden znacznik obecny, drugi zniknął), przerwać z czytelnym komunikatem wskazującym plik i miejsce, i nie próbować naprawy bloku w MVP. Priority: must-have
  > Socrates: Rozważony kontrargument: „to rzadki edge case — w MVP wystarczy wykryć, wypisać błąd i przerwać, zamiast implementować naprawę". Rozstrzygnięcie: FR złagodzony — wykrycie + czytelny błąd + STOP; naprawa bloku poza zakresem MVP.

- FR-013: Deinstalator can przy uszkodzonym manifeście zostawić pliki nietknięte i wypisać listę plików, które usunąłby, żeby konsument mógł posprzątać ręcznie. Priority: nice-to-have
  > Socrates: Rozważony kontrargument: „'zostaw pliki' bez trybu `--force` zostawia konsumenta z martwą deinstalacją i żadną ścieżką naprzód". Rozstrzygnięcie: FR rozszerzony — deinstalator wypisuje listę kandydatów do ręcznego usunięcia (ścieżka wyjścia bez `--force`). Pozostaje nice-to-have.

- FR-014: Instalator can odmówić zapisania reguły, której treść sama zawiera znaczniki graniczne paczki, i przerwać z ostrzeżeniem (guard na sentinel-injection). Priority: must-have
  > Socrates: Dodany w wyniku rundy Sokratesa nad FR-008. Wprost z lekcji: bez tego guardu podrzucony marker w treści reguły przy kolejnym install zostałby wzięty za prawdziwy i skasował treść konsumenta spoza bloku.

## Non-Functional Requirements

- Uruchomienie instalatora dwa razy z rzędu na tym samym wejściu nie wprowadza żadnej różnicy w drzewie plików projektu konsumenta ani w treści manifestu instalacji względem pierwszego uruchomienia — kontrola wersji po drugim przebiegu pokazuje zero zmian.
- Po dowolnej operacji instalatora (instalacja, aktualizacja, deinstalacja) w projekcie konsumenta ani w jego historii kontroli wersji nie występuje trwałe poświadczenie dostępu; jedyny wpis z poświadczeniem powstaje ulotnie ze zmiennej środowiskowej na czas instalacji i nie trafia do commita.

> Pozostałe właściwości obserwowalne (nienaruszalność treści człowieka w pliku reguł narzędzia AI, kompletna deinstalacja, czytelne komunikaty stanów odmowy, zgodność Linux/macOS/Windows) są przypięte bezpośrednio przez FR-008 / FR-010 / FR-011 / FR-012 / FR-014, guardraile w Success Criteria oraz OQ-4 — nie powielamy ich jako osobnych NFR.

## Business Logic

Instalator uzgadnia stan artefaktów AI w projekcie konsumenta z wybraną opublikowaną wersją paczki, wprowadzając wyłącznie zmiany, które należą do tej wersji lub które sam wcześniej wykonał, i nigdy nie nadpisując treści wprowadzonej przez człowieka.

Wejścia (od strony użytkownika): którą wersję paczki wybrał; jaki jest obecny stan jego projektu, w tym plik reguł z własnymi dopiskami i ewentualne artefakty z poprzedniej instalacji; jakim poleceniem uruchomił operację (instalacja, aktualizacja, deinstalacja) i w jakim trybie — wędrującym razem z repozytorium albo jako samodzielna kopia.

Wyjście: zestaw plików artefaktów w miejscach, w których szuka ich narzędzie AI użytkownika; blok reguł zespołu wstawiony lub podmieniony w obrębie własnych znaczników granicznych; zapis (manifest) opisujący dokładnie, co zostało wprowadzone, tak aby późniejsza aktualizacja lub deinstalacja mogła cofnąć dokładnie te zmiany, łącznie z usunięciem artefaktów wycofanych z nowej wersji.

Jak użytkownik to spotyka: uruchamia jedno polecenie i dostaje przewidywalny wynik — nowe i zmienione artefakty na swoim miejscu, własne notatki w pliku reguł nietknięte, a po deinstalacji projekt czysty; powtórzenie tego samego polecenia niczego nie psuje ani nie dubluje. Po stronie wydawcy obowiązuje reguła odwrotna: nowa wersja paczki powstaje tylko wtedy, gdy zawartość artefaktów faktycznie różni się od ostatniej wydanej — sama zmiana w repozytorium bez zmiany plików paczki nie tworzy wydania.

## Access Control

Paczka jest **prywatna, w obrębie jednej organizacji na platformie hostingu kodu zespołu**. Nie ma osobnego systemu kont — tożsamość i uprawnienia pochodzą z platformy hostingu kodu (członkostwo w organizacji + uprawnienia na repozytoriach).

| Rola | Skąd wynika | Może |
|---|---|---|
| Administrator paczki (Maintainer) | Uprawnienie `write` na repo źródła prawdy | Zmieniać artefakty i konfigurację paczki; merge do gałęzi głównej wyzwala publikację nowej wersji przez CI |
| Użytkownik paczki (Consumer) | Członek organizacji z dostępem `read` do repo źródła prawdy | Zaciągać każdą opublikowaną wersję paczki w repo swojego projektu |
| Osoba spoza organizacji | — | Brak dostępu do odczytu (paczka prywatna). Poza zakresem MVP |

- **Publikacja** — wyłącznie z CI, przy merge do gałęzi głównej repo źródła prawdy. CI uwierzytelnia się krótkotrwałym poświadczeniem z uprawnieniem do zapisu w rejestrze pakietów; żaden trwały sekret nie trafia do repo. Ręczna publikacja z maszyny nie jest wspierana.
- **Odczyt / instalacja** — repo-konsument w tej samej organizacji czyta paczkę krótkotrwałym poświadczeniem w swoim CI. Lokalnie: deweloper loguje się raz do prywatnego rejestru pakietów (poświadczenie w lokalnej konfiguracji menedżera pakietów); instalator nie blokuje instalacji, gdy zmiennej z poświadczeniem brak. Repo staje się konsumentem opt-in przez commit jednej linii mapowania prywatnego rejestru w swojej konfiguracji menedżera pakietów.
- **Płaski model ról** — brak własnych ról w samej paczce. Rozgraniczenie „kto może zmienić artefakty" to uprawnienia platformy hostingu kodu na repo źródła prawdy. „Wybrani użytkownicy i wybrane projekty" realizuje się przez to, które repo dodają mapowanie prywatnego rejestru w swojej konfiguracji, oraz przez uprawnienia organizacji.

## Non-Goals

### Funkcjonalne

- **Osobna infrastruktura rejestru** (dedykowany rejestr w chmurze, IaC, samodzielnie hostowany serwer rejestru) — obecne projekty nie używają infry chmurowej; prywatny rejestr pakietów platformy hostingu kodu nie wymaga stawiania niczego. „Model 2" z lekcji poza zakresem.
- **Pełny produkt z własnym API i CLI**, kryptograficznym podpisywaniem paczek i dawkowaniem treści w czasie — prywatny rejestr pakietów pokrywa potrzebę; budowanie „Modelu 3" to dystrybucja pod CV.
- **Profile dla narzędzi AI innych niż Claude Code** (np. Cursor, Codex) — inne katalogi docelowe i pliki reguł; odłożone do v2 (OQ-2).
- **Automatyczne wersjonowanie semantyczne** (np. semantic-release / release-please) — MVP robi ręczne podbijanie wersji w manifeście projektu (OQ-1).
- **Konsumenci spoza organizacji**, przepływ z trwałym osobistym tokenem dostępu i synchronizacja poświadczeń do zewnętrznych platform buildów — MVP obsługuje tylko repo w tej samej organizacji.
- **Foldery `prompts/` i `config-templates/`** w paczce — MVP obsługuje wyłącznie `skills/` i `rules/`.
- **Marketplace narzędzia AI** jako kanał dystrybucji — vendor lock-in; kanałem jest rejestr pakietów.
- **Wstrzykiwanie reguł do plików reguł innych niż plik reguł Claude Code** (np. `AGENTS.md`, reguły Cursora) — poza zakresem MVP; wiąże się z OQ-2.

### Niefunkcjonalne

- **Brak celu SLA / pomiaru dostępności rejestru** — polegamy na dostępności prywatnego rejestru pakietów, nie mierzymy jej ani nie definiujemy budżetu błędu.
- **Brak wsparcia dla wielu zespołów / wielu paczek artefaktów** — jedno repo źródła prawdy, jeden pakiet; podział przy skalowaniu to OQ-3.

## Open Questions

1. **OQ-1 Migracja na automatyczne wersjonowanie** — MVP używa ręcznego podbijania wersji w manifeście projektu. Kiedy przejść na automatyczne wersjonowanie semantyczne (np. `semantic-release` / `release-please`) + pełną kontrolę różnic? Owner: administrator paczki. Nieblokujące dla MVP.
2. **OQ-2 Rozszerzenie multi-tool** — MVP celuje tylko w Claude Code. Dodanie profili Cursor / Codex (inne katalogi docelowe, inny plik reguł) to v2. Owner: administrator paczki. Nieblokujące dla MVP.
3. **OQ-3 Skalowanie do wielu zespołów** — jedno wspólne repo źródła prawdy sprawdza się dla jednego zespołu; przy wielu zespołach rozważyć podział wg domeny/zespołu lub osobne paczki. Owner: administrator paczki. Nieblokujące dla MVP.
4. **OQ-4 Zachowanie na Windows** — tryb wędrujący (symlink: uprawnienia / Developer Mode) oraz warunkowa linia uwierzytelniająca oparta na `echo`/bash wymagają weryfikacji na czystym Windows bez shella POSIX. Owner: administrator paczki. Do rozstrzygnięcia przed wydaniem MVP.
5. **OQ-5 Kolizja nazw skilli** — co robi instalator, gdy skill z paczki ma tę samą nazwę co istniejący skill konsumenta (ostrzeżenie? prefiks scope? przerwanie?). Owner: administrator paczki. Do rozstrzygnięcia przed wydaniem MVP.
6. **OQ-6 Polityka manifestu w repo konsumenta** — czy manifest instalacji ma być commitowany, czy dodany do ignorowanych plików kontroli wersji? Rekomendacja do README. Owner: administrator paczki. Nieblokujące dla MVP.
7. **OQ-7 Best-effort hook deinstalacji** — czy dołożyć hook menedżera pakietów (`preuninstall`) jako uzupełnienie manifestowej deinstalacji, wiedząc, że hooki bywają pomijane? Owner: administrator paczki. Nieblokujące dla MVP.
