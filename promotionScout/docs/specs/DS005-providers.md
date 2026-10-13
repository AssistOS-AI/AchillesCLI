---
title: DS005-providers
summary: Defines the site catalog, how topics become feed URLs, RSS/Atom collection, RSSHub use and polite request limits.
---

## Introduction

Scout watches a list of [sites](../wiki.html#definition-site) instead of searching the open web. Each site turns a topic's [search terms](../wiki.html#definition-search-terms) or [tags](../wiki.html#definition-tags) into RSS/Atom addresses, or offers one fixed feed for all topics. The operator needs no API keys and chooses no individual feeds unless adding a site.

## Core Content

### Site kinds

A site has a name, a kind and an address template. The address is an absolute HTTP(S) URL or an RSSHub route beginning with `/`.

| Kind | Contract |
| --- | --- |
| `search` | The template contains `{query}` once. Each search term of each topic produces one feed URL; a topic without stored search terms uses the terms derived from it. A site may declare an OR separator and then receives one combined query per topic, with multiword terms grouped in parentheses so their words must all appear without forming an exact phrase. |
| `tag` | The template contains `{tag}` once. Each tag of each topic produces one feed URL after normalization in the site's tag style: `joined` removes spaces and punctuation, `hyphen` joins words with hyphens, `underscore` joins them with underscores (Lemmy community names such as `linux_gaming`), `alnum` keeps only ASCII letters and digits. A topic without stored tags uses the tags derived from it. |
| `feed` | The template contains neither marker. One feed serves every topic, and the model decides relevance. |

Empty search terms and tags are derived from the topic: Scout drops function words (such as `on`, `in`, `and`), generic words (such as `news`, `latest`, `release`) and years, keeps the remaining words in order, and uses them as one search phrase when there are at most three, or as consecutive phrases of two or three words otherwise. Derived tags are each two-word phrase (written per site, for example `linuxgaming` or `linux-gaming`) followed by the single words except loose modifiers such as `mid` or `cheap`, at most five. The rule (`src/app/derive.mjs`) is local and deterministic and works best for topics of two to four words; stored lists always take precedence, and a topic whose words are all removed falls back to its full text as the search term.

Values inserted into a template are percent-encoded. Identical feed URLs produced for several topics are one shared source polled once. A feed that a topic no longer produces, because its terms, tags or sites changed, becomes inactive for that topic while its entries stay stored.

### Built-in catalog

`config/sites.json` declares the built-in sites. Every time the agent daemon starts, Scout inserts new built-in sites, updates changed ones and removes those no longer declared, while keeping the operator's enabled or disabled choice. Built-in sites can be disabled but not deleted.

| Site | Kind | Address |
| --- | --- | --- |
| Reddit | search | `https://www.reddit.com/search.rss?q={query}&sort=new&type=link`, one OR-combined query per topic, 10 seconds between requests |
| Hacker News | search | `https://hnrss.org/newest?q={query}` |
| Bluesky | search | RSSHub `/bsky/keyword/{query}` |
| Mastodon | tag | `https://mastodon.social/tags/{tag}.rss`, joined |
| DEV Community | tag | `https://dev.to/feed/tag/{tag}`, alnum |
| Medium | tag | `https://medium.com/feed/tag/{tag}`, hyphen |
| Lobsters | tag | `https://lobste.rs/t/{tag}.rss`, joined |
| Stack Overflow | tag | `https://stackoverflow.com/feeds/tag/{tag}`, hyphen |
| Lemmy communities (lemmy.world) | tag | `https://lemmy.world/feeds/c/{tag}.xml?sort=New`, underscore; an unknown community answers 400 |
| Product Hunt | feed | `https://www.producthunt.com/feed` |
| Slashdot | feed | `https://rss.slashdot.org/Slashdot/slashdotMain` |
| Hugging Face daily papers | feed | RSSHub `/huggingface/daily-papers` |
| Lemmy (lemmy.world) | feed | `https://lemmy.world/feeds/all.xml?sort=New` |
| Ask HN | feed | `https://hnrss.org/ask`, with the Hacker News boilerplate removed |
| MetaFilter | feed | `https://rss.metafilter.com/metafilter.rss` |
| Ask MetaFilter | feed | `https://rss.metafilter.com/ask.rss` |
| Tildes | feed | `https://tildes.net/topics.rss`, all groups |

Built-in entries may also declare text patterns that remove feed boilerplate, such as Hacker News "Article URL", "Comments URL" and "Points" lines, before an entry is stored and ranked. These sites are third-party services. Their availability, rate limits, feed contents and tag vocabularies are outside Scout's control; Lobsters and Stack Overflow accept only tags that already exist there.

### Sites added by the operator

The operator can add a `search`, `tag` or `feed` site in the Sites tab. A feed site given as an HTTP(S) address is fetched once when added: an RSS/Atom document is kept as is, and an HTML page is replaced by its first same-origin advertised RSS/Atom link. A page without such a link is refused with `FEED_NOT_FOUND`. A redirect is refused with `REDIRECTED` and names the target address to use instead. RSSHub routes and search or tag templates are validated syntactically and checked by the first run. An address already used by another site is refused. Operator sites can choose a tag style; OR-combining, request spacing and text cleanup are available only to built-in sites. Deleting an operator site stops its polling and keeps its collected entries.

### Collection

Collection reads only RSS 2.0, RSS 1.0 (RDF) and Atom documents. XML must validate, and DTD or entity declarations are rejected. Entries require direct URLs. The text of an entry is the first nonempty value among its content, description, summary and media description, so media attachments cannot hide the text. Entries with neither title nor text are skipped individually because the model has nothing to compare.

Only English entries are ranked. Each entry's language is detected locally with `eld` 2.1.0 (medium n-gram database) on its title and text after removing links, hashtags and mentions. An entry is marked non-English when most of its letters are outside the Latin script, or when it has at least 30 letters, the detector reports a reliable non-English language and the English score is below 90% of that language's score. Otherwise the entry counts as English or undecided and is ranked. The rule deliberately keeps short titles, which detectors often misread; some non-English posts filled with English product names are therefore still ranked. Non-English entries stay stored with their language code, appear in the Collected tab as `not English` and are counted per run, but never reach the model. On the calibration collection the rule marked 136 of 1,259 entries and removed none of the posts the operator had labeled relevant. HTML is fetched only to find a feed link when the operator adds a site, and its page text is never stored or ranked. Scout does not fetch linked articles, comments, transcripts or private content.

Conditional ETag and Last-Modified requests avoid unchanged transfers. Malformed polls must not advance validators. Every feed attempt observes a one-hour interval, including errors; the run's start time is the attempt time, so runs started one hour apart poll every due feed again. A tag site that answers 400, 404 or 410 records the explicit skip "Tag not found on this site", which stays visible during the cooldown and is not an error; Lemmy answers 400 for an unknown community where most sites answer 404.

### Polite requests

Requests to the same host within a run are at least one second apart, or the site's declared spacing (10 seconds for Reddit). A 429 response is never retried. A 403 or 429 pauses the whole host for six hours: its other feeds are skipped without recording an attempt, so they remain due once the pause ends. The pause is stored in SQLite and survives restarts. Reddit's anonymous feeds answer 403 or 429 intermittently; Scout accepts that and does not insist.

Server errors (5xx) are retried at most three times when no Retry-After value above two seconds is given. Requests use a 20-second timeout and a 5 MiB response limit. Stopping monitoring cancels the request in progress; that cancellation ends the run as `aborted` and is not a source failure, although the interrupted feed keeps its cooldown and an interruption message until its next poll.

### RSSHub and configuration

RSSHub is an HTTP service built natively by the agent's [install step](../wiki.html#definition-install-step). The [agent daemon](../wiki.html#definition-agent-daemon) starts or reuses it when the agent starts and restarts it when a check every 30 seconds finds it stopped. A run that reaches its first due feed using an RSSHub route waits for RSSHub's health endpoint up to the service's startup timeout and then reuses it; if RSSHub does not answer, only RSSHub feeds fail in that run (`SERVICE_UNAVAILABLE`). Scout fetches its XML routes; RSSHub uses in-memory caching and requires no Redis. Individual routes can still require credentials or browsers, which are not installed. The installation-owned `config.json` keeps the RSSHub address (default `http://127.0.0.1:1200`), its launch command, the request timeout and the User-Agent. `RSSHUB_URL` remains an internal deployment override.

RSSHub produces feeds only for sites that have a route in the pinned version; a site with neither its own feed nor a route cannot be added. The generic transform route, which builds feeds from arbitrary HTML or JSON through CSS selectors, stays disabled because it requires `ALLOW_USER_SUPPLY_UNSAFE_DOMAIN`, would let any local program make RSSHub fetch arbitrary addresses and would turn page HTML into feeds the site never offered. Sites that refuse automated requests with 403, such as Quora, ResetEra or Unity Discussions, are not added and their refusals are not circumvented; the providers guide lists the candidates that were tested and left out.
