# Canvas AI Assistant

A starter Manifest V3 Chrome extension for gathering student-visible Canvas course materials with same-origin Canvas API requests from the user's active web session.

## Project Structure

```text
.
├── manifest.json
├── background.js
├── content/
│   ├── canvasApiClient.js
│   └── content.js
├── sidepanel/
│   ├── sidepanel.html
│   ├── sidepanel.css
│   └── sidepanel.js
├── icons/
│   └── icon.svg
└── backend/
    ├── main.py
    └── requirements.txt
```

## Run the Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The extension posts extracted page data to:

```text
http://localhost:8000/extract
```

You can check the backend with:

```text
http://localhost:8000/health
```

## Load the Extension

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click Load unpacked.
4. Select this repository folder.
5. Open a Canvas page on an `instructure.com` domain or `canvas.case.edu`.
6. Click the extension icon to open the side panel.
7. Click Load Visible Course Materials from a Canvas course page to gather materials the signed-in student can see.

After changing extension code, reload the extension from `chrome://extensions`.

## Current Canvas Data

The side panel can load:

- Module items for the current course
- Published pages, assignments, announcements, and discussion topics visible to the user
- Links rendered on the current Canvas page and links embedded in API-returned HTML bodies
- File metadata for files discovered through module items or visible links

## Page Data Extraction

The content script extracts:

- Page URL and title
- Headings
- Links
- Visible text, capped at 10,000 characters
- Canvas-oriented links for assignments, files, and modules
- Due-date-like text from common date elements and due-date class names

Canvas page HTML varies by school and page type, so each Canvas-specific selector is best-effort and safely optional.

## Current Canvas API Surface

The Canvas API client is intentionally limited to read-only course material discovery:

- Course metadata: `GET /api/v1/courses/:course_id`
- Modules: `GET /api/v1/courses/:course_id/modules`, `GET /api/v1/courses/:course_id/modules/:module_id/items`
- Pages: `GET /api/v1/courses/:course_id/pages`, `GET /api/v1/courses/:course_id/pages/:url_or_id`
- Assignments: `GET /api/v1/courses/:course_id/assignments`
- Announcements: `GET /api/v1/announcements?context_codes[]=course_:course_id`
- Discussions: `GET /api/v1/courses/:course_id/discussion_topics`
- Linked files: `GET /api/v1/files/:id`, discovered from module file items and visible/rendered links

These calls run from the Canvas content script with `credentials: "same-origin"`, so they use the session cookies for the user who is already logged into Canvas. No Canvas developer key or OAuth token is required for this MVP path.

Backend ingestion of file metadata/content is not implemented yet.
