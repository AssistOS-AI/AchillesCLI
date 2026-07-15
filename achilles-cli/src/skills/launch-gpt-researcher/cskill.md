# Launch GPTResearcher

Delegate a research task to the `GPTResearcher` Ploinky agent.
Use when GPTResearcher or GPT Researcher is mentioned to produce a researched report.

## Input Format
Accepts plain text describing the main research query.

The input may also be JSON containing:

- `query`: main research query, required. This is the main query used for web
  research.
- `context`: optional instructions or data for the research task.
- `reportType`: GPT Researcher report type, optional. Defaults to
  `research_report`. Valid values:
  - `research_report`: standard researched report. Prefer this unless the user
    asks for a different output shape.
  - `resource_report`: bibliography or resource recommendation report.
  - `outline_report`: structured outline instead of a full report.
  - `custom_report`: use the prompt as custom report-writing instructions.
  - `subtopic_report`: report focused on a subtopic; only use when the task is
    explicitly about a subtopic of a larger topic.
  - `deep`: deeper multi-step research; only use when the user asks for deep or
    exhaustive research because it is slower and more expensive.
- `useLocalDocs`: optional boolean. Defaults to `true`. When set to `false`,
  GPTResearcher does not use local files in research.

The skill always sends the current AchillesCLI working directory to
GPTResearcher. Callers cannot override it.

## Output Format
Returns plain text `Task started.` for asynchronous execution or a completed result for blocking execution; treat both as success.
