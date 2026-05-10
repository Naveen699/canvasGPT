# AGENTS.md


## Project Context

This is a chrome extension for Canvas LMS. The goal of the extension is to provide an AI assistant directly inside Canvas so students can ask questions about their courses, assignments, slides, files, grades, announcements, and other course material without manually downloading and uploading content.

The extension should behave like a lightweight AI side panel embedded into Canvas pages. It should extract useful course/page data from Canvas, send structured data to the backend when appropriate, and display helpful AI responses in the browser.

Agents working in this repository should prioritize:

- Clean, maintainable code
- Consistent file organization
- Safe handling of student/course data
- Clear separation between extension UI, Canvas data extraction, and backend communication
- Minimal disruption to the Canvas page
- User-friendly behavior for students


## Core Rules

### 1. Keep the extension modular

Do not put all logic into one large file.

Separate responsibilities into clear modules:

- UI rendering
- Canvas DOM extraction
- API/backend communication
- Authentication/session handling
- State management
- Utility functions
- Types/interfaces
- Prompt construction
- Error handling

Prefer small, focused files over large files.


### 2. Do not hardcode Canvas-specific selectors without fallbacks

Canvas pages may change across schools, courses, or page types.

When extracting data from the DOM:

- Use stable selectors when possible
- Add fallback selectors
- Check for missing elements safely
- Avoid assuming every Canvas page has the same structure
- Never let extraction failure break the extension UI



### 3. Use consistent naming 
