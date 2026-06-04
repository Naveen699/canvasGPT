# PRD: CanvasGPT OpenAI File Search Course Index

## 1. Product Summary

CanvasGPT is a Chrome extension and local FastAPI backend that helps students ask questions about the currently open Canvas LMS course. The extension uses the student's authenticated Canvas browser session to collect course material metadata and accessible Canvas course content. The backend stores a local catalog in SQLite, uploads changed course materials to an OpenAI-hosted vector store, and answers prompts with the OpenAI Responses API `file_search` tool.

The vector store is hosted by OpenAI. SQLite does not contain embeddings or vector-search data. SQLite stores only the local pointer/catalog data needed to reuse the OpenAI vector store, skip unchanged materials, track indexing status, and map OpenAI file citations back to Canvas source metadata.

The intended high-level flow is:

```text
Student opens Canvas course
  -> extension collects deduplicated Canvas course manifest
  -> student asks first question
  -> extension asks for per-course OpenAI indexing consent
  -> backend creates/reuses OpenAI vector store
  -> backend stores vector_store_id in SQLite
  -> backend uploads/indexes new or changed Canvas materials
  -> backend answers prompt using Responses API file_search
  -> side panel renders answer, citations, indexing warnings, and source links
```

## 2. Goals

- Let students ask natural-language questions about Canvas course materials without manually uploading files.
- Replace manual prompt-context construction and local file parsing with OpenAI File Search over a course-scoped vector store.
- Keep Canvas access browser-session-only for v1; do not require Canvas OAuth, Canvas developer keys, or server-side Canvas credentials.
- Cache only local metadata and OpenAI IDs so repeat prompts and repeat sessions avoid re-uploading unchanged materials.
- Deduplicate large course manifests before syncing so repeated links, files, and module references do not create repeated vector store files.
- Provide citations that link back to Canvas source titles, source types, URLs, and module placements when known.
- Make remote OpenAI storage explicit through per-course user consent.
- Keep the architecture compatible with a future hosted backend and authentication layer.

## 3. Non-Goals

- No external website indexing in v1.
- No Canvas OAuth or server-side Canvas API credentials in v1.
- No local vector database in v1.
- No OCR, audio transcription, video transcription, archive unpacking, or image-only file extraction in v1.
- No student discussion reply indexing in v1.
- No automatic indexing before the student asks the first prompt.
- No answer streaming in v1. The backend returns one complete answer payload.
- No gradebook, submission automation, quiz automation, or Canvas permission bypassing.

## 4. Locked Product Decisions

- The current PRD replaces the previous local parsing/local retrieval direction.
- The backend is local FastAPI for v1.
- The OpenAI API key is provided by the developer/user in the local backend environment as `OPENAI_API_KEY`.
- The answer model is configured by `OPENAI_RESPONSE_MODEL`.
- Indexing starts on the first prompt, not immediately after material collection.
- The first prompt waits through staged indexing and then answers once usable indexed content exists.
- The student must provide per-course opt-in before Canvas materials are uploaded to OpenAI.
- v1 indexes Canvas-only sources:
  - Canvas pages
  - assignments
  - announcements
  - discussion topic prompts and instructor-authored topic text
  - module metadata
  - Canvas-hosted files
- v1 skips:
  - external websites
  - student discussion replies
  - files over 60 MB
  - file types not supported by OpenAI File Search
- OpenAI vector stores and uploaded files use a default 7-day inactive retention policy.
- Clearing a course index performs a full local and remote delete.

## 5. Current Implementation Baseline

The current repository is a JavaScript Chrome extension with a local FastAPI backend:

- `content/canvasApiClient.js` collects Canvas course data through the active browser session.
- `sidepanel/sidepanel.js` currently displays collected materials.
- `background.js` coordinates active-tab Canvas checks and content-script messaging.
- `backend/main.py` currently exposes a simple `/health` endpoint and `/extract` endpoint.
- `canvas-lms-extension-prd.md` is the root PRD and is now the source of truth for the File Search architecture.

