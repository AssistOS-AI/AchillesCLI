# GPTResearcher Agent Architecture

## Rolul agentului

GPTResearcher este un agent Ploinky care ruleaza libraria GPT Researcher si o conecteaza la infrastructura locala:

- modelele LLM si embeddings merg prin Soul Gateway;
- web search-ul merge prin SearchAgent;
- rapoartele generate se salveaza in workspace-ul cererii.

Agentul poate fi folosit prin UI-ul oficial GPT Researcher sau prin tool-uri MCP. Integrarea principala cu AchillesCLI foloseste tool-ul MCP `start_research`.

## Contract de rutare v5

Aplicatia browser este un target HTTP privat pe portul `8000`, declarat prin
serviciul `gpt-researcher` si montat exclusiv sub
`/services/gpt-researcher/`. Adapterul ASGI respinge cererile din afara
prefixului, rescrie linkurile, asset-urile si redirecturile root-relative si nu
expune originea privata. Raspunsurile sunt transmise incremental: adapterul
rescrie numai continut textual, pastreaza granitele corecte intre chunk-uri si
nu buffer-eaza SSE sau continut binar pana la inchiderea upstream-ului.

Pluginul Explorer obtine locatorul activ din proiectia autentificata, `no-store`,
a topologiei Ploinky. Nu construieste domenii din id-ul agentului si nu retine
un URL de startup. Un selector inactiv sau o generatie invalida esueaza inchis.

Sursa oficiala este instalata numai la commit-ul imuabil
`5cdad9cb434754188b78bd998df18dd8d502cf7e`, iar fisierul upstream
`requirements.txt` trebuie sa aiba SHA-256
`f8c36b147c9f53d96bd20f41df303943889ac90323603285fafe97dcc9a84b60`.
Imaginea de baza este fixata prin digest.

Dependentele Python nu sunt rezolvate la instalare. Intrarea de rezolvare este
`scripts/gpt-researcher-requirements.in`, iar toate cele 196 de pachete
tranzitive sunt fixate cu hash-uri de artefact in
`scripts/gpt-researcher-requirements.lock` (SHA-256
`3c81338133667f49c3c7366b36c943f9e456663faa27eb3486bf8fd7bf08f6bb`).
Frontend-ul de build pentru cele trei dependente fara wheel este separat in
`scripts/gpt-researcher-bootstrap.lock` (SHA-256
`4e5068e06240daf19cf2ca08370a5413e5af634d3a3cb70198cfe4b0b9289386`).
Ambele rezolvari de aplicatie, pentru `linux/x86_64` si `linux/aarch64`, trebuie
sa fie byte-identice pentru CPython `3.11.2`; orice alta platforma sau versiune
Python este respinsa.

Instalarea foloseste numai lock-urile cu `pip --require-hashes --isolated`, fara
cache si fara bytecode. Checkout-ul este verificat prin commit, origine,
`git fsck`, tip/mod/exact Git blob pentru fiecare fisier si absenta oricarui
fisier sau director neinregistrat, apoi este sigilat read-only. Markerul v5 leaga
schema, commit-ul, hash-urile lock-urilor, runtime-ul, configuratia venv,
politica de runtime si digestul complet al mediului instalat. La reutilizare se
reverifica toate aceste elemente si `pip check` inainte de executie.

Un checkout, venv sau marker existent care nu corespunde exact contractului v5
este refuzat si cere stergerea explicita a ambelor directoare plus recrearea
agentului. Nu exista reparare, upgrade automat, rezolvare de dependente, cleanup
sau fallback la o ramura ori la un artefact flotant.

## Componente

La instalare, agentul creeaza un virtual environment Python in:

```text
/opt/gpt-researcher-venv
```

Aplicatia oficiala GPT Researcher este instalata in:

```text
/opt/gpt-researcher-app
```

La start, `/code/scripts/start-gpt-researcher.sh` porneste aplicatia oficiala
prin adapterul de base path si Ploinky AgentServer sub acelasi supervisor.
Terminarea oricarui proces opreste si celalalt proces, astfel incat un UI sau
AgentServer orfan nu poate ramane disponibil. AgentServer citeste
`mcp-config.json` si expune tool-urile MCP.

`PYTHONPATH` include `/code/scripts`, deci Python incarca `sitecustomize.py`. Acest hook aplica patch-urile locale pentru Soul Gateway si SearchAgent si seteaza aceleasi modele pe care le foloseste si tool-ul `start_research`.

## Setari persistente

Setarile agentului sunt salvate in:

```text
$HOME/gpt-researcher-settings.json
```

In container, `$HOME` este root-ul persistent al agentului (`/root`). In Ploinky, acest root este mapat pe host in:

```text
.data/GPTResearcher
```

Pe host, fisierul apare ca:

```text
.data/GPTResearcher/gpt-researcher-settings.json
```

Fisierul contine doar setari non-secret:

```json
{
  "fastLlm": "codex-api/gpt-5.4-mini",
  "smartLlm": "codex-api/gpt-5.5",
  "strategicLlm": "codex-api/gpt-5.4-mini",
  "embedding": "codestral-embed",
  "searchProvider": "searxng"
}
```

Daca fisierul lipseste, codul foloseste valorile default. La install, fisierul este creat doar daca nu exista deja. Cheile API, tokenurile Ploinky si secretele providerilor nu se salveaza aici.

## Settings UI

Modalul de settings din IDE este implementat in:

```text
IDE-plugins/gpt-researcher-settings
```

Pluginul nu scrie direct pe disk. El apeleaza tool-urile MCP:

- `gpt_researcher_get_settings`
- `gpt_researcher_update_settings`
- `gpt_researcher_list_models`

