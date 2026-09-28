# Third-party components and design references

## Cline — layout reference

The compact editor-themed layout, small-radius tool cards, rectangular composer,
and model/context toolbar placement are inspired by Cline's VS Code UI.
The DSH DOM, CSS and host integration are independently implemented; no Cline React
components, agent engine, logos or brand assets are bundled.

Reference inspected 2026-09-28:
- https://github.com/cline/cline/blob/main/apps/vscode/webview-ui/src/components/chat/ChatTextArea.tsx
- https://github.com/cline/cline/blob/main/apps/vscode/webview-ui/src/components/chat/ChatRow.tsx
- Cline license: Apache-2.0, https://github.com/cline/cline/blob/main/LICENSE

## Bundled dependencies

- markdown-it: MIT; license at `media/markdown-it.LICENSE`.
- ws: MIT; license at `node_modules/ws/LICENSE`.