The implementation should evolve this baseline rather than relying on the older local-parser PRD architecture.

## 6. Architecture

### 6.1 Components

```text
Chrome side panel
  - displays current course status
  - accepts prompts
  - asks for per-course OpenAI indexing consent
  - renders answers, citations, warnings, and clear-index controls

Background service worker
  - verifies active tab is a Canvas course
  - coordinates extension/content-script messages
  - forwards side panel requests to the content script

Canvas content script
  - uses the user's existing Canvas browser session
  - collects course manifest and Canvas-native content available through same-origin Canvas APIs
  - resolves Canvas file metadata and signed public URLs only for Canvas-hosted files selected for sync

Local FastAPI backend
  - owns OpenAI API calls
  - owns SQLite metadata catalog
  - creates/reuses OpenAI vector stores
  - uploads files and synthetic Markdown documents to OpenAI
  - calls Responses API with file_search
  - maps OpenAI file citations back to Canvas metadata

OpenAI
  - hosts uploaded files
  - hosts vector stores
  - chunks, embeds, and indexes vector store files
  - runs Responses API answer generation with file_search
```

### 6.2 SQLite Is A Catalog, Not The Vector Store

SQLite stores:

- Canvas origin, course ID, course name, and Canvas current-user identity when available.
- OpenAI `vector_store_id`.
- OpenAI uploaded file IDs.
- OpenAI vector store file IDs.
- Material hashes and Canvas update timestamps.
- Sync generation IDs.
- Indexing status and error records.
- Citation metadata needed by the UI.

SQLite does not store:

- embeddings
- vector chunks
- OpenAI vector-store search indexes
- raw Canvas files
- Canvas cookies or access tokens
- long-lived raw Canvas HTML or full course dumps

Prompt-time lookup is:

```text
course identity
  -> SQLite course row
  -> vector_store_id
  -> Responses API file_search
  -> OpenAI-hosted vector store
  -> OpenAI file IDs in citations/results
  -> SQLite citation metadata
  -> UI source chips
```

## 7. Course Identity And Isolation

The backend must key a course index by:

```text
canvas_origin + course_id + canvas_user_id_or_profile_key
```

The extension should collect Canvas current-user/profile information when available from Canvas same-origin APIs. If Canvas user identity is unavailable, the extension must send a generated extension profile key so the backend does not use only origin + course ID on shared machines.

The SQLite schema must include nullable fields for future hosted authentication:

- `local_profile_id`
- `canvas_user_id`
- `hosted_user_id`
- `auth_subject`

For v1, `hosted_user_id` and `auth_subject` remain empty.

## 8. Course Manifest

### 8.1 Manifest Purpose

The manifest is the lightweight course inventory sent from the extension to the backend. It lets the backend decide what is new, changed, unchanged, unsupported, or stale before any upload work happens.

The manifest must be deduplicated before backend sync.

### 8.2 Manifest Shape

The extension sends:

```json
{
  "canvasOrigin": "https://canvas.example.edu",
  "courseId": "12345",
  "courseName": "Biology 101",
  "canvasUserId": "67890",
  "localProfileId": "profile_abc",
  "collectedAt": "2026-06-04T12:00:00Z",
  "materials": [],
  "placements": [],
  "collectionErrors": []
}
```

Each material contains:

```json
{
  "materialKey": "assignment:77",
  "kind": "assignment",
  "title": "Midterm Policy",
  "canvasUrl": "https://canvas.example.edu/courses/12345/assignments/77",
  "canvasUpdatedAt": "2026-05-31T10:00:00Z",
  "contentHash": "sha256:...",
  "size": 0,
  "contentType": "",
  "body": "Canvas-native body when available",
  "fileId": "",
  "fileName": "",
  "fileDownloadUrl": "",
  "supportedForIndexing": true
}
```

Each placement contains:

```json
{
  "materialKey": "file:123",
  "sourceKind": "module",
  "moduleId": "456",
  "moduleName": "Week 4",
  "moduleItemId": "789",
  "position": 3,
  "label": "Week 4 Slides"
}
```

