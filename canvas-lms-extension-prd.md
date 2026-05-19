# PRD: Canvas LMS Context Assistant Browser Extension

## 1. Product Summary

Build a Canvas LMS-focused browser extension that helps students ask questions about their course materials without manually searching Canvas or uploading files to an LLM. The extension will gather context directly from Canvas pages and files that the logged-in user can already access in the browser, parse that content locally, retrieve only relevant snippets for each user question, and send those snippets to the selected LLM.

This product is adapted from Page Assist's browser-context architecture, but narrowed to Canvas LMS. Page Assist collects active page, selected tab, document, search, and knowledge-base context, then inserts that context into model prompts. This Canvas extension will replace generic context gathering with Canvas-aware page discovery, parsing, short-lived caching, retrieval, and prompt construction.

The extension must not require a Canvas API developer key. It must operate through the authenticated browser session and extension browser APIs only.

## 2. Goals

- Let students ask natural-language questions about Canvas course content.
- Avoid requiring users to manually upload Canvas files or copy-paste assignment/module/page text.
- Gather Canvas context from browser-visible pages and accessible same-session Canvas links.
- Minimize sensitive data retention by default.
- Send only relevant course snippets to the model, not full course dumps.
- Provide source citations for every course-grounded answer.
- Make it clear when Canvas context is being collected, cached, or sent to a model.
- Support local models first-class, while allowing compatible cloud providers with explicit disclosure.

## 3. Non-Goals

- No Canvas API developer-key integration for the MVP.
- No instructor/admin-only course access.
- No gradebook automation.
- No assignment submission automation.
- No quiz answering, cheating workflow, or test-taking automation.
- No hidden/locked/unpublished content access.
- No permanent full-course archival by default.
- No bypassing Canvas, SSO, file, iframe, or LTI permissions.
- No background crawling of unrelated websites.

## 4. Core User Stories

### Student: Current Page Help

As a student viewing a Canvas assignment, I want to ask “what do I need to submit?” and get an answer based on the current assignment instructions, rubric, and visible due-date information.

### Student: Module Understanding

As a student viewing a Canvas module, I want to ask “what should I focus on for this week?” and get an answer grounded in the visible module items, pages, assignments, files, and discussions.

### Student: Course Search

As a student, I want to ask “where does the professor explain late work?” and have the extension search parsed Canvas course content it has locally collected or can collect from visible course links.

### Student: Source Verification

As a student, I want every answer to show the Canvas source title and link so I can verify the answer in Canvas.

### Privacy-Conscious User

As a user, I want the extension to avoid storing raw Canvas HTML or full course content permanently, and I want to clear cached course data.

### Cloud Model User

As a user using a cloud LLM provider, I want to know that selected Canvas snippets will be sent to that provider before I send the question.

## 5. Key Constraints

### No Canvas API Developer Key

The extension cannot depend on Canvas API OAuth apps, developer keys, or server-side Canvas API access. It may use:

- `chrome.scripting.executeScript` / `browser.scripting.executeScript`.
- Extension content scripts.
- DOM reads from Canvas pages the user opens.
- `fetch(url, { credentials: "include" })` for URLs accessible to the user's current Canvas browser session, subject to browser permissions, CORS, redirects, SSO behavior, and institutional restrictions.
- Direct browser-accessible file URLs when permitted by Canvas and the browser.

### Privacy-Minimized Context

The extension must avoid collecting or retaining more Canvas data than necessary. Default behavior must be on-demand, visible, scoped, and bounded.

### Browser Permission Scope

Host permissions should be restricted to configured Canvas domains whenever possible:

```json
{
  "host_permissions": [
    "https://school.instructure.com/*",
    "https://*.instructure.com/*"
  ]
}
```

For institution-specific deployments, prefer the school's exact Canvas domain over `*.instructure.com`.

## 6. Existing Page Assist Architecture To Reuse

Page Assist demonstrates the required extension-to-LLM pattern:

1. User opens extension UI or side panel.
2. Extension reads active tab or selected tabs via browser APIs.
3. Extension extracts HTML, title, URL, PDF state, images, files, or search results.
4. Extension parses content into text.
5. Chat mode builds a message containing chat history, user question, system prompt, and extracted context.
6. `pageAssistModel()` chooses the provider adapter.
7. The model streams a response.
8. Final message and metadata are saved locally.

