---
project: "10xPackages"
context_type: greenfield
created: 2026-08-28
updated: 2026-08-28
product_type: library
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "typ bólu"
      decision: "brakująca zdolność + dane rozproszone po repo + koszt synchronizacji + tarcie w workflow (wszystkie cztery)"
    - topic: "zasięg persony"
      decision: "zespół w jednej organizacji na GitHubie; wybrani ludzie i wybrane projekty w obrębie tej organizacji"
    - topic: "insight"
      decision: "artefakty AI to kod — należy im się sprawdzona infrastruktura pakietów (GitHub Packages), nie własny mechanizm"
    - topic: "widoczność paczki"
      decision: "prywatna, tylko organizacja"
    - topic: "uwierzytelnianie odczytu"
      decision: "ta sama organizacja, efemeryczny GITHUB_TOKEN w CI; npm login lokalnie; brak PAT i brak konsumentów spoza organizacji w MVP"
    - topic: "kto publikuje"
      decision: "tylko CI po merge do gałęzi głównej; płaski model ról oparty na uprawnieniach repo GitHub"
  frs_drafted: 14
  quality_check_status: accepted
---

# Shape Notes — 10xPackages

> Notatki z fazy odkrywania. Wejście dla `/10x-prd`. Nagłówki sekcji (angielskie) są kontraktem ze schematem PRD — treść w środku po polsku.
> Źródła: `context/foundation/requirements.md`, lekcja `m5l4-shared-ai-registry-skille-komendy-i-reguly-dla-zespolu.md` (Model 1: GitHub Packages).

## Vision & Problem Statement

Zespół programistów w jednej organizacji na GitHubie zbudował sobie warsztat pracy z AI — skille domykające powtarzalne zadania, reguły trzymające Agenta w ryzach, prompty dopasowane do własnego stacku. Te artefakty są dziś rozsiane po wielu repozytoriach: kopiowane ręcznie z projektu do projektu, wrzucane na wiki, wklejane na Slacku. Po kilku tygodniach krąży kilka wersji tego samego skilla i nikt — ani administrator, który go pisał, ani programista, który go używa w swoim projekcie — nie wie, która jest obowiązująca. Ponieważ te artefakty są wykonywane przy każdej zmianie w kodzie, nieaktualna wersja nie jest „starą notatką", tylko cichym błędem wsiąkającym w system. Brakuje jednego źródła prawdy, wersjonowania i kontrolowanej dystrybucji — dziś nie ma żadnego mechanizmu, który by to zapewniał, a artefakty są jednocześnie rozproszone, niespójne wersyjnie i mozolne do rozniesienia po projektach.

Insight: artefakty AI to kod. Skoro są wykonywane, zasługują na to samo, co każdy inny kod — semantyczne wersjonowanie, kontrolę zmian i kontrolowaną dystrybucję. A skoro to zwykłe pliki tekstowe, nie trzeba budować własnego mechanizmu: wystarczy sprawdzona infrastruktura rejestru pakietów. Zespół już trzyma kod na GitHubie, więc GitHub Packages jest w zasięgu ręki — cała „infrastruktura" to jedno pole w `package.json`. Każde cięższe rozwiązanie (własne CLI, rejestr w chmurze) byłoby dystrybucją pod CV, nie odpowiedzią na realną potrzebę.

_Nota o skali (faza 6): przy 100x liczbie repo-konsumentów sama reguła uzgadniania stanu się nie zmienia, ale ręczne wersjonowanie (FR-002) i model jednego repo źródła prawdy (OQ-3) przestają się skalować — to granica, przy której MVP wymaga rewizji, nie przepisania._

## User & Persona

**Persona główna — Administrator paczki (Maintainer).** Programista lub tech lead w zespole, który dziś nieformalnie pełni rolę opiekuna konwencji AI: pisze i poprawia skille oraz reguły i pilnuje, żeby reszta zespołu z nich korzystała. Sięga po to rozwiązanie w momencie, gdy poprawił skilla lub regułę i chce, żeby zmiana dotarła do wszystkich projektów zespołu — bez obchodzenia repo po kolei i bez kopiuj-wklej. Pracuje na GitHubie, zna `npm` od strony konsumenta paczek, ale nie chce utrzymywać serwera rejestru ani infrastruktury chmurowej.