### 8.3 Canvas-Native Content

Canvas-native records are uploaded as synthetic Markdown files, one Markdown file per material:

- one per page
- one per assignment
- one per announcement
- one per discussion topic prompt
- one per module summary record when the module item itself is not otherwise represented by a page, assignment, discussion, or file

The Markdown file must include a compact metadata header and the cleaned body:

```markdown
# Midterm Policy

Source type: assignment
Course: Biology 101
Canvas material key: assignment:77
Canvas URL: https://canvas.example.edu/courses/12345/assignments/77
Module placements: Week 7
Updated at: 2026-05-31T10:00:00Z

<cleaned Canvas body text>
```

This improves citation quality and delta sync. The backend must use batch ingestion so hundreds of materials do not become hundreds of repeated upload/index operations on every prompt.

## 9. Deduplication

Deduplication happens before backend sync.

Stable keys:

- Canvas file: `file:<file_id>`
- Canvas page: `page:<page_url_or_page_id>`
- Assignment: `assignment:<assignment_id>`
- Announcement: `announcement:<announcement_id>`
- Discussion topic: `discussion:<discussion_topic_id>`
- Module item without represented target: `module_item:<module_item_id>`
- Canvas link fallback: `canvas_url:<normalized_canvas_url>`

URL normalization must:

- keep only Canvas-origin URLs for v1 indexing
- lowercase hostnames
- remove trailing slashes where safe
- remove fragments
- remove known tracking parameters where safe
- unwrap Canvas redirect URLs when the target is still Canvas-origin

Duplicate placements are preserved in `material_placements` instead of duplicating uploaded files.

## 10. File Handling

### 10.1 Supported Files

The backend must maintain an allowlist based on OpenAI File Search-supported file types. It must pre-filter files before upload and record skipped files as warnings.

The allowlist should include common Canvas course document/text formats that OpenAI File Search supports, such as PDF, Office document/presentation formats where supported, HTML, plain text, Markdown, JSON, CSV/TSV, XML, and source/text-like files.

The allowlist must be implemented centrally so it can be updated as OpenAI support changes.

### 10.2 File Size

Files over 60 MB are skipped.

Skipped files must be visible in the answer warning/status payload:

```json
{
  "materialKey": "file:123",
  "title": "Lecture Recording.mp4",
  "reason": "too_large",
  "message": "Skipped because the file is larger than the 60 MB indexing limit."
}
```

### 10.3 Signed URLs

The extension must not send Canvas cookies, access tokens, or Authorization headers to the backend.

For Canvas-hosted files selected for sync:

1. The content script verifies the active tab is still the expected Canvas course.
2. The content script calls Canvas same-origin file APIs using the browser session.
3. The content script returns only a short-lived signed file URL plus verified metadata.
4. The backend fetches the signed URL, uploads the file to OpenAI, and discards bytes immediately after upload.

Signed URLs must not be logged.

## 11. OpenAI Vector Store Lifecycle

### 11.1 Creation

On first prompt after consent:

1. Backend receives course identity and manifest.
2. Backend computes the user/course key.
3. Backend checks SQLite for an existing active course row.
4. If no row exists, backend creates an OpenAI vector store.
5. Backend stores `vector_store_id` in SQLite.
6. Backend begins staged sync.

Vector store name format:

```text
canvasgpt:<hashed_canvas_origin>:<course_id>:<profile_or_user_hash>
```

Do not include raw student names or sensitive personal data in vector store names.

### 11.2 Retention

The backend sets a 7-day inactive expiration policy where supported by the OpenAI API.

The backend also stores local `expires_at` and `last_active_at` values in SQLite for cleanup and UI display.

### 11.3 Sync Generations

Each sync run creates an `active_generation_id`, such as:

```text
sync_2026_06_04_120000_abcd
```

Every vector store file for the current sync must include this generation ID as an attribute when attached.