The Canvas product should keep the provider abstraction and streaming model flow, but replace generic context sources with Canvas-specific collectors and parsers.

## 7. Desired User Experience

### Entry Points

- Browser side panel available on Canvas pages.
- Optional full Web UI for settings, cache management, model/provider setup, and source inspection.
- Context menu on Canvas pages: “Ask about this Canvas page”.
- Optional toolbar icon behavior:
  - On Canvas: open Canvas Assistant side panel.
  - Outside Canvas: show “Open Canvas first” empty state.

### Main Chat UI

The side panel should include:

- Current course indicator.
- Current Canvas page indicator.
- Context scope selector.
- Message input.
- Model selector.
- “Using Canvas context” toggle.
- Visible source chips after an answer.
- Privacy/provider notice when using cloud models.
- Cache/index status.

Recommended scope selector:

```text
Context Scope:
- Current page only
- Current module
- Recently viewed course pages
- Collected course cache
- Manual selected Canvas sources
```

Default scope for MVP: `Current page only`.

### Source Display

Each grounded answer must show:

- Source title.
- Source type: assignment, page, module, discussion, file, syllabus, announcement.
- Canvas URL.
- Collection timestamp.
- Optional snippet preview.

### Collection Status

When collecting context, show precise status:

```text
Reading current Canvas page...
Found 8 module links.
Parsing Assignment: Essay 2...
Extracted 3 relevant snippets.
```

Avoid ambiguous states such as “Indexing everything” unless actually true.

## 8. Context Collection Model

### Principle

The LLM never reads Canvas directly. The extension reads Canvas content from the browser/session, converts it into clean text, selects relevant snippets, then sends only those snippets to the model.

### Active Page Extraction

The extension should collect the current Canvas page using an injected script:

```ts
async function collectActiveCanvasPage(tabId: number): Promise<RawCanvasPage> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      url: window.location.href,
      title: document.title,
      html: document.documentElement.outerHTML,
      text: document.body?.innerText || "",
      contentType: document.contentType
    })
  })

  return result.result
}
```

Raw HTML must be treated as transient. It should be parsed and discarded unless debugging is explicitly enabled.

### Same-Session Link Fetching

For links discovered inside Canvas, the extension may fetch pages using the user's browser session:

```ts
async function fetchCanvasHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    credentials: "include",
    redirect: "follow"
  })

  if (!response.ok) throw new Error(`Canvas fetch failed: ${response.status}`)
  return await response.text()
}
```

This must only happen for allowlisted Canvas domains and only inside user-selected context scope.

### Link Discovery

From Canvas pages, discover links for:

- Course home.
- Syllabus.
- Modules.
- Module items.
- Assignments.
- Pages/wiki pages.
- Discussions.
- Announcements.
- Files.
- Rubrics when linked/visible.

Discovery must be conservative. For MVP, avoid recursive full-course crawling by default.

### Recommended Collection Scopes

#### Current Page Only

Collect and parse only the active page. Lowest privacy risk and fastest.

#### Current Module

From a module page, collect visible module item links and fetch a bounded number of linked Canvas items. Requires progress UI and cancellation.

#### Recently Viewed

Cache cleaned chunks from Canvas pages the user has opened during normal browsing. This avoids aggressive crawling.

#### Course Cache

Optional advanced mode. User explicitly triggers “Build course context cache.” Must show what will be collected, use strict size limits, and support cancellation.

## 9. Canvas Page Detection

### URL Detection

Implement Canvas detection using configurable domains and URL patterns:

```ts
type CanvasRoute =
  | "course_home"
  | "modules"
  | "module_item"
  | "assignment"
  | "page"
  | "discussion"
  | "announcement"
  | "file"
  | "syllabus"
  | "quiz"
  | "unknown"
```

Detection examples:

```ts
function parseCanvasRoute(url: string): CanvasRouteInfo | null {
  const parsed = new URL(url)

  if (!isAllowedCanvasHost(parsed.hostname)) return null

  const courseMatch = parsed.pathname.match(/\/courses\/(\d+)/)
  if (!courseMatch) return null

  const courseId = courseMatch[1]

  if (/\/assignments\/\d+/.test(parsed.pathname)) return { courseId, route: "assignment" }
  if (/\/modules/.test(parsed.pathname)) return { courseId, route: "modules" }
  if (/\/pages\//.test(parsed.pathname)) return { courseId, route: "page" }
  if (/\/discussion_topics\/\d+/.test(parsed.pathname)) return { courseId, route: "discussion" }
  if (/\/announcements\/\d+/.test(parsed.pathname)) return { courseId, route: "announcement" }
  if (/\/files\/\d+/.test(parsed.pathname)) return { courseId, route: "file" }
  if (/\/assignments\/syllabus/.test(parsed.pathname)) return { courseId, route: "syllabus" }

  return { courseId, route: "unknown" }
}
```

### DOM Detection

Use DOM fallbacks because institutions may use custom routes or Canvas markup:

- Presence of `#content`.
- Canvas-specific classes such as `.ic-app`, `.ic-Layout-wrapper`, `.course-title`, `.assignment-title`, `.module-item-title`.
- Meta tags or links referencing Canvas assets.

## 10. Parsing Requirements

### Parser Contract

Every parser returns normalized documents:

```ts
type CanvasContextDoc = {
  id: string
  courseId: string
  route: CanvasRoute
  type: "assignment" | "module" | "page" | "discussion" | "announcement" | "file" | "syllabus" | "rubric" | "unknown"
  title: string
  url: string
  text: string
  metadata: {
    dueAt?: string
    availableFrom?: string
    availableUntil?: string
    points?: string
    author?: string
    updatedAt?: string
    collectedAt: number
    sourceHash: string
  }
}
```

### Base Parser

All page-specific parsers should fall back to:

- Remove navigation, menus, sidebars, scripts, styles, hidden elements.
- Prefer main content containers:
  - `#content`
  - `main`
  - `[role="main"]`
  - `.ic-Layout-contentMain`
- Use `innerText` after pruning.
- Preserve headings and list boundaries where possible.

### Assignment Parser

Extract:

- Assignment title.
- Description/instructions.
- Due date text.
- Availability dates.
- Points.
- Submission type.
- Rubric text if visible.
- Attached file links.
- Module breadcrumb if visible.

Output document types:

- `assignment`
- optional `rubric`
- optional `file_link` metadata entries

### Module Parser

Extract:

- Module titles.
- Module item titles.
- Item type.
- Item URLs.
- Completion requirements if visible.
- Lock/unlock state text if visible.

Module parser should not automatically fetch all linked content unless scope is `Current module` or broader.

### Page/Wiki Parser

Extract:

- Page title.
- Body content.
- Linked files.
- Embedded iframes as metadata only unless readable.

### Discussion Parser

Extract:

- Discussion prompt.
- Instructor-authored content.
- Replies only if user explicitly includes discussions in scope.

Privacy default: exclude student replies unless enabled.

### Announcement Parser

Extract:

- Announcement title.
- Body.
- Posted date if visible.

### Syllabus Parser

Extract:

- Syllabus body.
- Course summary table rows when visible.
- Assignment due dates listed on syllabus.
- Course policy sections.

### File Parser

Supported MVP:

- PDF text extraction.
- HTML/text files.
- Links to previewable files.

Later:

- DOCX.
- PPTX.
- OCR for scanned PDFs.

File parser must enforce size and time limits.

## 11. Chunking And Retrieval

### Chunking

Convert parsed documents into chunks:

```ts
type CanvasChunk = {
  id: string
  courseId: string
  docId: string
  title: string
  type: CanvasContextDoc["type"]
  url: string
  text: string
  tokenEstimate: number
  metadata: CanvasContextDoc["metadata"]
}
```

Chunking rules:

- Target 500-900 tokens per chunk.
- Preserve heading hierarchy.
- Keep assignment due date/rubric metadata attached to every relevant assignment chunk.
- Never split table rows in ways that lose meaning.
- Add overlap of 80-120 tokens for long documents.

### Retrieval MVP

Use hybrid local retrieval:

- Keyword scoring for exact terms, assignment names, due dates, module titles.
- Optional embeddings if a local embedding provider is configured.
- Recency boost for current page and current module.
- Source-type boost based on query intent.

Query intent examples:

- “due”, “when”, “deadline” -> boost assignments, syllabus, module items.
- “submit”, “requirements”, “rubric” -> boost assignments/rubrics.
- “reading”, “lecture”, “module” -> boost modules/pages/files.
- “policy”, “late”, “attendance” -> boost syllabus/pages.

### Retrieval Output

Return a bounded list:

```ts
type RetrievalResult = {
  chunks: CanvasChunk[]
  sources: CanvasSourceCitation[]
  estimatedTokens: number
}
```

Default limits:

- Max 8 chunks.
- Max 6 sources.
- Max 6,000-10,000 input tokens depending on selected model context window.

## 12. Prompt Construction

### Canvas Grounded System Prompt

Use a strict Canvas-grounding prompt:

```text
You are helping a student understand material from their Canvas course.

Use the provided Canvas context to answer. If the answer depends on assignment instructions,
due dates, rubrics, course policy, required readings, or submission requirements, cite the
source title. If the answer is not present in the provided Canvas context, say that you could
not find it in the collected Canvas context and suggest which Canvas area to check.

Do not invent due dates, grading policies, quiz answers, or instructor intent.
```

### Context Format

The model input should include structured source blocks:

```text
<canvas-context course_id="12345" collected_at="2026-05-14T18:30:00Z">
  <source id="s1" type="assignment" title="Essay 2: Rhetorical Analysis" url="https://...">
    Due Friday at 11:59 PM. Submit a PDF...
  </source>
  <source id="s2" type="syllabus" title="Late Work Policy" url="https://...">
    Late work loses 10% per day...
  </source>
</canvas-context>

Student question:
When is Essay 2 due and what do I need to submit?
```

### Citation Requirement

The assistant should answer with citations:

```text
Essay 2 is due Friday at 11:59 PM, and you need to submit a PDF. Source: Essay 2: Rhetorical Analysis.
```

The UI should map cited source titles back to source chips.

## 13. Privacy And Data Governance

### Default Data Policy

- Do not store raw Canvas HTML.
- Do not permanently store full course dumps by default.
- Store cleaned chunks only when needed for cache/retrieval.
- Keep source metadata minimal.
- Use TTL expiration.
- Enforce per-course cache size caps.
- Provide a clear cache deletion UI.

### Recommended Storage Tiers

#### Tier 1: Ephemeral Memory

Used for:

- Current page raw HTML.
- Current question retrieved snippets.
- Temporary parse state.

Lifetime:

- Current session or side-panel lifecycle.

#### Tier 2: Short-Lived Local Cache

Used for:

- Cleaned parsed chunks.
- Source metadata.
- Optional lightweight retrieval index.

Default TTL:

- 24 hours for current page/recently viewed.
- 7 days only if user enables course cache.

#### Tier 3: Optional Local Vector Index

Used for:

- Embeddings for cleaned chunks.

Rules:

- Local-only.
- User-visible.
- Clearable per course.
- Disabled when no embedding provider is configured.

### Cloud Provider Warning

Before sending Canvas snippets to a cloud model, the UI must disclose:

```text
Selected Canvas context will be sent to your configured model provider to answer this question.
```

For local models:

```text
Canvas context is sent to your local model endpoint.
```

### Sensitive Content Filters

The extension should detect and optionally exclude:

- Grades.
- Submission comments.
- Student discussion replies.
- Names/emails in discussion threads.
- Peer review content.
- Accommodations or private feedback.

MVP default: include instructor/course-authored content, exclude student replies unless user enables them.

## 14. Data Model

### CanvasCourse

```ts
type CanvasCourse = {
  id: string
  domain: string
  name?: string
  lastSeenAt: number
}
```

### CanvasSourceCitation

```ts
type CanvasSourceCitation = {
  id: string
  courseId: string
  docId: string
  title: string
  type: CanvasContextDoc["type"]
  url: string
  collectedAt: number
}
```

### CanvasCacheEntry

