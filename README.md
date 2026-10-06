# AI Nutrition Assistant

A chatbot that answers questions about **food, nutrition and food safety** from anywhere in the
world. When official public health guidance covers a question, the answer comes from that guidance
**with citations to the exact passage**. When it doesn't, the assistant gives a clearly labelled
general-knowledge answer. It refuses personal calorie or weight targets, medical diet advice, and
anything that isn't about food.

**Live:** [Frontend](https://ai-nutrition-assistant-self.vercel.app) ·
[Backend API](https://app-production-3fe4f.up.railway.app/api/chat)

---

## How it answers

| Question | What you get |
|---|---|
| Covered by the official documents, e.g. *"How much salt should adults eat per day?"* | An answer built only from the documents, with each claim cited to its publisher, year, section and passage |
| Any other food, nutrition or food-safety question, e.g. *"What is jollof rice?"* | A general-knowledge answer, labelled **"General knowledge — not from the cited official documents"**, with no citations |
| A personal target or medical diet, e.g. *"How many calories should I eat?"* | A refusal and a referral to a qualified professional |
| Off topic, e.g. *"Who won the 2018 World Cup?"* | *"I only answer questions about food, nutrition and food safety…"* |

Every response reports which of these happened in its `answerMode` field: `grounded`, `general` or
`refused`.

When documents disagree, both are shown. For salt, WHO says under 5 g a day, Public Health England
says 6 g, and the US guidelines give 2,300 mg of sodium. The assistant reports each with its
publisher and does not pick a winner.

## The guidance it cites

| Document | Publisher, year |
|---|---|
| [Healthy diet (fact sheet)](https://www.who.int/news-room/fact-sheets/detail/healthy-diet) | World Health Organization, 2026 |
| [Dietary Reference Values for nutrients: Summary report](https://www.efsa.europa.eu/sites/default/files/2017_09_DRVs_summary_report.pdf) | European Food Safety Authority, 2017 |
| [Dietary Guidelines for Americans, 2025–2030](https://cdn.realfood.gov/DGA.pdf) | U.S. Departments of Agriculture and Health and Human Services, 2026 |
| [The Eatwell Guide](https://www.gov.uk/government/publications/the-eatwell-guide) | Public Health England, 2018 |
| [Five keys to safer food manual](https://www.who.int/publications/i/item/9789241594639) | World Health Organization, 2006 |
| [How to chill, freeze and defrost food safely](https://www.gov.uk/government/publications/how-to-chill-freeze-and-defrost-food-safely) | Food Standards Agency, 2017 |
| [Guideline: sodium intake for adults and children](https://www.who.int/publications-detail-redirect/9789241504836) | World Health Organization, 2012 |

A scheduled job re-fetches these every day, so the corpus stays current. It is 7 documents, split
into 226 passages.

## How it works

```
Question
   │
   ├─ 1. Scope guard (code, not the model): calorie/weight targets and medical advice → refused
   │
   ├─ 2. Retrieval: embed the question (bge-small) → search pgvector → re-rank
   │
   ├─ 3. Sufficiency gate: do the passages actually answer it?
   │        │
   │        ├─ yes → Groq answers ONLY from the passages, citing each claim
   │        │         → the server binds every citation to a real stored passage
   │        │
   │        └─ no  → Groq answers from general knowledge, labelled, no citations
   │                  (off-topic questions are refused here)
   │
   └─ 4. Answer check: withholds any answer that slips into a personal target
```

Two design choices are worth knowing about:

- **A fabricated citation is structurally impossible.** The model only *selects* a passage by its
  id. The server builds the citation from the database, and drops any claim whose passage was not
  retrieved for this question.
- **Safety rules are enforced in code, not left to the prompt.** The refusal rules run as code
  before and after the model, so a cleverly worded request can't talk its way past them.

### The data pipeline

```
scrape the 7 public URLs → extract text (PDF + HTML) → chunk → embed → store in pgvector
```

This runs every day at **09:15 IST (03:45 UTC)** on GitHub Actions, in
[`.github/workflows/corpus-ingest.yml`](.github/workflows/corpus-ingest.yml). An edition guard checks
each document's title and year, so a changed or wrong document is flagged rather than silently
ingested.

## Tech stack

| Layer | Choice |
|---|---|
| App | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Language model | [Groq](https://groq.com), `openai/gpt-oss-120b`, using structured JSON output |
| Embeddings | `bge-small-en-v1.5`, 384 dimensions, run locally |
| Vector database | PostgreSQL + pgvector (HNSW cosine index) |
| ORM | Prisma |
| Hosting | Vercel (frontend) and Railway (backend API + database) |
| Scheduler | GitHub Actions |

Vercel serves the UI and forwards `/api/chat` to the Railway container. The embedding model needs a
long-running server and cannot load in Vercel's serverless functions.

## Run it locally

You need **Node.js 18.17+**, a **PostgreSQL database with the pgvector extension**, and a
**[Groq API key](https://console.groq.com)**.

```bash
npm install                          # also runs `prisma generate`
cp .env.local.example .env.local     # then fill in GROQ_API_KEY and DATABASE_URL
npx prisma migrate deploy            # create the tables and the vector index
npm run ingest                       # load the 7 documents (a few minutes)
npm run dev                          # http://localhost:3000
```

> **Keep your keys out of git.** Put secrets only in `.env.local`, which is gitignored. Never put
> them in `.env.local.example`: that file is public. This repository has GitHub push protection
> turned on, which rejects pushes containing keys.

> **Never run `prisma db push`** on a database that holds data. Prisma cannot see the vector column,
> so `db push` drops it. Use `prisma migrate deploy`.

### Or with Docker

This runs the app with its own local database and never touches production.

```bash
docker compose up --build -d                       # app on http://localhost:3000
docker compose --profile ingest run --rm ingest    # first run: load the corpus
docker compose down
```

The image file is `Dockerfile.dev`, deliberately not named `Dockerfile`, because Railway
automatically builds any root-level `Dockerfile`.

## Testing

```bash
npx tsc --noEmit         # type check
npm run lint             # lint
npm run test:scope       # refusal rules, including multi-turn conversations (no API calls)
npm run test:corpus      # the daily change-watcher
npm run test:rate        # the Groq rate limiter
npm run eval:retrieval   # retrieval and citation quality (uses Groq quota)
```

Current results: retrieval finds the right passage for **17 of 17** benchmark questions, the
**8 of 8** abuse cases are refused, and there are **0** false refusals. See
[`Docs/retrieval-report.md`](Docs/retrieval-report.md).

**Try it by hand** on the [live site](https://ai-nutrition-assistant-self.vercel.app):

- *"How much salt should adults eat per day?"* gives a cited answer.
- *"What is jollof rice?"* gives a general-knowledge answer, labelled.
- *"How many calories should I eat per day?"* is refused.
- *"Write a poem about broccoli"* is refused as off-topic.

## API

`GET /api/chat` returns service health: the database and corpus counts, and whether the Groq key is
configured. It never returns the key itself.

`POST /api/chat`

```json
{ "message": "How much salt should adults eat per day?", "conversationId": "optional-uuid" }
```

returns

```json
{
  "conversationId": "…",
  "answer": "…",
  "answerMode": "grounded",
  "claims": [{ "text": "…", "source": { "publisher": "World Health Organization", "year": 2026, "url": "…", "section": "…", "chunkId": "…" } }]
}
```

Messages are limited to 4,000 characters. Conversations belong to the browser that created them,
through a signed cookie, so another browser cannot read them.

## Limitations

- **General-knowledge answers have no citations.** They come from the language model, so they can be
  wrong in ways a citation would have exposed. That is why they are labelled.
- **Groq's free tier limits throughput** to about 8,000 tokens per minute. When several questions
  arrive at once, answers can take 30 seconds or more. The app says when it is at capacity rather
  than failing silently.
- **The corpus is English-only**, so questions in other languages rarely match it.

## Documentation

| Document | What it covers |
|---|---|
| [problemStatement.md](Docs/problemStatement.md) | The requirements, and how each source URL was verified |
| [rag-architecture.md](Docs/rag-architecture.md) | The full design, as built |
| [implementation-plan.md](Docs/implementation-plan.md) | The phased build plan ([PDF](Docs/implementation-plan.pdf)) |
| [chunking-strategy.md](Docs/chunking-strategy.md) | How documents are split into passages |
| [embedding-strategy.md](Docs/embedding-strategy.md) | The embedding model and why it was chosen |
| [vector-store.md](Docs/vector-store.md) | pgvector storage and the retrieval query |
| [scheduler-and-scraping.md](Docs/scheduler-and-scraping.md) | The daily pipeline and the edition guard |
| [ingestion-report.md](Docs/ingestion-report.md) | What each ingest run fetched and stored |
| [retrieval-report.md](Docs/retrieval-report.md) | Measured retrieval and citation quality |
| [edge-cases-catalogue.md](Docs/edge-cases-catalogue.md) | Edge cases and how each is handled |
| [deployment-plan-v2.md](Docs/deployment-plan-v2.md) | Deployment, and the verified Docker setup |
| [release-runbook.md](Docs/release-runbook.md) | Step-by-step release checklist |

Contributors using Claude Code should also read [`CLAUDE.md`](CLAUDE.md).