Prompt-time File Search must filter on `generation_id` where possible so stale files from prior syncs are not retrieved.

Old generation files can be deleted after a successful newer generation is ready. If deletion fails, the filter prevents stale retrieval.

### 11.4 Batch Ingestion

The backend must use OpenAI vector store file batch operations for throughput. Batches can contain up to 500 files, so this design can handle courses with hundreds of pages, discussions, links, and files without sending a separate vector-store attach request for every item.

Upload and attach work should be chunked into bounded batches:

```text
native Markdown files batch 1
native Markdown files batch 2 if needed
Canvas file batch 1
Canvas file batch 2 if needed
```

The backend records per-material status so partial failures do not fail the entire course.

## 12. Staged First-Prompt Indexing

First prompt behavior:

1. Student enters prompt.
2. Extension confirms course manifest is collected or collects it.
3. Extension requests per-course consent if not already granted.
4. Backend prepares/reuses vector store.
5. Backend syncs Canvas-native Markdown materials first.
6. Backend starts Canvas file uploads in batches.
7. Backend answers once Canvas-native content is indexed and at least one usable source exists.
8. The answer includes warnings for pending, skipped, or failed file indexing.

The first prompt should not return "try again later" unless indexing fails completely or no usable Canvas materials are available.

If file indexing continues after the first answer, status polling should show progress and later prompts should benefit from more indexed files.

## 13. Retrieval And Answer Generation

v1 uses the OpenAI Responses API `file_search` tool directly. It does not perform a separate vector store pre-search before answer generation.

Backend answer flow:

```text
prompt + course identity
  -> validate request
  -> load course row from SQLite
  -> verify vector_store_id exists
  -> ensure index is ready or partially usable
  -> call Responses API with file_search
  -> include file_search_call.results for citation/debug metadata
  -> map OpenAI file IDs to Canvas material rows
  -> return answer payload
```

Tool configuration:

```json
{
  "type": "file_search",
  "vector_store_ids": ["vs_..."],
  "filters": {
    "type": "eq",
    "key": "generation_id",
    "value": "sync_..."
  }
}
```

The system prompt must instruct the model:

- answer only from indexed Canvas course materials for course-specific claims
- say when indexed context is insufficient
- do not invent deadlines, grading policies, instructor intent, exam scope, or submission requirements
- cite course-specific claims
- do not claim to access Canvas live during answer generation

The backend should request included File Search results for citation/debug metadata. The UI should not display raw retrieved snippets in v1.

## 14. Backend API

### 14.1 `GET /health`

Existing health endpoint remains.

Response:

```json
{ "status": "ok" }
```

### 14.2 `POST /course-index/prepare`

Creates or retrieves the local course record and OpenAI vector store, computes sync plan, and returns consent/index state.

Request:

```json
{
  "canvasOrigin": "https://canvas.example.edu",
  "courseId": "12345",
  "courseName": "Biology 101",
  "canvasUserId": "67890",
  "localProfileId": "profile_abc",
  "manifest": {
    "materials": [],
    "placements": [],
    "collectionErrors": []
  }
}
```

Response:

```json
{
  "courseIndexId": "local_course_abc",
  "consentRequired": true,
  "consentGranted": false,
  "vectorStoreStatus": "not_created",
  "syncPlan": {
    "newCount": 120,
    "changedCount": 0,
    "unchangedCount": 0,
    "staleCount": 0,
    "skippedCount": 12
  },
  "warnings": []
}
```

### 14.3 `POST /course-index/consent`

Records per-course consent for OpenAI remote indexing.

Request:

```json
{
  "courseIndexId": "local_course_abc",
  "granted": true
}
```

Response:

```json
{
  "courseIndexId": "local_course_abc",
  "consentGranted": true
}
```

### 14.4 `POST /course-index/sync`

Runs staged sync for new/changed materials.

Request:

```json
{
  "courseIndexId": "local_course_abc",
  "generationId": "sync_2026_06_04_120000_abcd",
  "materials": [],
  "signedFiles": []
}
```

