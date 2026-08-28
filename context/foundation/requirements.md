## 10xPackages - MVP

### Główny problem
Trzymanie w jednym miejscu - repozytorium - wszystkich plików związanych z AI - skillów, promptów itd. Wybrani użytkownicy i wybrane projekty mogą w rezie potrzeby pobierać i używać tych zasobów. Ma to umożliwiać łatwe zarządzanie wersjami tych zasobów i trzymanie porządku. To repozytorium ma też być jednym źródłem prawdy.

### Najmniejszy zestaw funkcjonalności
- Zasoby związane z AI trzymane w jednym miejscu
- Wybrane repozytorium to Github Packages. Zostało ono wybrane dlatego, że projekty znajdują się na Github oraz większość programistów jest zaznajomionych z Github
- Paczka trzymana w Github Packages ma mieć określoną strukturę
- To wymaganie wynika z sekcji "Zadanie praktyczne" z pliku "C:\git-repositories\10xpackages\m5l4-shared-ai-registry-skille-komendy-i-reguly-dla-zespolu.md"
- Jako baza GitHub Packages powinny być użyte następujące skille: m5l4-shared-conventions.md, m5l4-shared-spec-skill.md, m5l4-github-packages-spec-pack.md, m5l4-github-packages-spec-cicd.md oraz template'y m5l4-github-packages-package.json.template, m5l4-github-packages-install.js.template, m5l4-github-packages-uninstall.js.template, m5l4-github-packages-consumer.npmrc.template i m5l4-github-packages-publish-ai-toolkit.yml.template. 
- 

### Co NIE wchodzi w zakres MVP
- W zakres MVP nie wchodzi repozytorium jako infrastruktura chmurowa - na przykład AWS CodeArtifact. Obecne projekty nie używają infrastruktury chmurowej
- W zakres MVP nie wchodzi API i CLI - nie ma powodu implementować tego rozwiązania, skoro jest dostępny Github Packages. Byłaby to niepotrzebna praca

### Kryteria sukcesu
- Paczka z określoną strukturą jest trzymana w Github Packages
- Administrator paczki bardzo łatwo może uaktualniać jej zawartość i zarządzać jej wersjami
- Użytkownik paczki bardzo łatwo może pobrać nową wersję paczki

### Struktura paczki
ai-toolkit/
├── package.json
├── install.js
├── uninstall.js
├── skills/
│   └── code-review/
│       └── SKILL.md
├── rules/
│   └── CLAUDE.md
└── .github/
    └── workflows/
        └── publish-ai-toolkit.yml


