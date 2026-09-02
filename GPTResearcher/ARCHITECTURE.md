# GPTResearcher Agent Architecture

## Rolul agentului

GPTResearcher este un agent Ploinky care ruleaza libraria GPT Researcher si o conecteaza la infrastructura locala:

- modelele LLM si embeddings merg prin Soul Gateway;
- web search-ul merge prin SearchAgent;
- rapoartele generate se salveaza in workspace-ul cererii.

Agentul poate fi folosit prin UI-ul oficial GPT Researcher sau prin tool-uri MCP. Integrarea principala cu AchillesCLI foloseste tool-ul MCP `start_research`.

## Componente

La instalare, agentul creeaza un virtual environment Python in:

```text
$HOME/gpt-researcher/venv
```

Aplicatia oficiala GPT Researcher este instalata in:

```text
$HOME/gpt-researcher/app
```

La start, `/code/scripts/start-gpt-researcher.sh` porneste aplicatia oficiala si apoi Ploinky AgentServer. AgentServer citeste `mcp-config.json` si expune tool-urile MCP.

`PYTHONPATH` include `/code/scripts`, deci Python incarca `sitecustomize.py`. Acest hook aplica patch-urile locale pentru Soul Gateway si SearchAgent si seteaza aceleasi modele pe care le foloseste si tool-ul `start_research`.

## Setari persistente

Setarile agentului sunt salvate in:

```text
$HOME/gpt-researcher-settings.json
```

Ploinky configures `$HOME` as the agent's persistent home and maps it on the host under:

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
/bin/sh /code/scripts/run-research.sh
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
