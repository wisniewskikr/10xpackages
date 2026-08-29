---
project: 10xPackages
version: 1
status: draft
created: 2026-08-28
updated: 2026-08-29
prd_version: 1
main_goal: low-complexity
top_blocker: time
---

# Roadmap: 10xPackages

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Zespół w jednej organizacji GitHub zbudował warsztat pracy z AI — skille, reguły, prompty — ale te artefakty są rozsiane po wielu repozytoriach, kopiowane ręcznie i wersyjnie niespójne. Ponieważ wykonują się przy każdej zmianie kodu, nieaktualna wersja jest cichym błędem wsiąkającym w system, a nie starą notatką. 10xPackages traktuje artefakty AI jak kod: jedno repo źródła prawdy, ręczne wersjonowanie, publikacja przez CI do prywatnego GitHub Packages i instalacja u konsumenta jednym poleceniem — bez własnego CLI ani rejestru w chmurze, bo sprawdzona infrastruktura pakietów już to daje. MVP celuje wyłącznie w Claude Code, ręczne podbijanie wersji w manifeście projektu i oba tryby instalacji (wędrujący z repozytorium oraz samodzielna kopia).

## North star

**S-01: Konsument instaluje paczkę (tryb symlink)** — skille lądują w katalogu skilli narzędzia AI, blok reguł zespołu jest wstawiony między znacznikami granicznymi w pliku reguł, a własne dopiski dewelopera poza znacznikami pozostają nietknięte. To najmniejsza pełna ścieżka, której dostarczenie potwierdza rdzeń hipotezy produktu — że artefakty AI da się dystrybuować jak każdą zależność, nie niszcząc pracy konsumenta — i mieści najbardziej ryzykowną logikę MVP, dlatego sekwencjonowana najwcześniej, jak pozwalają zależności.

> „Gwiazda przewodnia" = najmniejszy slice od końca do końca, którego udane dostarczenie udowadnia główną hipotezę produktu; wszystko inne ma znaczenie tylko jeśli to działa. Umieszczony tak wcześnie, jak pozwalają Prerequisites.

## At a glance

| ID    | Change ID                   | Outcome (user can …)                                                                                     | Prerequisites | PRD refs                                        | Status   |
| ----- | --------------------------- | ------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------- | -------- |
| F-01  | package-skeleton            | (foundation) pakiet npm + build + testy + wewnętrzna struktura paczki gotowe do rozwijania               | —             | FR-001; Success Criteria (struktura paczki)     | in-progress |
| S-01  | consumer-install-symlink    | zainstalować paczkę przez standardową instalację i dostać skille + blok reguł, z nietkniętymi dopiskami   | F-01          | US-02, FR-005, FR-006, FR-007, FR-008, FR-009   | in-progress |
| S-02  | consumer-update-and-reconcile | zaktualizować / powtórzyć instalację i dostać nową treść bez śladu po wycofanych artefaktach, bez diffa | S-01          | US-02, FR-010                                   | proposed |
| S-03  | consumer-uninstall-clean    | zdeinstalować paczkę i zostać z czystym repo (zero pozostałości)                                          | S-01          | US-02, FR-011                                   | proposed |
| S-04  | standalone-copy-install     | zainstalować paczkę jednym poleceniem `npx` w repo bez manifestu projektu (Python/Go/Rust)               | S-01          | US-02, FR-005                                   | proposed |
| S-05  | installer-safe-refusals     | dostać czytelną odmowę zamiast cichej szkody przy uszkodzonym bloku reguł lub regule z podrzuconym znacznikiem | S-01     | US-02, FR-012, FR-014, FR-013                   | proposed |
| S-06  | ci-publish-on-merge         | zmergować zmianę artefaktu do main i w jednym przebiegu CI opublikować nową wersję do rejestru            | F-01          | US-01, FR-001, FR-002, FR-003, FR-004           | proposed |
| S-07  | registry-round-trip         | (repo-konsument) opt-in przez commit linii mapowania rejestru i pobrać opublikowaną wersję w swoim CI     | S-06, S-01    | US-01, US-02, FR-003, FR-005, FR-006            | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme               | Chain                                              | Note                                                                          |
| ------ | ------------------- | ------------------------------------------------- | --------------------------------------------------------------------------- |
| A      | Ścieżka konsumenta  | `F-01` → `S-01` → `S-02` / `S-03` / `S-04` / `S-05` | Gwiazda przewodnia `S-01`; `S-02`–`S-05` idą równolegle po `S-01`.           |
| B      | Ścieżka wydawcy     | `S-06`                                            | Odgałęzia się od `F-01`, biegnie równolegle z całym Stream A.                 |
| C      | Domknięcie pętli    | `S-07`                                            | Łączy `S-01` (Stream A) i `S-06` (Stream B) — dowód pełnej hipotezy.         |