### Secondary persona — Użytkownik paczki (Consumer)

Programista w dowolnym projekcie zespołu, który chce mieć u siebie aktualny zestaw skilli i reguł. Sięga po rozwiązanie, gdy zakłada nowy projekt albo gdy dowiaduje się, że jest nowa wersja skilla — i chce ją zaciągnąć jednym poleceniem, tak jak każdą inną zależność.

## Access Control

Paczka jest **prywatna, w obrębie jednej organizacji GitHub**. Nie ma osobnego systemu kont — tożsamość i uprawnienia pochodzą z GitHuba (członkostwo w organizacji + uprawnienia na repozytoriach).

| Rola | Skąd wynika | Może |
|---|---|---|
| Administrator paczki (Maintainer) | Uprawnienie `write` na repo źródła prawdy | Zmieniać artefakty i konfigurację paczki; merge do gałęzi głównej wyzwala publikację nowej wersji przez CI |
| Użytkownik paczki (Consumer) | Członek organizacji z dostępem `read` do repo źródła prawdy | Zaciągać (`install`) każdą opublikowaną wersję paczki w repo swojego projektu |
| Osoba spoza organizacji | — | Brak dostępu do odczytu (paczka prywatna). Poza zakresem MVP |

- **Publikacja** — wyłącznie z CI, przy merge do gałęzi głównej repo źródła prawdy. CI uwierzytelnia się efemerycznym `GITHUB_TOKEN` z `permissions: packages: write`; żaden trwały sekret nie trafia do repo. Ręczna publikacja z maszyny nie jest wspierana.
- **Odczyt / instalacja** — repo-konsument w tej samej organizacji czyta paczkę efemerycznym `GITHUB_TOKEN` w swoim CI. Lokalnie: deweloper loguje się raz przez `npm login` do GitHub Packages (token w `~/.npmrc`); instalator nie blokuje instalacji, gdy zmiennej tokena brak. Repo staje się konsumentem opt-in przez commit jednej linii mapowania scope w swoim `.npmrc`.
- **Płaski model ról** — brak własnych ról w samej paczce. Rozgraniczenie „kto może zmienić artefakty" to uprawnienia GitHuba na repo źródła prawdy. „Wybrani użytkownicy i wybrane projekty" realizuje się przez to, które repo dodają mapowanie scope w `.npmrc`, oraz przez uprawnienia organizacji.

## Success Criteria

Zakres MVP (docięty w fazie 3): dystrybucja **tylko do Claude Code**; **ręczne** podbijanie wersji w `package.json`; **oba** tryby instalacji — symlink (`npm install`) i copy (`npx`). Budżet: 3 tygodnie pracy po godzinach, przyjęte bez zastrzeżeń.

### Primary

- Pełny cykl przechodzi bez ręcznej interwencji poza podbiciem wersji: admin merge'uje zmianę skilla do gałęzi głównej repo źródła prawdy → w ciągu jednego przebiegu CI nowa wersja jest opublikowana w GitHub Packages, z zachowaną strukturą paczki (`package.json`, `install.js`, `uninstall.js`, `skills/`, `rules/`, `.github/workflows/`).
- W repo-konsumencie `npm install` oraz `npm update` układa i aktualizuje skille w `.claude/skills/` i podmienia blok reguł w `CLAUDE.md` między sentinel markerami; treść poza markerami (dopiski dewelopera) przeżywa aktualizację nietknięta.
- `uninstall` usuwa dokładnie pliki wypisane w manifeście — po deinstalacji w repo-konsumencie nie zostaje żaden artefakt paczki (sprawdzalne przez `git status` / diff).

### Secondary

- `npx @scope/ai-toolkit install` (tryb copy) działa w projekcie bez `package.json` — np. repo w Pythonie, Go czy Rust — układając te same artefakty w `.claude/`.

### Guardrails