```ts
type CanvasCacheEntry = {
  id: string
  courseId: string
  url: string
  title: string
  type: CanvasContextDoc["type"]
  chunks: CanvasChunk[]
  sourceHash: string
  collectedAt: number
  expiresAt: number
}
```

### Storage Tables

Recommended IndexedDB tables:

```ts
canvasCourses: "id, domain, name, lastSeenAt"
canvasSources: "id, courseId, url, title, type, collectedAt, expiresAt"
canvasChunks: "id, courseId, docId, type, title, url, collectedAt, expiresAt"
canvasEmbeddings: "id, courseId, chunkId, vector, modelId, createdAt, expiresAt"
canvasSettings: "id, value"
```

## 15. Proposed Code Architecture

```text
src/canvas/
  detect.ts
  permissions.ts
  collect/
    active-page.ts
    link-discovery.ts
    fetch-canvas-page.ts
    collect-module.ts
    collect-recent.ts
  parse/
    index.ts
    base.ts
    assignment.ts
    module.ts
    page.ts
    discussion.ts
    announcement.ts
    syllabus.ts
    file.ts
  retrieval/
    chunk.ts
    keyword.ts
    embedding.ts
    hybrid.ts
    intent.ts
  prompt/
    build-canvas-prompt.ts
    citations.ts
  cache/
    schema.ts
    course-cache.ts
    ttl.ts
    clear-cache.ts
  ui/
    CanvasContextScope.tsx
    CanvasSourceChips.tsx
    CanvasCacheSettings.tsx
    CanvasCollectionStatus.tsx
  chat/
    canvasChatMode.ts
```

## 16. Canvas Chat Mode

Create a dedicated chat mode rather than overloading generic RAG:

```ts
async function canvasChatMode(params: {
  message: string
  tabId: number
  selectedModel: string
  scope: CanvasContextScope
  history: ChatHistory
  signal: AbortSignal
}) {
  const route = await detectCanvasRouteFromTab(tabId)
  const contextDocs = await collectCanvasContext({ tabId, route, scope, signal })
  const chunks = await chunkCanvasDocs(contextDocs)
  await cacheCanvasChunks(chunks)
  const retrieved = await retrieveCanvasContext({ query: params.message, route, scope })
  const modelMessages = await buildCanvasPrompt({
    question: params.message,
    history: params.history,
    retrieved
  })
  const model = await pageAssistModel({ model: params.selectedModel, baseUrl })
  return model.stream(modelMessages, { signal })
}
```

Routing priority:

1. If active tab is Canvas and Canvas context is enabled, use `canvasChatMode`.
2. If user attaches non-Canvas files, use document mode.
3. If user disables Canvas context, use normal chat.

## 17. Permissions

### Required

- `storage`
- `activeTab`
- `scripting`
- `sidePanel`
- `contextMenus`
- `notifications` optional
- Host permission for configured Canvas domains.

### Optional

- File host domains only if institution uses external file/CDN domains.
- Downloads only if required for file extraction; avoid for MVP if possible.

### Permission UX

During setup:

- Ask user to add their Canvas domain.
- Explain why the extension needs access:

```text
This extension reads Canvas pages you open so it can provide course context to your selected model.
```

## 18. Edge Cases

### Locked Or Unpublished Content

Do not attempt to access. Mark as unavailable if visible as locked.

### SSO Redirects

If fetch receives login/SSO HTML instead of Canvas content, detect it and stop. Ask user to open the page manually.

### Cross-Origin Iframes

Do not bypass iframe restrictions. Show metadata:

```text
Embedded external content detected. Open it directly to include it.
```

### Large Files

Use limits:

- Max PDF size MVP: 20 MB.
- Max pages parsed per file: configurable, default 80.
- Timeout: 30 seconds.
- User cancellation required.

### Scanned PDFs

Detect low text extraction. Do not run OCR by default. Offer optional OCR with warning about speed/accuracy.

### Discussions

Default exclude student replies. Include prompt/discussion description and instructor posts where reliably detectable.

### Quizzes

High-risk. MVP should not parse active quiz attempt pages. It may parse quiz overview instructions only, not questions/answers.

## 19. Security Requirements