## Baseline

What's already in place in the codebase as of `2026-08-28` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** absent — N/A. Produkt to CLI/biblioteka nad plikami tekstowymi, brak UI (`tech-stack.md`).
- **Backend / API:** absent — N/A. PRD Non-Goals wprost wyklucza własne API/CLI-serwer; kanałem jest rejestr pakietów.
- **Data:** absent — brak bazy. Jedyny trwały stan to `manifest.json` instalacji, tworzony przez instalator (S-01).
- **Auth:** absent — brak własnego systemu kont; tożsamość i uprawnienia z platformy hostingu kodu (członkostwo w organizacji + uprawnienia na repo). CI uwierzytelnia się krótkotrwałym poświadczeniem (`tech-stack.md`: `has_auth: false`).
- **Deploy / infra:** absent — brak `package.json`, brak `.github/workflows/`. Cel wg `tech-stack.md`: GitHub Actions → prywatny GitHub Packages, auto-publikacja na merge do main za bramką różnic na plikach paczki.
- **Observability:** absent — brak logowania / śledzenia błędów. PRD Non-Goals (niefunkcjonalne) wyklucza cel SLA / pomiar dostępności rejestru.

## Foundations

### F-01: Szkielet pakietu npm

- **Outcome:** (foundation) pakiet npm istnieje — manifest projektu (scoped, prywatny), konfiguracja TypeScript, cienki build, harness testów oraz konwencjonalny layout wraz z wewnętrzną strukturą paczki (`skills/`, `rules/`, stubowane wejścia instalatora i deinstalatora) — gotowe do rozwijania. Nie zawiera logiki reconcile.
- **Change ID:** package-skeleton
- **PRD refs:** FR-001; Success Criteria (struktura paczki)
- **Unlocks:** S-01 (instalator ma gdzie mieszkać i co testować); S-06 (jest zdefiniowana zawartość paczki do publikacji); redukuje ryzyko wokół blokera `time` — brak generatora, ręczny `npm init` (bootstrapper best-effort wg `tech-stack.md`).
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Bez szkieletu żaden slice nie jest plannowalny — nie ma czego `npm init`-ować. Trzymać minimalnie: stubowane wejścia, nie logika instalatora; pierwszy konsument (S-01) buduje prawdziwą logikę uzgadniania stanu i przez nią przechodzi realna weryfikacja tej warstwy. Przy blokerze `time` największe ryzyko to przeskalowanie szkieletu pod „przyszłe" potrzeby.
- **Status:** in-progress

## Slices

### S-01: Instalacja u konsumenta (tryb symlink)

