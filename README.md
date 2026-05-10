# Canvas AI Assistant

A starter Manifest V3 Chrome extension for extracting data from Canvas pages and sending it to a local FastAPI backend.

## Project Structure

```text
.
├── manifest.json
├── background.js
├── content/
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
7. Click Extract Page Data.
8. Start the backend, then click Send to Backend.

After changing extension code, reload the extension from `chrome://extensions`.

## Current Data Extraction

The content script extracts:

- Page URL and title
- Headings
- Links
- Visible text, capped at 10,000 characters
- Canvas-oriented links for assignments, files, and modules
- Due-date-like text from common date elements and due-date class names

Canvas page HTML varies by school and page type, so each Canvas-specific selector is best-effort and safely optional.
