# Docs Workspace

A Google Docs-inspired document editor built with plain HTML, CSS, and JavaScript. No dependencies or build step are required.

## Run

```sh
cd docs-clone
npm run dev
```

Open http://127.0.0.1:5190.

## Included

- Editable documents with bold, italic, underline, colors, font sizes, headings, alignment, lists, and line spacing
- Blank starting documents, a Save file dialog for HTML or plain text, and hover navigation between open menus
- Automatic local saving, a document library, starred documents, and copies
- Dynamic document outline and word count
- Comments with quoted text, replies, and resolution
- Tables, links, local image insertion, and safe text/HTML import
- HTML and plain text downloads; PDF through the browser print dialog
- Viewing mode, zoom, keyboard shortcuts, notes, and a document checklist
- Responsive layout and print styles
- Progressive WebMCP support for reading and creating documents

Documents live in this browser’s localStorage, not a server or Google Drive. There is no authentication or live multi-user collaboration. Share downloads a copy rather than generating a collaborative link. Images are limited to 2 MB to fit browser storage, which can fill up; download backups of important work.

The editor uses the browser’s native contenteditable and formatting commands. This keeps the app dependency-free; complex editing and undo behavior can vary between browsers. It is not a full pagination or real-time collaboration engine.