- **Idempotencja instalatora** — uruchomiony dwa razy daje ten sam wynik; nie duplikuje bloku reguł ani wpisów w `.npmrc` / `scripts`.
- **Brak sekretów w repo** — żaden trwały token nie trafia do repo-konsumenta ani do historii gita; linia z tokenem powstaje tylko przy instalacji ze zmiennej środowiskowej.
- **Łagodne obejście z istniejącymi plikami konsumenta** — instalator nie nadpisuje cudzych `scripts` w `package.json` ani treści `CLAUDE.md` spoza sentinel markerów; uszkodzony blok (jeden marker) jest wykrywany, nie duplikowany.
- **Publikacja duplikatu wersji** (błąd klasy 409 przy ręcznym podbijaniu) kończy się czytelnym błędem CI — nie cichym fail ani fałszywym sukcesem.

## Functional Requirements

### Repo źródła prawdy

- FR-001: Administrator can trzymać skille i reguły w jednym repo źródła prawdy, poukładane w foldery wg typu, i dodać nowy artefakt przez dorzucenie pliku plus podbicie wersji. Priority: must-have
  > Socrates: Rozważony kontrargument: „wspólne repo blokuje zespoły — każda drobna zmiana skilla to PR do centralnego repo w kolejce przeglądów". Rozstrzygnięcie: zostaje. MVP obsługuje jeden zespół w jednej organizacji (faza 1), skala `small` — monorepo artefaktów jest tu zaletą (jedno źródło prawdy), nie wąskim gardłem. Ryzyko realne dopiero przy wielu zespołach → OQ-3 jako sygnał do rewizji przy skalowaniu.

### Publikacja i wersjonowanie

- FR-002: Administrator can ręcznie podbić wersję paczki w `package.json` przed merge. Priority: must-have
  > Socrates: Rozważony kontrargument: „ręczne wersjonowanie zawsze w końcu daje konflikt 409 i pomijane release'y — automatyzacja od razu byłaby tańsza". Rozstrzygnięcie: przyjęte świadomie w fazie 3. FR-004 łagodzi objaw (czytelny błąd zamiast cichego fail), a migracja na automatyczne wersjonowanie jest już w OQ-1.

- FR-003: CI can opublikować paczkę do GitHub Packages po merge do gałęzi głównej — ale tylko gdy pliki wchodzące do paczki faktycznie zmieniły się między ostatnim tagiem a HEAD (kontrola `git diff` w CI) — uwierzytelniając się efemerycznym `GITHUB_TOKEN` bez trwałych sekretów w repo. Priority: must-have
  > Socrates: Rozważony kontrargument: „publikacja na każdy merge do main zaśmieca listę wersji — lepiej wyzwalać z tagu / Release". Rozstrzygnięcie: FR doprecyzowane — dodano bramkę `git diff` na pliki paczki, więc merge bez realnej zmiany treści nie generuje release'u. Wyzwalanie z tagu odrzucone jako dodatkowy ręczny krok sprzeczny z „bardzo łatwo" z kryteriów sukcesu.

- FR-004: CI can odrzucić próbę publikacji już istniejącej wersji z czytelnym błędem buildu. Priority: must-have
  > Socrates: Rozważony kontrargument: „to leczenie objawu — prawdziwym problemem jest ręczne wersjonowanie z FR-002". Rozstrzygnięcie: prawda, to objaw. Zostaje jako must-have dopóki wersjonowanie jest ręczne — czytelny błąd chroni przed cichym rozjechaniem wersji. Po migracji z OQ-1 ten FR traci znaczenie.

### Instalacja u konsumenta

- FR-005: Konsument can zaciągnąć paczkę przez `npm install` (tryb symlink) albo `npx @scope/ai-toolkit install` (tryb copy, działa też bez `package.json`). Priority: must-have
  > Socrates: Rozważony kontrargument: „dwa tryby podwajają powierzchnię testów i bugów — w MVP jeden by wystarczył". Rozstrzygnięcie: przyjęte świadomie w fazie 3. Copy jest obowiązkowy (ulotny cache `npx`), symlink daje wędrowanie artefaktów z repo. Ryzyko testowe adresują guardraile (idempotencja). Zachowanie symlink na Windows → OQ-4.