In UI se pot seta modelele `fastLlm`, `smartLlm`, `strategicLlm`, modelul de `embedding`, si providerul SearchAgent folosit pentru web research. Lista de modele vine din Soul Gateway; lista de provideri de search este derivata din modelele SearchAgent sincronizate in Soul Gateway si marcate cu tagul `search`.

UI-ul GPTResearcher configureaza doar providerul de search selectat. Cheile API ale providerilor raman in SearchAgent Settings si nu sunt afisate in GPTResearcher.

## Configurare la runtime

Setarile persistente sunt aplicate inainte de crearea instantei GPT Researcher:

```text
FAST_LLM=soul_gateway:<fastLlm>
SMART_LLM=soul_gateway:<smartLlm>
STRATEGIC_LLM=soul_gateway:<strategicLlm>
EMBEDDING=soul_gateway:<embedding>
SEARCH_AGENT_PROVIDER=<searchProvider>
RETRIEVER=search_agent
```

Providerul `soul_gateway` este adaugat prin patch local in `soul_gateway.py`. El trimite chat completions si embeddings catre Soul Gateway prin routerul Ploinky.

Retrieverul `search_agent` este adaugat prin patch local in `search_agent.py`. El trimite cererile de web search catre SearchAgent prin MCP, folosind tool-ul `search_agent_search`.

## Search prin SearchAgent

GPTResearcher nu apeleaza direct Tavily, Brave, DuckDuckGo sau alti provideri. Pentru web search, foloseste intotdeauna SearchAgent.

Providerul de search este setare persistenta GPTResearcher (`searchProvider`). GPTResearcher trimite catre SearchAgent providerul, query-ul si limita de rezultate; SearchAgent citeste secretele proprii din mediul sau si normalizeaza raspunsurile.

Query-ul trimis catre SearchAgent este query-ul generat de pipeline-ul GPT Researcher. Lista de fisiere locale nu este lipita in query.

## Flow-ul `start_research`

Tool-ul MCP `start_research` ruleaza:

```text
/opt/gpt-researcher-venv/bin/python /code/scripts/start-research.py
```

Input-ul important este:

- `query`: cererea de research trimisa curat catre GPT Researcher.
- `context`: instructiuni sau date optionale pentru task-ul de research. `query` ramane query-ul principal folosit pentru web research.
- `reportType`: tipul raportului GPT Researcher; default `research_report`.
- `workingDir`: director din `WORKSPACE_PATH` unde se salveaza raportul.
- `useLocalDocs`: boolean optional care decide daca `workingDir` este folosit ca sursa de documente locale.

`workingDir` trebuie sa fie in interiorul `WORKSPACE_PATH`. Daca lipseste, se foloseste radacina `WORKSPACE_PATH`. Directorul este creat daca nu exista.

Semantica `useLocalDocs` este:

- lipseste sau `true`: agentul seteaza `DOC_PATH=<workingDir>` si creeaza GPT Researcher cu `report_source="hybrid"` cand exista fisiere locale in `workingDir`; daca nu exista fisiere locale, face fallback automat la `report_source="web"`;
- `false`: agentul nu seteaza `DOC_PATH` si creeaza GPT Researcher cu `report_source="web"`.

Instanta GPT Researcher este creata cu:

```python
GPTResearcher(
    query=query,
    report_type=report_type,
    report_source=report_source,
)
```

Agentul nu concateneaza fisierele locale sau lista de fisiere in query. GPT Researcher decide sub-query-urile si apelurile de search conform propriului pipeline. Daca `context` este prezent, agentul il paseaza separat catre GPT Researcher ca instructiuni/context pentru raport.

## Documente locale si rapoarte

Cand `useLocalDocs` este `true` sau lipseste si exista fisiere locale, documentele locale sunt citite de GPT Researcher prin `DOC_PATH`, care pointeaza la `workingDir`. Cand `useLocalDocs` este `false` sau `workingDir` nu contine fisiere locale, research-ul este web-only si documentele locale nu sunt expuse.

Raportul final este salvat in `workingDir` cu nume generat din timestamp si query:

```text
gpt-researcher-<timestamp>-<query-slug>.md
```

Raspunsul tool-ului include raportul, calea fisierului salvat, sursele, costurile daca sunt disponibile, fisierele locale folosite cand exista si un tail de log.

## Date persistente

Agentul foloseste doua zone de date:

- `$HOME`: date persistente ale agentului, inclusiv `gpt-researcher-settings.json`; pe host corespunde cu `.data/GPTResearcher`.
- `WORKSPACE_PATH`: fisierele de lucru ale utilizatorului, documentele locale si rapoartele generate.

Aceasta separare este intentionata: setarile sunt date ale agentului, iar documentele si rapoartele sunt date ale workspace-ului de lucru.

## Tool-uri MCP

Agentul expune:

- `start_research`: porneste un research GPT Researcher si salveaza raportul.
- `gpt_researcher_get_settings`: citeste setarile persistente.
- `gpt_researcher_update_settings`: salveaza setarile persistente.
- `gpt_researcher_list_models`: listeaza modelele Soul Gateway si deriveaza providerii SearchAgent din modelele marcate cu tagul `search` pentru UI.

`start_research` este marcat `internal`, fiind destinat apelurilor agent-to-agent. Tool-urile de settings sunt folosite de pluginul IDE.

## Reguli operationale

Setarile de model si search se schimba prin fisierul persistent sau prin modalul IDE, nu prin editarea codului.

Pentru a controla documentele locale din AchillesCLI, foloseste parametrul skillului `useLocalDocs`. Default-ul este `true`, deci research-ul este hybrid daca parametrul lipseste.

Pentru debugging, logurile importante sunt emise de `start_research` si includ `queryChars`, `reportType`, `reportSource`, `useLocalDocs`, modelele alese si `searchProvider`.
