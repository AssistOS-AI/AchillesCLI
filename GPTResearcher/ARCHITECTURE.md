# GPTResearcher Agent Architecture

## Rolul agentului

GPTResearcher este un agent Ploinky care ruleaza GPT Researcher si il integreaza cu infrastructura locala a workspace-ului.

Agentul are doua moduri principale de folosire:

- UI-ul oficial GPT Researcher, pentru interactiune vizuala din browser.
- Tool-uri MCP, pentru apeluri controlate din alti agenti Ploinky.

In ambele cazuri, modelele LLM si embeddings sunt trimise prin Soul Gateway, iar web search-ul este trimis prin SearchAgent. Agentul nu foloseste direct chei de model in fisiere de configurare.

## Componente

La instalare, agentul creeaza un virtual environment Python in:

```text
/opt/gpt-researcher-venv
```

In acest environment este instalat pachetul `gpt-researcher` impreuna cu dependintele necesare.

Agentul instaleaza si aplicatia oficiala GPT Researcher in:

```text
/opt/gpt-researcher-app
```

La start, scriptul `/code/scripts/start-gpt-researcher.sh` porneste aplicatia oficiala GPT Researcher si apoi porneste Ploinky AgentServer. AgentServer citeste `mcp-config.json` si expune tool-urile MCP ale agentului.

`PYTHONPATH` include `/code/scripts`, astfel incat Python incarca `sitecustomize.py`. Acest hook aplica aceleasi setari si patch-uri GPT Researcher care sunt folosite si de tool-ul MCP `start_research`.

## Setari persistente

Setarile agentului sunt salvate intr-un singur fisier JSON:

```text
$HOME/gpt-researcher-settings.json
```

In container, `$HOME` este root-ul persistent al agentului (`/root`). In Ploinky, acest root este mapat pe host in:

```text
.data/GPTResearcher
```