- FR-006: Instalator can idempotentnie dołożyć do `.npmrc` repo-konsumenta wyłącznie brakującą linię mapowania scope na GitHub Packages (bez modyfikacji istniejących wpisów rejestru) oraz linię auth tylko przy obecnej zmiennej środowiskowej, przy czym brak zmiennej lokalnie nie blokuje instalacji. Priority: must-have
  > Socrates: Rozważony kontrargument: „instalator grzebiący w `.npmrc` konsumenta wejdzie w konflikt z jego istniejącym mapowaniem rejestru". Rozstrzygnięcie: FR doprecyzowane — instalator dokłada tylko brakującą linię (`ensureLine`), nigdy nie nadpisuje istniejących wpisów. Zależność `echo`/bash na Windows → OQ-4.

- FR-007: Instalator can ułożyć każdy skill w `.claude/skills/<nazwa>/SKILL.md` w repo-konsumencie. Priority: must-have
  > Socrates: Rozważony kontrargument: „hardkodowana ścieżka `.claude/` zamyka w Claude Code — kłóci się z przenośnym SKILL.md". Rozstrzygnięcie: świadomy zakres MVP (faza 3: tylko Claude Code). Sam plik `SKILL.md` pozostaje przenośny — zmienia się tylko katalog docelowy, co v2 rozwiąże profilami narzędzi (OQ-2). Kolizja nazw skilli z artefaktami konsumenta → OQ-5.

- FR-008: Instalator can wstrzyknąć blok reguł zespołu do `CLAUDE.md` między parę sentinel markerów, nie ruszając treści poza nimi. Priority: must-have
  > Socrates: Rozważony kontrargument: „reguła, której treść sama zawiera sentinel markery, przy kolejnym install skasuje treść konsumenta spoza bloku — trzeba guard na injection". Rozstrzygnięcie: realne → dodano FR-014.

- FR-009: Instalator can zapisać manifest z nazwą paczki, wersją, narzędziem docelowym i pełną listą wgranych plików. Priority: must-have
  > Socrates: Rozważony kontrargument: „manifest rozjedzie się z rzeczywistością, gdy ktoś ręcznie ruszy wgrany plik — deinstalacja i tak będzie zgadywać". Rozstrzygnięcie: zostaje. Manifest jest wciąż najlepszym dostępnym źródłem prawdy dla deinstalacji (lepszym niż zgadywanie po katalogu); niespójność obsługuje FR-013. Polityka commit vs ignore manifestu → OQ-6.

### Aktualizacja i deinstalacja

- FR-010: Konsument can zaktualizować paczkę i dostać nową treść artefaktów oraz podmieniony blok reguł, z zachowaniem treści `CLAUDE.md` spoza sentinel markerów, przy czym instalator usuwa też artefakty wycofane z paczki (porównanie manifestu poprzedniej i nowej wersji). Priority: must-have
  > Socrates: Rozważony kontrargument: „update podmienia i dodaje, ale nie usuwa skilla wycofanego z paczki — u konsumenta zostają martwe artefakty". Rozstrzygnięcie: realna luka → FR rozszerzony o usuwanie wycofanych artefaktów na podstawie porównania manifestów.

- FR-011: Konsument can zdeinstalować paczkę, przy czym deinstalator czyta manifest i usuwa dokładnie te pliki, które dodał, niezależnie od obecności `node_modules`. Priority: must-have
  > Socrates: Rozważony kontrargument: „deinstalacja niezależna od hooków npm znaczy, że konsument musi ją odpalić ręcznie — większość zapomni i zostawi śmieci". Rozstrzygnięcie: samodzielny manifest to celowa własność (hooki bywają pomijane przy usuwaniu zależności). Best-effort hook `npm` jako uzupełnienie → OQ-7.

### Stany brzegowe