- **Outcome:** Konsument uruchamia standardową instalację zależności i dostaje każdy skill jako osobny plik w katalogu skilli narzędzia AI oraz blok reguł zespołu wstawiony między parę znaczników granicznych w pliku reguł; treść poza znacznikami zostaje nietknięta; instalator dokłada do konfiguracji menedżera pakietów wyłącznie brakującą linię mapowania rejestru (linia z poświadczeniem tylko przy obecnej zmiennej środowiskowej) i zapisuje manifest.
- **Change ID:** consumer-install-symlink
- **PRD refs:** US-02, FR-005, FR-006, FR-007, FR-008, FR-009
- **Prerequisites:** F-01
- **Parallel with:** S-06
- **Blockers:** —
- **Unknowns:**
  - Zachowanie na czystym Windows bez shella POSIX — symlink (uprawnienia / Developer Mode) oraz warunkowa linia poświadczenia oparta na `echo`/bash (OQ-4). Owner: administrator paczki. Block: no (dotyczy wydania, nie planowania).
  - Kolizja nazwy skilla z istniejącym artefaktem konsumenta — ostrzeżenie / prefiks scope / przerwanie (OQ-5). Owner: administrator paczki. Block: no (MVP domyślnie „ostrzeż i pomiń"; pełna polityka w S-05).
  - Czy manifest instalacji commitować, czy dodać do ignorowanych plików kontroli wersji (OQ-6). Owner: administrator paczki. Block: no (rekomendacja do README).
- **Risk:** Slice z najwyższym ładunkiem ryzyka — znaczniki graniczne, dokładanie tylko brakującej linii w konfiguracji menedżera pakietów, idempotencja pierwszego przebiegu, brak trwałego poświadczenia w repo. Sekwencjonowany zaraz po F-01, bo to gwiazda przewodnia i cała ścieżka konsumenta z niego wychodzi. Co może pójść źle: wciąganie zakresu aktualizacji / deinstalacji / trybu copy — te są celowo wydzielone do S-02..S-04.
- **Status:** in-progress

### S-02: Aktualizacja i uzgodnienie stanu u konsumenta

- **Outcome:** Konsument uruchamia standardową aktualizację (lub powtarza instalację) i dostaje nową treść artefaktów oraz podmieniony blok reguł, z zachowaniem treści pliku reguł spoza znaczników granicznych; instalator usuwa też artefakty wycofane z nowej wersji paczki na podstawie porównania manifestu poprzedniej i nowej wersji; powtórzenie na czystym drzewie nie generuje żadnego diffa.
- **Change ID:** consumer-update-and-reconcile
- **PRD refs:** US-02, FR-010
- **Prerequisites:** S-01
- **Parallel with:** S-03, S-04, S-05, S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Uzgodnienie przez porównanie manifestów — łatwo zostawić martwe artefakty po wycofanym skillu albo zdmuchnąć plik ruszony ręcznie przez konsumenta. Sekwencjonowany po S-01, bo potrzebuje działającej instalacji i ustalonego formatu manifestu. Idempotencja powtórnego przebiegu (NFR) jest weryfikowana właśnie tutaj.
- **Status:** proposed

### S-03: Czysta deinstalacja u konsumenta

- **Outcome:** Konsument deinstaluje paczkę; deinstalator czyta manifest i usuwa dokładnie te pliki, które dodał, niezależnie od obecności wewnętrznych plików menedżera pakietów — po operacji kontrola wersji nie pokazuje żadnej pozostałości paczki.
- **Change ID:** consumer-uninstall-clean
- **PRD refs:** US-02, FR-011
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-04, S-05, S-06
- **Blockers:** —
- **Unknowns:**
  - Czy dołożyć best-effort hook menedżera pakietów (`preuninstall`) jako uzupełnienie manifestowej deinstalacji, wiedząc, że hooki bywają pomijane (OQ-7). Owner: administrator paczki. Block: no.
- **Risk:** Manifestowa deinstalacja jest celowo niezależna od hooków — konsument musi ją odpalić świadomie. Sekwencjonowany po S-01, bo potrzebny format manifestu. Ryzyko: rozjazd manifestu z rzeczywistością po ręcznej ingerencji w pliki — łagodzi FR-013 (realizowane w S-05).
- **Status:** proposed

### S-04: Instalacja jako samodzielna kopia (bez manifestu projektu)

- **Outcome:** Konsument jednym poleceniem `npx <paczka> install` (tryb samodzielnej kopii) układa te same artefakty w katalogu narzędzia AI w projekcie bez manifestu projektu — np. repo w Pythonie, Go czy Rust.
- **Change ID:** standalone-copy-install
- **PRD refs:** US-02, FR-005
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-05, S-06
- **Blockers:** —
- **Unknowns:**
  - Zachowanie na czystym Windows bez shella POSIX — tryb copy jest mniej dotknięty niż symlink, ale warunkowa linia poświadczenia jest ta sama (OQ-4). Owner: administrator paczki. Block: no.
- **Risk:** Tryb copy działa z ulotnego cache `npx` i bez manifestu projektu — brak oparcia w menedżerze pakietów. Ponownie używa silnika instalacji z S-01, stąd zależność. Ryzyko: rozjechanie się dwóch trybów — wspólny silnik to mityguje; osobny slice utrzymuje granicę zakresu S-01.
- **Status:** proposed

### S-05: Głośne odmowy instalatora przy stanach niebezpiecznych

- **Outcome:** Konsument dostaje czytelną odmowę z zatrzymaniem zamiast cichej szkody: przy uszkodzonym bloku reguł (jeden znacznik obecny, drugi zniknął) instalator wskazuje plik i miejsce i nie próbuje naprawy; przy regule, której treść sama zawiera znaczniki graniczne paczki, przerywa z ostrzeżeniem (guard na sentinel-injection); przy uszkodzonym manifeście deinstalator zostawia pliki nietknięte i wypisuje listę kandydatów do ręcznego usunięcia.
- **Change ID:** installer-safe-refusals
- **PRD refs:** US-02, FR-012, FR-014, FR-013
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-04, S-06
- **Blockers:** —
- **Unknowns:**
  - Pełna polityka kolizji nazw skilli — ostrzeżenie / prefiks scope / przerwanie (OQ-5). Owner: administrator paczki. Block: no (domyślne „ostrzeż i pomiń" z S-01 wystarcza do wydania; pełna decyzja zapada tutaj).
  - FR-013 pozostaje nice-to-have — realizowane tylko jeśli budżet 3 tygodni po godzinach pozwoli; inaczej przechodzi do Parked. Owner: administrator paczki. Block: no.
- **Risk:** To slice guardraili „łagodnego obejścia" — rozszerza tę samą ścieżkę zapisu znaczników co S-01, stąd zależność. Przy blokerze `time`: FR-012 i FR-014 są must-have i nie mogą wypaść; FR-013 jest pierwszym kandydatem do cięcia.
- **Status:** proposed

### S-06: Publikacja nowej wersji przez CI na merge do main

- **Outcome:** Administrator zmienia treść artefaktu, ręcznie podbija wersję w manifeście projektu i merge'uje PR do gałęzi głównej repo źródła prawdy; w ramach jednego przebiegu CI nowa wersja jest zbudowana i opublikowana do prywatnego rejestru pakietów zespołu — ale tylko gdy pliki wchodzące do paczki faktycznie się zmieniły (bramka różnic w CI), z uwierzytelnieniem krótkotrwałym poświadczeniem bez trwałych sekretów w repo; próba publikacji już istniejącej wersji kończy się czerwonym buildem z czytelnym komunikatem, nie cichym pominięciem.
- **Change ID:** ci-publish-on-merge
- **PRD refs:** US-01, FR-001, FR-002, FR-003, FR-004
- **Prerequisites:** F-01
- **Parallel with:** S-01, S-02, S-03, S-04, S-05
- **Blockers:** —
- **Unknowns:**
  - Kiedy przejść na automatyczne wersjonowanie semantyczne + pełną kontrolę różnic (OQ-1). Owner: administrator paczki. Block: no (MVP zostaje przy ręcznym podbijaniu).
  - Szablon linii mapowania rejestru dla konsumenta na czystym Windows (OQ-4). Owner: administrator paczki. Block: no.
- **Risk:** Cała nowa infrastruktura: workflow CI, bramka różnic na plikach paczki, krótkotrwałe poświadczenie, obsługa duplikatu wersji. Zależy tylko od F-01, więc biegnie równolegle z całą ścieżką konsumenta. Przy blokerze `time` kuszące jest rozbudowanie pipeline'u — trzymać jeden plik workflow, bez automatycznego wersjonowania (OQ-1).
- **Status:** proposed

### S-07: Domknięcie pętli — publikacja i odczyt przez realny rejestr

- **Outcome:** Repo-konsument w tej samej organizacji staje się konsumentem opt-in przez commit jednej linii mapowania prywatnego rejestru w swojej konfiguracji menedżera pakietów, a jego CI zaciąga opublikowaną wersję paczki krótkotrwałym poświadczeniem — pełny cykl publikacja→odczyt przechodzi bez ręcznej interwencji poza podbiciem wersji.
- **Change ID:** registry-round-trip
- **PRD refs:** US-01, US-02, FR-003, FR-005, FR-006
- **Prerequisites:** S-06, S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Mapowanie rejestru i uwierzytelnianie w CI konsumenta na czystym Windows (OQ-4). Owner: administrator paczki. Block: no.
- **Risk:** Domyka główne kryterium sukcesu — pierwsze miejsce, gdzie strona publikująca i konsumująca spotykają się na realnym rejestrze i realnym poświadczeniu CI konsumenta (ścieżka auth nietykana przez FR-005/006, które są lokalne). Sekwencjonowany na końcu, bo potrzebuje obu stron gotowych. Ryzyko: uprawnienia organizacji i widoczność pakietu prywatnego dla repo-konsumenta.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                     | Suggested issue title                                                                                          | Ready for `/10x-plan` | Notes                                             |
| ---------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------- |
| F-01       | package-skeleton              | Scaffold npm package skeleton (manifest, TS config, thin build, test harness, package layout)                | yes                   | Ręczny `npm init` — bootstrapper best-effort     |
| S-01       | consumer-install-symlink      | Consumer install (symlink): skills + sentinel-bounded rules block, registry-mapping line, manifest written    | no                    | Po F-01. OQ-4 / OQ-5 / OQ-6 nieblokujące         |
| S-02       | consumer-update-and-reconcile | Consumer update: reconcile artefacts, drop withdrawn files via manifest diff, idempotent re-run              | no                    | Po S-01                                          |
| S-03       | consumer-uninstall-clean      | Consumer uninstall from manifest, independent of package-manager internals                                    | no                    | Po S-01. OQ-7 nieblokujące                       |
| S-04       | standalone-copy-install       | One-shot `npx` copy install for repos without a project manifest                                              | no                    | Po S-01. OQ-4 nieblokujące                       |
| S-05       | installer-safe-refusals       | Loud refusals: corrupted rules block (FR-012), sentinel-injection guard (FR-014), corrupted-manifest listing  | no                    | Po S-01. OQ-5 nieblokujące; FR-013 nice-to-have  |
| S-06       | ci-publish-on-merge           | CI publish on merge to main: diff gate on packaged files, ephemeral credential, duplicate-version rejection   | no                    | Po F-01. Równolegle z S-01..S-05. OQ-1 nieblokujące |
| S-07       | registry-round-trip           | End-to-end: consumer repo opts in via registry-mapping line, its CI installs the published version            | no                    | Po S-06 + S-01                                   |

## Open Roadmap Questions

1. **OQ-4 Zachowanie na Windows** — tryb wędrujący (symlink: uprawnienia / Developer Mode) oraz warunkowa linia poświadczenia oparta na `echo`/bash wymagają weryfikacji na czystym Windows bez shella POSIX. Owner: administrator paczki. Block: S-01, S-04, S-06, S-07 — do rozstrzygnięcia przed wydaniem MVP, nie blokuje planowania.
2. **OQ-5 Kolizja nazw skilli** — co robi instalator, gdy skill z paczki ma tę samą nazwę co istniejący skill konsumenta (ostrzeżenie? prefiks scope? przerwanie?). Owner: administrator paczki. Block: S-01, S-05 — do rozstrzygnięcia przed wydaniem MVP.
3. **OQ-1 Migracja na automatyczne wersjonowanie** — kiedy przejść z ręcznego podbijania wersji na automatyczne wersjonowanie semantyczne + pełną kontrolę różnic. Owner: administrator paczki. Block: S-06 — nieblokujące dla MVP.
4. **OQ-6 Polityka manifestu w repo konsumenta** — czy manifest instalacji ma być commitowany, czy dodany do ignorowanych plików kontroli wersji. Owner: administrator paczki. Block: S-01 — nieblokujące, rekomendacja do README.
5. **OQ-7 Best-effort hook deinstalacji** — czy dołożyć hook menedżera pakietów (`preuninstall`) jako uzupełnienie manifestowej deinstalacji. Owner: administrator paczki. Block: S-03 — nieblokujące dla MVP.
6. **OQ-2 Rozszerzenie multi-tool** — dodanie profili Cursor / Codex (inne katalogi docelowe, inny plik reguł). Owner: administrator paczki. Block: roadmap-wide — poza zakresem MVP (v2).
7. **OQ-3 Skalowanie do wielu zespołów** — podział jednego repo źródła prawdy wg domeny/zespołu lub osobne paczki. Owner: administrator paczki. Block: roadmap-wide — poza zakresem MVP.

## Parked

- **Osobna infrastruktura rejestru** (dedykowany rejestr w chmurze, IaC, samodzielnie hostowany serwer) — Why parked: PRD §Non-Goals; obecne projekty nie używają infry chmurowej, prywatny rejestr platformy hostingu kodu nie wymaga stawiania niczego.
- **Pełny produkt z własnym API i CLI**, kryptograficzne podpisywanie paczek, dawkowanie treści w czasie — Why parked: PRD §Non-Goals; „Model 3" to dystrybucja pod CV.
- **Profile dla narzędzi AI innych niż Claude Code** (Cursor, Codex) — Why parked: PRD §Non-Goals; inne katalogi docelowe i pliki reguł, odłożone do v2 (OQ-2).
- **Automatyczne wersjonowanie semantyczne** (semantic-release / release-please) — Why parked: PRD §Non-Goals; MVP robi ręczne podbijanie wersji (OQ-1).
- **Konsumenci spoza organizacji**, przepływ z trwałym osobistym tokenem i synchronizacja poświadczeń do obcych platform buildów — Why parked: PRD §Non-Goals; MVP obsługuje tylko repo w tej samej organizacji.
- **Foldery `prompts/` i `config-templates/` w paczce** — Why parked: PRD §Non-Goals; MVP obsługuje wyłącznie `skills/` i `rules/`.
- **Marketplace narzędzia AI jako kanał dystrybucji** — Why parked: PRD §Non-Goals; vendor lock-in, kanałem jest rejestr pakietów.
- **Wstrzykiwanie reguł do plików reguł innych niż plik Claude Code** (`AGENTS.md`, reguły Cursora) — Why parked: PRD §Non-Goals; wiąże się z OQ-2.
- **Cel SLA / pomiar dostępności rejestru** — Why parked: PRD §Non-Goals niefunkcjonalne; polegamy na dostępności rejestru, nie mierzymy jej.
- **Wsparcie wielu zespołów / wielu paczek artefaktów** — Why parked: PRD §Non-Goals niefunkcjonalne; jedno repo źródła prawdy, jeden pakiet (OQ-3).
- **FR-013 (deinstalacja przy uszkodzonym manifeście)** — Why parked: nice-to-have; przy blokerze `time` pierwszy kandydat do cięcia, realizowany w S-05 tylko jeśli budżet pozwoli.

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches the item is archived. Do NOT pre-populate.)