Response:

```json
{
  "courseIndexId": "local_course_abc",
  "generationId": "sync_2026_06_04_120000_abcd",
  "status": "partial",
  "nativeIndexedCount": 96,
  "fileIndexedCount": 20,
  "pendingFileCount": 10,
  "skippedCount": 12,
  "failedCount": 2,
  "warnings": []
}
```

### 14.5 `GET /course-index/status`

Returns current indexing state.

Query parameters:

```text
canvasOrigin
courseId
canvasUserId or localProfileId
```

Response:

```json
{
  "courseIndexId": "local_course_abc",
  "status": "ready",
  "vectorStoreId": "vs_abc",
  "lastSyncedAt": "2026-06-04T12:00:00Z",
  "expiresAt": "2026-06-11T12:00:00Z",
  "counts": {
    "materials": 182,
    "indexed": 170,
    "pending": 0,
    "skipped": 12,
    "failed": 0
  },
  "warnings": []
}
```

### 14.6 `DELETE /course-index/course`

Fully clears a course index.

Delete behavior:

- delete vector store files from the OpenAI vector store
- delete uploaded OpenAI files
- delete the OpenAI vector store
- delete local SQLite rows for the course index

Response:

```json
{
  "deleted": true,
  "remoteDeleted": true,
  "localDeleted": true,
  "warnings": []
}
```

### 14.7 `POST /generate-response`

Generates an answer using File Search over the course vector store.

Request:

```json
{
  "canvasOrigin": "https://canvas.example.edu",
  "courseId": "12345",
  "canvasUserId": "67890",
  "localProfileId": "profile_abc",
  "prompt": "What is the midterm policy?"
}
```

Response:

```json
{
  "answer": "The indexed course materials say ...",
  "insufficientContext": false,
  "citations": [
    {
      "materialKey": "assignment:77",
      "title": "Midterm Policy",
      "kind": "assignment",
      "canvasUrl": "https://canvas.example.edu/courses/12345/assignments/77",
      "placements": ["Week 7"]
    }
  ],
  "warnings": [
    "10 Canvas files are still indexing and were not available for this answer."
  ]
}
```

## 15. SQLite Schema

The implementation may use Python `sqlite3` directly. The default path is:

```text
backend/.data/canvasgpt.sqlite3
```

The path can be overridden with:

```text
CANVASGPT_DB_PATH
```

`backend/.data/` must be gitignored.

### 15.1 `courses`

```text
id TEXT PRIMARY KEY
canvas_origin TEXT NOT NULL
course_id TEXT NOT NULL
course_name TEXT
canvas_user_id TEXT
local_profile_id TEXT
hosted_user_id TEXT
auth_subject TEXT
course_key_hash TEXT NOT NULL UNIQUE
vector_store_id TEXT
active_generation_id TEXT
consent_granted INTEGER NOT NULL DEFAULT 0
sync_status TEXT NOT NULL DEFAULT 'not_started'
last_synced_at TEXT
last_active_at TEXT
expires_at TEXT
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
```

### 15.2 `materials`

```text
id TEXT PRIMARY KEY
course_id TEXT NOT NULL
material_key TEXT NOT NULL
kind TEXT NOT NULL
title TEXT
canvas_url TEXT
canvas_updated_at TEXT
content_hash TEXT
size INTEGER
content_type TEXT
file_name TEXT
openai_file_id TEXT
vector_store_file_id TEXT
generation_id TEXT
status TEXT NOT NULL
error_type TEXT
error_message TEXT
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
UNIQUE(course_id, material_key)
```

### 15.3 `material_placements`

```text
id TEXT PRIMARY KEY
course_id TEXT NOT NULL
material_key TEXT NOT NULL
source_kind TEXT
module_id TEXT
module_name TEXT
module_item_id TEXT
position INTEGER
label TEXT
created_at TEXT NOT NULL
```

### 15.4 `sync_runs`

