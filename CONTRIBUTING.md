# Contributing

欢迎提交 Issue 和 Pull Request。本项目是社区维护的非官方 DeepSeek Harness 客户端。

## Development

使用 Node.js 24 LTS（开发和 CI），在你的 fork 中创建分支：

```bash
npm ci
npm run compile
npm test
npx playwright install chromium
npm run test:ui
npm run package:vsix
```

Linux 首次运行浏览器测试可能需要 `npx playwright install --with-deps chromium`。
UI 测试使用模拟消息，不调用模型；截图保存在 `artifacts/ui/`。
`node tests/runtime-ui.cjs` 是可选的真实 DSH 集成测试，需要你自己的模型配置，可能产生 API 费用，默认 CI 不运行。

## Pull requests

- 尽量聚焦单一问题，说明变更原因及测试方式。
- UI 变更附上窄侧栏（280–400px）、深色和浅色截图。
- 协议变更注明测试的 DSH 版本，考虑历史恢复和断线重连。
- 不提交密钥、Cookie、带 token 的启动 URL、用户对话或个人配置。
- 不添加未实际接通的功能按钮，不将模型输出当作可信 HTML 执行。
- 新增第三方依赖时保留其许可证和来源说明。

提交贡献即表示你同意按本项目 MIT 许可证提供这些贡献。

## Releases (maintainers)

1. 更新 `package.json` 和 lockfile 中的版本，补充 `CHANGELOG.md`。
2. 确认 main 的 CI 通过，提交并推送变更。
3. 创建与版本完全一致的标签，例如 `git tag v0.2.3`，再 `git push origin v0.2.3`。
4. Release 工作流独立执行测试和打包，成功后公开 GitHub Release、VSIX 和 SHA-256 校验文件。

普通提交不会更新已发布的安装包。标签必须指向 main 历史上的提交，禁止复用已发布的版本。
这条工作流不向 VS Code Marketplace 发布，也不需要个人 PAT 或模型密钥。