- FR-012: Instalator can wykryć uszkodzony blok reguł (jeden marker obecny, drugi zniknął), przerwać z czytelnym komunikatem wskazującym plik i miejsce, i nie próbować naprawy bloku w MVP. Priority: must-have
  > Socrates: Rozważony kontrargument: „to rzadki edge case — w MVP wystarczy wykryć, wypisać błąd i przerwać, zamiast implementować naprawę". Rozstrzygnięcie: FR złagodzony — wykrycie + czytelny błąd + STOP; naprawa bloku poza zakresem MVP.

- FR-013: Deinstalator can przy uszkodzonym manifeście zostawić pliki nietknięte i wypisać listę plików, które usunąłby, żeby konsument mógł posprzątać ręcznie. Priority: nice-to-have
  > Socrates: Rozważony kontrargument: „'zostaw pliki' bez trybu `--force` zostawia konsumenta z martwą deinstalacją i żadną ścieżką naprzód". Rozstrzygnięcie: FR rozszerzony — deinstalator wypisuje listę kandydatów do ręcznego usunięcia (ścieżka wyjścia bez `--force`). Pozostaje nice-to-have.

- FR-014: Instalator can odmówić zapisania reguły, której treść sama zawiera sentinel markery paczki, i przerwać z ostrzeżeniem (guard na sentinel-injection). Priority: must-have
  > Socrates: Dodany w wyniku rundy Sokratesa nad FR-008. Wprost z lekcji: bez tego guardu podrzucony marker w treści reguły przy kolejnym install zostałby wzięty za prawdziwy i skasował treść konsumenta spoza bloku.

## User Stories

### US-01: Administrator publikuje nową wersję skilla

- **Given** administrator z uprawnieniem `write` do repo źródła prawdy i wcześniej opublikowaną wersją paczki
- **When** zmienia treść `skills/code-review/SKILL.md`, podbija wersję w `package.json` i merge'uje PR do gałęzi głównej
- **Then** workflow GitHub Actions buduje paczkę i publikuje nową wersję do GitHub Packages w ramach jednego przebiegu

#### Acceptance Criteria

- Publikacja używa efemerycznego `GITHUB_TOKEN`; w repo ani w logach nie pojawia się trwały sekret
- Struktura opublikowanej paczki zawiera `package.json`, `install.js`, `uninstall.js`, `skills/`, `rules/`, `.github/workflows/`
- Merge bez podbicia wersji (wersja już w rejestrze) kończy się czerwonym buildem z czytelnym komunikatem, nie cichym pominięciem
- Nowa wersja jest widoczna na liście wersji paczki w GitHub Packages

### US-02: Konsument instaluje i aktualizuje paczkę bez utraty własnych reguł

- **Given** repo-konsument w tej samej organizacji, z istniejącym `CLAUDE.md` zawierającym własne dopiski dewelopera
- **When** deweloper dodaje `@scope/ai-toolkit` do zależności, ustawia mapowanie scope w `.npmrc` i uruchamia `npm install`, a po wydaniu nowej wersji `npm update`
- **Then** skille lądują w `.claude/skills/<nazwa>/SKILL.md`, blok reguł zespołu jest wstawiony/podmieniony między sentinel markerami w `CLAUDE.md`, a dopiski dewelopera poza markerami pozostają nietknięte

#### Acceptance Criteria

- Powtórny `install` na czystym drzewie nie generuje żadnego diffa (idempotencja)
- Brak zmiennej środowiskowej z tokenem lokalnie nie przerywa instalacji
- `npx @scope/ai-toolkit install` w repo bez `package.json` (np. Python) układa te same artefakty w `.claude/`
- Manifest `.claude/.<...>-manifest.json` zawiera nazwę paczki, wersję, `tool: claude-code` i pełną listę plików
- `npm uninstall` / `npx ... uninstall` usuwa dokładnie pliki z manifestu; `git status` po deinstalacji nie pokazuje pozostałości paczki

## Non-Functional Requirements

- Uruchomienie instalatora dwa razy z rzędu na tym samym wejściu nie wprowadza żadnej różnicy w drzewie plików projektu konsumenta ani w treści manifestu względem pierwszego uruchomienia — `git diff` po drugim przebiegu pokazuje zero zmian.
- Po dowolnej operacji instalatora (instalacja, aktualizacja, deinstalacja) w projekcie konsumenta ani w jego historii gita nie występuje trwały token dostępu; jedyny wpis z tokenem powstaje ulotnie ze zmiennej środowiskowej na czas instalacji i nie trafia do commita.