```text
id TEXT PRIMARY KEY
course_id TEXT NOT NULL
generation_id TEXT NOT NULL
status TEXT NOT NULL
new_count INTEGER NOT NULL DEFAULT 0
changed_count INTEGER NOT NULL DEFAULT 0
unchanged_count INTEGER NOT NULL DEFAULT 0
indexed_count INTEGER NOT NULL DEFAULT 0
pending_count INTEGER NOT NULL DEFAULT 0
skipped_count INTEGER NOT NULL DEFAULT 0
failed_count INTEGER NOT NULL DEFAULT 0
warnings_json TEXT
started_at TEXT NOT NULL
completed_at TEXT
```

## 16. Extension UX

### 16.1 Main Side Panel

The side panel should show:

- current Canvas course indicator
- material collection/index status
- prompt field
- send action
- answer area
- citation/source chips
- warnings area
- clear course index action

### 16.2 Consent Copy

Before the first course index upload:

```text
CanvasGPT can index this course with OpenAI File Search so answers can use your Canvas materials.

This uploads Canvas course pages, assignments, announcements, discussion prompts, module metadata, and supported Canvas files to OpenAI storage for this course. External websites and student discussion replies are not indexed. The course index expires after 7 inactive days and can be deleted at any time.
```

Actions:

- `Index this course`
- `Cancel`

### 16.3 Status States

The UI must handle:

- `not_collected`
- `needs_consent`
- `preparing`
- `uploading_native`
- `uploading_files`
- `indexing`
- `partial`
- `ready`
- `failed`
- `clearing`

### 16.4 Citations

Citation chips show:

- source title
- source type
- Canvas URL
- module placement when known

The UI should not show raw File Search snippets in v1.

## 17. Security And Privacy

- Treat all Canvas course data as sensitive.
- Do not send Canvas cookies, access tokens, or Authorization headers to the backend.
- Reject backend requests that include credential-bearing headers on sync and generation endpoints.
- Do not log raw prompts, Canvas bodies, file bytes, signed URLs, cookies, credentials, or full request payloads.
- Store raw Canvas-native bodies only transiently for Markdown upload; do not persist them locally after upload.
- Store file bytes only transiently during backend upload to OpenAI; discard immediately after upload.
- Do not index external websites in v1.
- Do not index student discussion replies in v1.
- Provide a visible clear-index action.
- Keep backend CORS permissive only for local development; production/hosted mode must restrict origins.

## 18. Failure Modes

### 18.1 Canvas Collection Partial Failure

If some Canvas categories fail, the extension still sends available materials and records collection errors.

The answer may proceed with warnings when indexed materials are usable.

### 18.2 OpenAI Vector Store Creation Failure

Return a clear setup error. Do not record consent as successful indexing. Preserve the student's prompt so retry is possible.

### 18.3 Upload Failure

Record per-material failures. Continue with other materials.

### 18.4 Indexing Timeout

Return partial status if at least one useful material is indexed. If nothing useful is indexed, show failure and allow retry.

### 18.5 Citation Mapping Failure

If OpenAI returns a file ID not present in SQLite, omit that citation from UI source chips and add a backend warning. Do not invent source metadata.

### 18.6 Remote Delete Failure

Delete local rows only after remote deletion succeeds or record a cleanup-required warning. The UI must surface that remote cleanup may need retry.

## 19. Performance And Cost Controls

- Do not sync until first prompt and consent.
- Deduplicate before sync.
- Skip unchanged materials by `contentHash` and Canvas update timestamp.
- Use one Markdown file per Canvas-native material for citation quality, but attach them in batches for efficiency.
- Use vector store file batches up to OpenAI's batch limit.
- Pre-filter unsupported and oversized files before upload.
- Keep vector stores alive for 7 inactive days to avoid re-indexing on repeat study sessions.
- Do not delete vector stores immediately after each prompt.
- Include pending/skipped file warnings instead of blocking all answers on slow file ingestion.

## 20. Implementation Milestones

### Milestone 1: Backend Catalog And OpenAI Vector Store Manager

