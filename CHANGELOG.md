# Changelog

## 0.2.4

- Fixed missing `ask_user_question` choices by subscribing to DSH's `$events` stream.
- Added single/multiple choice and free-text answers, structured reply delivery and cancellation.
- Added session/generation validation, duplicate-submit protection and preserved form drafts during streaming.
- Added question-service tests, browser interaction tests and an optional real DSH round-trip test.

## 0.2.3

- First open-source release under MIT; added contribution and security guidance.
- Added CI and version-tag release automation with downloadable VSIX and SHA-256.
- Pinned packaging and browser-test tooling, added build-before-package step.
- Runtime behavior remains the same as 0.2.2. This is a preview, not a Marketplace release.

## 0.2.2

- Compact Cline-inspired layout, theme-aware tool cards and composer toolbar.
- Autosizing input, return-to-latest control, narrow-sidebar and theme tests.

## 0.2.1

- Markdown tables, lists, code blocks and code-copy actions.
- Automatic editor selection context with file/line chips and source-link navigation.

## 0.2.0

- DSH managed runtime, authenticated HTTP RPC and multiplexed WebSocket transport.
- Streaming chat, session history, model selection and basic tool/diff presentation.