> Pozostałe właściwości obserwowalne (nienaruszalność treści człowieka w `CLAUDE.md`, kompletna deinstalacja, czytelne komunikaty stanów odmowy, zgodność Linux/macOS/Windows) są przypięte bezpośrednio przez FR-008 / FR-010 / FR-011 / FR-012 / FR-014, guardraile w Success Criteria oraz OQ-4 — nie powielamy ich jako osobnych NFR.

## Business Logic

Instalator uzgadnia stan artefaktów AI w projekcie konsumenta z wybraną opublikowaną wersją paczki, wprowadzając wyłącznie zmiany, które należą do tej wersji lub które sam wcześniej wykonał, i nigdy nie nadpisując treści wprowadzonej przez człowieka.

Wejścia (od strony użytkownika): którą wersję paczki wybrał; jaki jest obecny stan jego projektu, w tym plik reguł z własnymi dopiskami i ewentualne artefakty z poprzedniej instalacji; jakim poleceniem uruchomił operację (instalacja, aktualizacja, deinstalacja) i w jakim trybie — wędrującym razem z repozytorium albo jako samodzielna kopia.

Wyjście: zestaw plików artefaktów w miejscach, w których szuka ich narzędzie AI użytkownika; blok reguł zespołu wstawiony lub podmieniony w obrębie własnych znaczników granicznych; zapis (manifest) opisujący dokładnie, co zostało wprowadzone, tak aby późniejsza aktualizacja lub deinstalacja mogła cofnąć dokładnie te zmiany, łącznie z usunięciem artefaktów wycofanych z nowej wersji.

Jak użytkownik to spotyka: uruchamia jedno polecenie i dostaje przewidywalny wynik — nowe i zmienione artefakty na swoim miejscu, własne notatki w pliku reguł nietknięte, a po deinstalacji projekt czysty; powtórzenie tego samego polecenia niczego nie psuje ani nie dubluje. Po stronie wydawcy obowiązuje reguła odwrotna: nowa wersja paczki powstaje tylko wtedy, gdy zawartość artefaktów faktycznie różni się od ostatniej wydanej — sama zmiana w repozytorium bez zmiany plików paczki nie tworzy wydania.

## Non-Goals

### Funkcjonalne

- **Rejestr jako infrastruktura chmurowa** (AWS CodeArtifact, Terraform, Nexus, Verdaccio) — obecne projekty nie używają infry chmurowej; GitHub Packages nie wymaga stawiania niczego. Model 2 z lekcji poza zakresem.
- **Pełny produkt z własnym API i CLI**, podpisywaniem paczek (Ed25519) i dawkowaniem treści w czasie — GitHub Packages pokrywa potrzebę; budowanie Modelu 3 to dystrybucja pod CV.
- **Profile dla narzędzi innych niż Claude Code** (Cursor, Codex) — inne katalogi docelowe i pliki reguł; odłożone do v2 (OQ-2).
- **Automatyczne wersjonowanie semantyczne** (semantic-release / release-please) — MVP robi ręczne podbijanie wersji w `package.json` (OQ-1).
- **Konsumenci spoza organizacji**, przepływ z trwałym PAT i synchronizacja tokena do obcych platform buildów (Cloudflare itp.) — MVP obsługuje tylko repo w tej samej organizacji GitHub.
- **Foldery `prompts/` i `config-templates/`** w paczce — MVP obsługuje wyłącznie `skills/` i `rules/`.
- **Marketplace narzędzia** (Claude Code / Cursor plugin marketplace) jako kanał dystrybucji — vendor lock-in; kanałem jest rejestr pakietów.
- **Wstrzykiwanie reguł do plików innych niż `CLAUDE.md`** (`AGENTS.md`, `.cursor/rules/*.mdc`) — poza zakresem MVP; wiąże się z OQ-2.