- Add OpenAI dependency.
- Add SQLite initialization and repository helpers.
- Add course key hashing and local profile/user isolation.
- Add vector store create/retrieve/delete helpers.
- Add file upload and vector store batch attach helpers.

### Milestone 2: Manifest Normalization And Sync Planning

- Normalize collected Canvas materials into stable material keys.
- Deduplicate materials and preserve placements.
- Compute content hashes for Canvas-native materials.
- Compare manifest against SQLite.
- Return sync plan and warnings.

### Milestone 3: Staged Indexing

- Serialize Canvas-native materials to Markdown.
- Upload Markdown files first.
- Resolve and upload supported Canvas files.
- Poll vector store file/batch statuses.
- Store per-material success, pending, skipped, and failure states.

### Milestone 4: File Search Answer Endpoint

- Resolve `vector_store_id` by course identity.
- Call Responses API with `file_search`.
- Filter by active generation when possible.
- Include File Search results for citation/debug metadata.
- Map OpenAI file IDs to Canvas metadata.
- Return non-streaming answer JSON.

### Milestone 5: Extension UX

- Add prompt/answer UI.
- Add per-course consent dialog.
- Add indexing progress/status UI.
- Add citation chips and warnings.
- Add clear-index control.

### Milestone 6: Cleanup And Hardening

- Implement full clear-index deletion.
- Add retention cleanup hooks.
- Add request validation and credential-header rejection.
- Add sensitive-log safeguards.
- Add tests and update README/backend run instructions if commands change.

## 21. Test Plan

### 21.1 Backend Unit Tests

- Creates a course row and vector store ID for a new user/course key.
- Reuses an existing vector store ID for unchanged course identity.
- Differentiates same Canvas course across different Canvas users/local profiles.
- Computes sync plans with new, changed, unchanged, stale, skipped, and failed materials.
- Deduplicates duplicate files/links while preserving placements.
- Serializes Canvas-native records into Markdown.
- Skips files over 60 MB.
- Skips unsupported file types before upload.
- Uses batch attach for large material sets.
- Records partial failures without failing the full sync.
- Maps OpenAI file IDs to Canvas citation metadata.
- Rejects sync/generation requests containing Cookie or Authorization headers.
- Full delete calls remote delete helpers and removes local rows.

### 21.2 Extension Tests

- Non-Canvas pages cannot collect or index.
- Canvas course pages collect a deduplicated manifest.
- Current-user/profile data is included when available.
- First prompt requests consent before backend sync.
- Canceling consent does not create/upload/index materials.
- Consent accepted starts staged indexing.
- Partial indexing shows warnings and still allows answer generation.
- Citation chips render title, type, Canvas URL, and module placement.
- Clear-index action calls delete endpoint and resets UI state.

### 21.3 Manual Verification

- Course with hundreds of links/materials deduplicates correctly.
- Course with many files uses staged indexing and stays responsive.
- Course with inaccessible Canvas categories still indexes available materials.
- Course with unsupported/oversized files reports useful warnings.
- Repeat prompt after first indexing reuses the stored vector store.
- Repeat session within 7 days avoids re-uploading unchanged materials.
- Clearing a course index removes remote and local state.

### 21.4 Required Commands

Run after implementation changes:

```bash
npm run typecheck
npm run build
```

Backend tests should be added and run with the selected Python test runner once introduced.

## 22. Environment Variables

Required:

```text
OPENAI_API_KEY
OPENAI_RESPONSE_MODEL
```

Optional:

```text
CANVASGPT_DB_PATH
CANVASGPT_INDEX_RETENTION_DAYS=7
CANVASGPT_MAX_FILE_BYTES=62914560
CANVASGPT_LOG_LEVEL
```

Do not commit `.env` files or API keys.

## 23. References

- OpenAI File Search guide: https://developers.openai.com/api/docs/guides/tools-file-search
- OpenAI Retrieval and vector stores guide: https://developers.openai.com/api/docs/guides/retrieval