- Sanitize all HTML before rendering snippets in extension UI.
- Never execute scripts from Canvas HTML.
- Store text only after parsing; discard raw HTML.
- Restrict fetches to allowlisted Canvas domains.
- Prevent SSRF-like arbitrary URL fetching from user prompts.
- Treat all Canvas text as untrusted input.
- Avoid including credentials, cookies, or auth tokens in prompts.
- Do not log raw Canvas content to console in production.
- Add a debug mode that redacts content by default.

## 20. Observability

Local-only telemetry counters may include:

- Number of sources collected.
- Number of chunks retrieved.
- Parse failures by route type.
- Cache size.
- Collection duration.

Do not collect or transmit course content, source titles, URLs, names, or questions unless the user explicitly opts into diagnostics.

## 21. MVP Scope

### Must Have

- Canvas domain detection.
- Side panel only on Canvas pages.
- Current page extraction.
- Assignment/page/syllabus/module basic parsers.
- Clean text chunking.
- Keyword retrieval over current page and recently viewed Canvas pages.
- Prompt construction with source citations.
- Local cache with TTL and clear button.
- Cloud/local model disclosure.
- Answer streaming through existing model adapter pattern.

### Should Have

- Current module context collection.
- PDF text extraction for Canvas files.
- Recently viewed Canvas page cache.
- Source chips in answers.
- Sensitive discussion reply exclusion.
- Per-course cache size cap.

### Could Have

- Local embedding retrieval.
- Optional user-triggered course cache builder.
- Announcement/discussion richer parsers.
- OCR for scanned PDFs.
- Custom parser rules per institution.

### Won't Have In MVP

- Canvas API integration.
- Gradebook integration.
- Quiz attempt parsing.
- Full automatic course crawling.
- Server-side storage.
- Cross-origin LTI scraping.

## 22. Acceptance Criteria

### Current Assignment Question

Given a user opens a Canvas assignment page and asks “what do I need to submit?”, the extension should:

- Detect Canvas route as `assignment`.
- Extract title, instructions, due date text if visible, and submission details.
- Build a prompt containing only relevant assignment context.
- Answer with at least one source citation.
- Store no raw HTML after parsing.

### Current Module Question

Given a user opens a Canvas modules page and chooses `Current module`, the extension should:

- Discover visible module item links.
- Fetch only same-domain Canvas links in that module.
- Respect max item and time limits.
- Parse collected pages.
- Retrieve relevant snippets.
- Show collection status and allow cancellation.

### Privacy Cache

Given cached Canvas content exists, the user should be able to:

- View courses with cached content.
- See approximate cache size.
- Clear one course cache.
- Clear all Canvas cache.
- See cache expiration settings.

### Cloud Provider Warning

Given the selected model is a cloud provider and Canvas context is enabled, the send button area should display a concise warning that selected Canvas snippets will be sent to the provider.

## 23. Implementation Plan

### Phase 1: Canvas Detection And Current Page Context

- Add Canvas domain configuration.
- Add `detect.ts`.
- Add active-page collector.
- Add base parser and assignment/page/syllabus/module parser.
- Add Canvas context preview UI.
- Add `canvasChatMode` using current page only.

### Phase 2: Local Cache And Retrieval

- Add Canvas IndexedDB tables.
- Add chunker.
- Add keyword retrieval.
- Add TTL expiration.
- Add cache settings UI.
- Add source citations.

### Phase 3: Module And File Context

- Add module link discovery.
- Add bounded same-session fetch.
- Add PDF extraction.
- Add collection progress/cancellation.
- Add current module scope.

### Phase 4: Privacy And Quality Hardening

- Add sensitive-content filters.
- Add cloud provider warning.
- Add quiz-attempt exclusion.
- Add SSO redirect detection.
- Add parser tests with fixture HTML.
- Add cache size enforcement.

### Phase 5: Optional Embeddings

- Add local embedding retrieval using configured model.
- Add hybrid scoring.
- Add course-level vector index.
- Add explicit opt-in for longer-lived course cache.

## 24. Testing Strategy

### Unit Tests

- URL route detection.
- Domain allowlist.
- HTML pruning.
- Assignment parser.
- Module parser.
- Syllabus parser.
- Chunking.
- Keyword retrieval.
- Prompt builder.
- Sensitive-content filters.

