# GPTResearcher Agent Architecture

## Overview

GPTResearcher este un agent Ploinky care ruleaza GPT Researcher prin doua suprafete diferite.

Prima suprafata este UI-ul oficial GPT Researcher, folosit de oameni din browser pentru a porni si urmari research-uri vizuale. A doua suprafata este MCP, folosita de Ploinky si de alti agenti pentru a porni research-uri controlate prin tool-uri.

Agentul ruleaza intr-un singur container. In container exista doua servere HTTP si un environment Python:

Python virtual environment contine pachetul `gpt-researcher` si dependintele folosite de tool-urile MCP.

GPT Researcher App serveste UI-ul oficial si endpoint-urile sale HTTP/WebSocket.

Ploinky AgentServer expune tool-urile finale catre routerul Ploinky.

## Python Environment

Environment-ul Python este creat la instalare in:

```text
/opt/gpt-researcher-venv
```

Scriptul de instalare instaleaza pachetele principale:

```text
gpt-researcher
langchain-mcp-adapters
ddgs
```

Acest environment este folosit de tool-ul MCP:

```text
start_research
```

Tool-ul ruleaza scriptul:

```text
/code/scripts/start-research.py
```

care incarca modulele locale din:

```text
/code/scripts/gpt_researcher_agent
```

Aceste module gestioneaza input-ul MCP, setarile persistente, integrarea GPT Researcher si providerul custom Soul Gateway.

## GPT Researcher Application

UI-ul oficial GPT Researcher este instalat separat de pachetul Python.

La instalare, agentul cloneaza repository-ul oficial:

```text
https://github.com/assafelovic/gpt-researcher.git
```

in directorul:

```text
/opt/gpt-researcher-app
```

Dependintele aplicatiei sunt instalate din:

```text
/opt/gpt-researcher-app/requirements.txt
```

La start, aplicatia este pornita cu:

```text
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

GPT Researcher App asculta in container pe portul:

```text
8000
```

Acest port nu trebuie folosit ca suprafata publica directa. El este publicat prin mecanismul Ploinky `additionalServerPort` si rutat prin routerul Ploinky.

UI-ul este accesibil din browser la:

```text
http://gptresearcher.localhost:8080/
```

Portul `8080` este portul routerului Ploinky din workspace, nu portul containerului.

## Ploinky AgentServer

Ploinky AgentServer este pornit de scriptul:

```text
/code/scripts/start-gpt-researcher.sh
```

dupa ce serverul GPT Researcher UI este pornit in background.

AgentServer asculta in container pe portul:

```text
7000
```

Aceasta este suprafata oficiala MCP a agentului.

Routerul Ploinky ajunge la AgentServer atunci cand un client foloseste:

```text
/GPTResearcher/mcp
```

AgentServer citeste:

```text
mcp-config.json
```

identifica tool-urile permise si executa comenzile definite de agent.

## Dashboard Request Flow

Fluxul UI-ului oficial GPT Researcher foloseste host routing.

Browserul acceseaza:

```text
http://gptresearcher.localhost:8080/
```

Routerul Ploinky identifica agentul dupa subdomeniul:

```text
gptresearcher.localhost
```

si forwardeaza cererea catre `additionalServerPort`, adica serverul GPT Researcher App din container pe portul 8000.

Din perspectiva aplicatiei GPT Researcher, cererile ajung la radacina aplicatiei.

Astfel, endpoint-uri precum:

```text
/
/ws
/static
```

functioneaza natural, fara prefixul `/services/gpt-researcher`.

UI-ul foloseste si WebSocket pentru status si progres live. Fluxul WebSocket este:

```text
Browser
Ploinky Router
GPT Researcher App pe portul 8000
```

Conexiunea WebSocket foloseste:

```text
ws://gptresearcher.localhost:8080/ws
```

si este proxied de router catre:

```text
ws://<container>:8000/ws
```

## MCP Request Flow

Fluxul MCP este separat de UI.

Un agent sau un client Ploinky apeleaza:

```text
/GPTResearcher/mcp
```

Routerul aplica autentificarea si politicile MCP.

AgentServer executa tool-ul solicitat.

Pentru research, AgentServer executa:

```text
/opt/gpt-researcher-venv/bin/python /code/scripts/start-research.py
```

Scriptul Python citeste setarile persistente, configureaza variabilele GPT Researcher si porneste research-ul prin API-ul Python:

```text
GPTResearcher(...).conduct_research()
GPTResearcher(...).write_report()
```

Rezultatul este intors catre AgentServer, apoi catre router si client.

## Settings Storage

Setarile non-secret sunt salvate in workspace-ul agentului, nu in `/code`.

Fisierul folosit este:

```text
$WORKSPACE_PATH/gpt-researcher-settings.json
```

Acest fisier contine:

```text
fastLlm
smartLlm
strategicLlm
embedding
retriever
env
```

Campul `env` contine doar valori non-secret, cum ar fi base URL-uri pentru provideri.

Cheile API nu sunt salvate in acest fisier. Ele trebuie furnizate prin environment-ul agentului.

## Provider Configuration

GPTResearcher poate folosi mai multi provideri prin setarile persistente.

Modelele principale sunt:

```text
FAST_LLM
SMART_LLM
STRATEGIC_LLM
EMBEDDING
```

Retrieverul este configurat prin:

```text
RETRIEVER
```

Setarile sunt aplicate la runtime de scriptul Python inainte ca instanta `GPTResearcher` sa fie creata.

Providerii pot folosi variabile non-secret precum:

```text
OLLAMA_BASE_URL
OPENAI_BASE_URL
AZURE_OPENAI_ENDPOINT
AZURE_OPENAI_API_VERSION
MISTRAL_BASE_URL
OPENROUTER_LIMIT_RPS
VLLM_OPENAI_API_BASE
AIMLAPI_BASE_URL
SOUL_GATEWAY_BASE_URL
```

Cheile API raman variabile de mediu ale agentului, de exemplu:

```text
OPENAI_API_KEY
TAVILY_API_KEY
MISTRAL_API_KEY
SOUL_GATEWAY_API_KEY
```

## Soul Gateway Provider

Agentul include un provider custom Python pentru Soul Gateway.

Modelele Soul Gateway sunt configurate cu prefixul:

```text
soul_gateway:
```

Exemple:

```text
soul_gateway:codex-api/gpt-5.5
soul_gateway:codex-api/gpt-5.4-mini
soul_gateway:codestral-embed
```

Providerul custom trimite cereri OpenAI-compatible catre:

```text
SOUL_GATEWAY_BASE_URL
```

si foloseste:

```text
SOUL_GATEWAY_API_KEY
```

pentru headerul `Authorization`.

Providerul implementeaza atat chat completions, cat si embeddings.

Embeddings raman non-streaming. Chat completions pot necesita tratament special pentru modelele lente, deoarece cererile non-streaming lungi pot expira la gateway sau la Cloudflare.

## Settings Plugin

Modalul de configurare din AchillesIDE este furnizat de pluginul GPTResearcher Settings Plugin.

Acesta apare in setarile workspace-ului.

Pluginul citeste setarile prin tool-ul:

```text
gpt_researcher_get_settings
```

si le salveaza prin tool-ul:

```text
gpt_researcher_update_settings
```

Ambele operatii trec prin MCP si prin AgentServer. Pluginul nu scrie direct pe disk.

Pluginul permite configurarea modelelor:

```text
Fast LLM
Smart LLM
Strategic LLM
Embedding
Retriever
```

si a base URL-urilor non-secret pentru provideri.

Pluginul include si un buton pentru deschiderea UI-ului oficial GPT Researcher:

```text
http://gptresearcher.localhost:8080/
```

## Exposed MCP Tools

AgentServer expune urmatoarele tool-uri MCP:

```text
start_research
gpt_researcher_get_settings
gpt_researcher_update_settings
```

Tool-ul:

```text
start_research
```

porneste un research GPT Researcher si intoarce raportul, sursele, costurile si contextul colectat.

Tool-ul este destinat apelurilor interne agent-to-agent.

Tool-ul:

```text
gpt_researcher_get_settings
```

citeste setarile persistente non-secret.

Tool-ul:

```text
gpt_researcher_update_settings
```

salveaza setarile persistente non-secret.

Niciun tool nu expune direct chei API.

Orice operatie noua trebuie declarata explicit in:

```text
mcp-config.json
```

si trebuie sa respecte modelul de acces al Ploinky.

## Operational Configuration

Urmatoarele variabile modifica comportamentul operational al agentului:

```text
WORKSPACE_PATH
```

Directorul persistent in care se salveaza `gpt-researcher-settings.json`.

```text
SOUL_GATEWAY_BASE_URL
```

Base URL-ul non-secret pentru providerul custom Soul Gateway.

```text
SOUL_GATEWAY_API_KEY
```

Cheia folosita de providerul custom Soul Gateway.

```text
OPENAI_API_KEY
TAVILY_API_KEY
MISTRAL_API_KEY
GOOGLE_API_KEY
```

Chei folosite de providerii si retrieverele GPT Researcher, in functie de configuratie.

Aceste variabile nu schimba arhitectura sistemului, ci doar providerii si comportamentul operational al research-ului.

## Separation of Responsibilities

Separarea responsabilitatilor este intentionata.

Browserul utilizeaza exclusiv GPT Researcher App pentru UI-ul oficial.

Tool-urile utilizeaza exclusiv AgentServer si API-ul Python GPT Researcher pentru acces controlat prin MCP.

Setarile sunt modificate prin MCP, nu prin acces direct la filesystem din UI.

Cheile API sunt furnizate prin environment, nu prin pluginul de setari.

Clientii Ploinky nu comunica direct cu portul 8000 al containerului.

Clientii Ploinky nu comunica direct cu portul 7000 al containerului.

Singurele suprafete externe expuse sunt:

UI-ul GPT Researcher prin routerul Ploinky.

MCP-ul GPTResearcher prin routerul Ploinky.

## Architecture Invariants

Arhitectura respecta cateva reguli fundamentale.

Toate procesele interne ruleaza in acelasi container.

GPT Researcher App ruleaza pe portul intern:

```text
8000
```

Ploinky AgentServer ruleaza pe portul intern:

```text
7000
```

Portul 8000 nu trebuie publicat direct ca suprafata stabila a hostului.

Portul 7000 este rezervat pentru AgentServer si mecanismele MCP.

UI-ul browser trebuie accesat prin:

```text
http://gptresearcher.localhost:8080/
```

MCP-ul trebuie accesat prin:

```text
/GPTResearcher/mcp
```

Setarile persistente trebuie salvate in:

```text
$WORKSPACE_PATH/gpt-researcher-settings.json
```

si nu in `/code`.

Secretele nu trebuie salvate in fisierul de settings.

## Startup Sequence

Ordinea de pornire este obligatorie.

Environment-ul Python este pregatit la instalare.

Repository-ul oficial GPT Researcher este clonat la instalare.

Dependintele aplicatiei GPT Researcher sunt instalate in acelasi venv.

La start, GPT Researcher App porneste prima pe portul 8000.

Ploinky AgentServer porneste dupa aceea pe portul 7000.

Readiness-ul verifica atat AgentServer, cat si UI-ul GPT Researcher.

Daca UI-ul GPT Researcher nu raspunde pe portul 8000, agentul nu este complet functional pentru browser.

Daca AgentServer nu raspunde pe portul 7000, agentul nu este functional pentru MCP.

Daca oricare dintre aceste procese principale se opreste, containerul nu mai reprezinta un GPTResearcher agent functional si trebuie restartat.