Deci fisierul de settings apare pe host ca:

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
  "searchProvider": "duckduckgo",
  "reportSource": "web"
}
```

Daca fisierul lipseste, codul foloseste valorile default de mai sus. La install, fisierul este creat doar daca nu exista deja.

Cheile API, tokenurile Ploinky si secretele providerilor nu se salveaza in acest fisier.

## Settings UI

Modalul de settings din IDE este implementat de pluginul:

```text
IDE-plugins/gpt-researcher-settings
```

Pluginul nu scrie direct pe disk. El apeleaza tool-urile MCP:

- `gpt_researcher_get_settings`
- `gpt_researcher_update_settings`
- `gpt_researcher_list_models`

Lista de modele vine din Soul Gateway. Lista de provideri de search vine din SearchAgent. In UI se pot seta:

- Fast LLM
- Smart LLM
- Strategic LLM
- Embedding
- Search Provider
- Report Source

Pentru `Search Provider`, modalul afiseaza si variabilele de environment cerute de providerul selectat, asa cum sunt raportate de SearchAgent prin `/listProviders`.

`Report Source` poate fi:

- `web`: foloseste doar surse de pe internet prin SearchAgent.
- `local`: foloseste doar documentele locale din `DOC_PATH`.
- `hybrid`: combina documentele locale cu web search prin SearchAgent.

## Configurarea GPT Researcher la runtime

Setarile persistente sunt aplicate inainte de crearea instantei GPT Researcher.

Modelele sunt transformate in variabilele asteptate de GPT Researcher:

```text
FAST_LLM=soul_gateway:<fastLlm>
SMART_LLM=soul_gateway:<smartLlm>
STRATEGIC_LLM=soul_gateway:<strategicLlm>
EMBEDDING=soul_gateway:<embedding>
RETRIEVER=search_agent
SEARCH_AGENT_PROVIDER=<searchProvider>
```

Providerul `soul_gateway` este adaugat prin patch local in `soul_gateway.py`. Acest provider trimite chat completions si embeddings catre Soul Gateway prin routerul Ploinky si foloseste `PLOINKY_AGENT_API_KEY` ca autorizare.

Retrieverul `search_agent` este tot un patch local. El trimite cereri de search catre SearchAgent prin routerul Ploinky. Payload-ul principal este:

```json
{
  "provider": "<searchProvider>",
  "query": "<query>",
  "maxResults": 5
}
```

SearchAgent intoarce rezultate standardizate, iar acest agent le adapteaza la forma asteptata de GPT Researcher (`title`, `href`, `url`, `body`, `content`).

## Search prin SearchAgent

GPTResearcher nu apeleaza direct Tavily, Brave, DuckDuckGo sau alti provideri de search. Pentru web search, agentul foloseste intotdeauna SearchAgent.

Providerul ales in settings (`searchProvider`) este transmis catre SearchAgent la fiecare cautare. SearchAgent este responsabil pentru:

- alegerea providerului concret de search;
- citirea cheilor de provider din environment-ul lui;
- apelarea API-ului providerului;
- normalizarea raspunsului la forma standard `{ results: [...] }`.

GPTResearcher primeste inapoi doar rezultatele normalizate si le transforma in formatul asteptat de libraria `gpt-researcher`.

Query-ul trimis catre SearchAgent este query-ul generat de GPT Researcher in timpul pipeline-ului sau de research. Lista de fisiere locale nu este lipita in acest query. Daca `reportSource=local`, GPT Researcher foloseste documentele din `DOC_PATH`; daca `reportSource=hybrid`, foloseste atat `DOC_PATH`, cat si web search prin SearchAgent.

## Flow-ul tool-ului `start_research`

Tool-ul MCP `start_research` ruleaza:

```text
/opt/gpt-researcher-venv/bin/python /code/scripts/start-research.py
```

Input-ul important este:

- `query`: cererea de research trimisa curat catre GPT Researcher.
- `moreContext`: camp optional, pastrat in raspuns, dar nefolosit momentan in query sau search.
- `reportType`: tipul raportului GPT Researcher; default `research_report`.
- `workingDir`: director din `WORKSPACE_PATH` unde se cauta documente locale si unde se salveaza raportul.

`workingDir` trebuie sa fie in interiorul `WORKSPACE_PATH`. Daca lipseste, se foloseste radacina `WORKSPACE_PATH`. Directorul este creat daca nu exista.

Inainte de research, agentul seteaza:

```text
DOC_PATH=<workingDir>
```

Instanta GPT Researcher este creata cu:

```python
GPTResearcher(
    query=query,
    report_type=report_type,
    report_source=settings["reportSource"],
)
```

Agentul nu concateneaza lista de fisiere locale in query. Query-ul trimis la GPT Researcher ramane query-ul primit de tool. GPT Researcher decide apoi sub-query-urile si apelurile de search conform propriului pipeline.

## Documente locale si rapoarte

Documentele locale sunt citite de GPT Researcher prin `DOC_PATH`, care pointeaza la `workingDir`.

Semantica `reportSource` este:

- `web`: `DOC_PATH` este setat, dar GPT Researcher foloseste doar web search.
- `local`: GPT Researcher incarca documentele din `DOC_PATH` si foloseste context local.
- `hybrid`: GPT Researcher incarca documentele din `DOC_PATH` si face si web search.

Raportul final este salvat in `workingDir` cu nume generat din timestamp si query:

```text
gpt-researcher-<timestamp>-<query-slug>.md
```

Raspunsul tool-ului include raportul, calea fisierului salvat, sursele, costurile daca sunt disponibile, fisierele gasite in `workingDir` si un tail de log.

## Date persistente

Agentul foloseste doua zone diferite de date:

- `$HOME` pentru datele persistente ale agentului. Aici se afla `gpt-researcher-settings.json`, iar pe host corespunde cu `.data/GPTResearcher`.
- `WORKSPACE_PATH` pentru fisierele de lucru ale utilizatorului. Aici se afla `workingDir`, documentele locale si rapoartele generate.

Aceasta separare este intentionata: setarile agentului sunt date ale agentului, iar rapoartele si documentele sunt date ale workspace-ului de lucru.

## Tool-uri MCP

Agentul expune urmatoarele tool-uri:

- `start_research`: porneste un research GPT Researcher si salveaza raportul.
- `gpt_researcher_get_settings`: citeste setarile persistente.
- `gpt_researcher_update_settings`: salveaza setarile persistente.
- `gpt_researcher_list_models`: listeaza modelele Soul Gateway si providerii SearchAgent pentru UI.

`start_research` este marcat `internal`, fiind destinat apelurilor agent-to-agent. Tool-urile de settings sunt folosite de pluginul IDE.

## Reguli operationale

Setarile de model si search trebuie schimbate prin fisierul persistent sau prin modalul IDE, nu prin editarea codului.

`moreContext` exista pentru extensii viitoare, dar nu trebuie tratat ca sursa activa de search.

Pentru research pe documente locale, foloseste `reportSource=local` sau `reportSource=hybrid`. `reportSource=web` ignora documentele locale chiar daca `DOC_PATH` este setat.

Pentru debugging, logurile importante sunt emise de scriptul `start_research` si includ `queryChars`, `reportType`, `reportSource`, modelele alese si providerul de search.
