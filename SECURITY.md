# Security

This is an early-stage, unofficial frontend for DeepSeek Harness. Only the latest
release receives fixes; no security audit or production support guarantee is implied.

## Report a vulnerability

Please use GitHub's private vulnerability reporting:
https://github.com/ZhenyuePan/dsh-vscode-native/security/advisories/new

Do not post credentials, private code, launch tokens or exploitable vulnerability
details in public issues. Include the extension/DSH/VS Code versions and a minimal
reproduction using synthetic data. There is currently no guaranteed response SLA.

## Data and trust boundaries

- The extension launches `npx -y @deepseek-ai/dsh@latest web --no-open --port 0`.
  First launch may download and execute DSH from npm; later launches may update it.
- Selected code and explicit file attachments are sent to DSH with your prompt.
  DSH can send prompts and tool output to the model provider configured by the user.
- Agent tools may read or modify files and run commands. Use trusted workspaces
  and review DSH's own permissions; this UI is not an agent sandbox.
- Approval controls are not yet implemented in this sidebar. Handle approvals in
  a supported DSH client; do not use this preview for workflows requiring complete
  in-extension approval controls.
- The extension does not add its own analytics service. DSH and model providers
  have separate behavior and policies. Session storage is managed by DSH.
- Authentication cookies stay in the extension host, not the webview. Do not
  share unredacted runtime logs or expose DSH's local port to untrusted networks.
- Rendered Markdown disables raw HTML and external images. Treat model-provided
  links as untrusted and review destinations before opening them.