### Niefunkcjonalne

- **Brak celu SLA / pomiaru dostępności rejestru** — polegamy na dostępności GitHub Packages, nie mierzymy jej ani nie definiujemy budżetu błędu.
- **Brak wsparcia dla wielu zespołów / wielu paczek artefaktów** — jedno repo źródła prawdy, jeden pakiet; podział przy skalowaniu to OQ-3.

## Open Questions

1. **OQ-1 Migracja na automatyczne wersjonowanie** — MVP używa ręcznego podbijania wersji w `package.json`. Kiedy przejść na `semantic-release` / `release-please` + pełną kontrolę `git diff`? Owner: administrator paczki. Nieblokujące dla MVP.
2. **OQ-2 Rozszerzenie multi-tool** — MVP celuje tylko w Claude Code. Dodanie profili Cursor / Codex (inne katalogi docelowe, inny plik reguł) to v2. Owner: administrator paczki. Nieblokujące dla MVP.
3. **OQ-3 Skalowanie do wielu zespołów** — jedno wspólne repo źródła prawdy sprawdza się dla jednego zespołu; przy wielu zespołach rozważyć podział wg domeny/zespołu lub osobne paczki. Owner: administrator paczki. Nieblokujące dla MVP.
4. **OQ-4 Zachowanie na Windows** — tryb symlink (uprawnienia / Developer Mode) oraz warunkowa linia auth oparta na `echo`/bash wymagają weryfikacji na czystym Windows bez shella POSIX. Owner: administrator paczki. Do rozstrzygnięcia przed wydaniem MVP.
5. **OQ-5 Kolizja nazw skilli** — co robi instalator, gdy skill z paczki ma tę samą nazwę co istniejący skill konsumenta (ostrzeżenie? prefiks scope? przerwanie?). Owner: administrator paczki. Do rozstrzygnięcia przed wydaniem MVP.
6. **OQ-6 Polityka manifestu w repo konsumenta** — czy `.claude/.<...>-manifest.json` ma być commitowany, czy dodany do `.gitignore`? Rekomendacja do README. Owner: administrator paczki. Nieblokujące dla MVP.
7. **OQ-7 Best-effort hook deinstalacji** — czy dołożyć hook `npm` (`preuninstall`) jako uzupełnienie manifestowej deinstalacji, wiedząc, że hooki bywają pomijane? Owner: administrator paczki. Nieblokujące dla MVP.

## Forward: tech-stack

_Nie jest częścią schematu PRD. Materiał dla następnego kroku łańcucha (`/10x-tech-stack-selector` / bootstrap)._

- Domena wymusza ekosystem: pakiet **npm** publikowany do **GitHub Packages**, pipeline na **GitHub Actions**. Instalator/deinstalator jako skrypty pakietu (`install.js` / `uninstall.js`). To nie jest otwarty wybór stacku — wynika z „Model 1" i z tego, że zespół siedzi na GitHubie.
- Konsument opt-in przez `.npmrc` (mapowanie scope) + tryb `npx` dla repo bez `package.json`.
- **Materiały bazowe wskazane w `requirements.md`** (do adaptacji, nie przepisania 1:1): skille `m5l4-shared-conventions.md`, `m5l4-shared-spec-skill.md`, `m5l4-github-packages-spec-pack.md`, `m5l4-github-packages-spec-cicd.md`; szablony `m5l4-github-packages-package.json.template`, `m5l4-github-packages-install.js.template`, `m5l4-github-packages-uninstall.js.template`, `m5l4-github-packages-consumer.npmrc.template`, `m5l4-github-packages-publish-ai-toolkit.yml.template`.
- Skille wspierające ścieżkę (opcjonalne): `/pack-init` (szkielet paczki), `/setup-cicd` (pipeline publikacji). `/tf-registry` dotyczy Modelu 2 — pominąć.
- Docelowa struktura paczki (z `requirements.md`): `package.json`, `install.js`, `uninstall.js`, `skills/code-review/SKILL.md`, `rules/CLAUDE.md`, `.github/workflows/publish-ai-toolkit.yml`.