### Fixture Tests

Use saved redacted Canvas HTML fixtures:

```text
fixtures/canvas/assignment.html
fixtures/canvas/modules.html
fixtures/canvas/page.html
fixtures/canvas/syllabus.html
fixtures/canvas/discussion.html
fixtures/canvas/file-preview.html
fixtures/canvas/sso-redirect.html
```

Fixtures must be redacted and should not contain real student data.

### Browser Tests

- Side panel opens on Canvas domain.
- Current page context is collected.
- Source chips render.
- Cache clear works.
- Cloud provider warning appears.
- Non-Canvas page shows empty state.

### Manual QA

- Assignment with rubric.
- Module with mixed item types.
- PDF file preview.
- Syllabus with course summary table.
- Discussion with student replies.
- SSO timeout.
- Locked module item.
- Cloud model vs local model disclosure.

## 25. Production Risks And Mitigations

### Risk: Canvas DOM Changes

Mitigation:

- Prefer resilient content extraction from main content areas.
- Use route-specific selectors only as enhancements.
- Maintain fixture coverage.

### Risk: Over-Collection

Mitigation:

- Default to current page.
- Require explicit scope expansion.
- Cap pages/files/time.
- Show collection progress.

### Risk: Sensitive Data Sent To Cloud Model

Mitigation:

- Source preview before send.
- Cloud warning.
- Exclude student replies by default.
- Local model recommendation.

### Risk: Stale Due Dates

Mitigation:

- Include collection timestamp.
- Re-collect current page on each question when deadline intent is detected.
- Cite source.

### Risk: Incomplete Context

Mitigation:

- Answer should say when information was not found.
- UI should show which sources were used.
- Offer “expand to current module” action after weak retrieval.

## 26. Agent Work Breakdown

### Agent A: Canvas Detection And Permissions

Owns:

- `src/canvas/detect.ts`
- `src/canvas/permissions.ts`
- Canvas domain settings UI
- Route detection tests

### Agent B: Collectors

Owns:

- `src/canvas/collect/active-page.ts`
- `src/canvas/collect/link-discovery.ts`
- `src/canvas/collect/fetch-canvas-page.ts`
- SSO/redirect detection

### Agent C: Parsers

Owns:

- `src/canvas/parse/*`
- Redacted fixtures
- Parser unit tests

### Agent D: Cache And Data Model

Owns:

- `src/canvas/cache/*`
- Dexie schema additions
- TTL expiration
- cache clear UI hooks

### Agent E: Retrieval And Prompting

Owns:

- `src/canvas/retrieval/*`
- `src/canvas/prompt/*`
- citation extraction
- prompt tests

### Agent F: Chat Mode Integration

Owns:

- `src/canvas/chat/canvasChatMode.ts`
- routing from existing chat hooks
- streaming integration
- source metadata propagation

### Agent G: UI

Owns:

- Canvas side-panel indicators
- context scope selector
- source chips
- collection status
- cloud provider warning
- cache settings page

### Agent H: QA And Privacy Hardening

Owns:

- sensitive content filters
- quiz exclusion
- manual QA checklist
- production logging cleanup
- security review

## 27. Open Product Decisions

- Should the MVP allow current module collection, or only current page plus recently viewed pages?
- What is the default cache TTL: session-only, 24 hours, or 7 days?
- Should student discussion replies be completely excluded or user-toggleable?
- Which Canvas domains are supported initially: exact school domain only or any `*.instructure.com`?
- Should the extension support cloud providers at launch or local-only first?
- What maximum file size/page count is acceptable for Canvas PDFs?
- Should users be able to inspect context snippets before sending every question?

## 28. Recommended MVP Defaults

- Context scope: current page only.
- Recently viewed cache: enabled, cleaned chunks only, 24-hour TTL.
- Course cache builder: disabled until Phase 3 or Phase 4.
- Student discussion replies: excluded.
- Quiz attempts: excluded.
- Raw HTML persistence: disabled.
- Cloud models: allowed only with visible warning.
- Local models: recommended default.
- Max prompt context: 8 chunks or model-aware token budget.
- Source citations: required.

