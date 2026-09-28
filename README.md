# DeepSeek Harness Native for VS Code — 0.2.2

An MVP VS Code-native front end for `dsh web`. It launches a private local DSH runtime,
authenticates through its one-time URL, then uses the documented Remote HTTP and WebSocket
transport rather than embedding the DSH web page.

## Development

```bash
npm install
npm run compile
```

Install the VSIX in the Remote SSH window and reload VS Code. The extension starts `npx -y @deepseek-ai/dsh@latest web --no-open --port 0` on demand.

`npm run test:runtime` accepts `DSH_URL` (a token-bearing launch URL) and exercises list/create/prompt/cancel plus a `session/follow` mux subscription.

## 紧凑侧栏

- 顶部 `+` 新建会话；时钟搜索并切换历史会话；省略号查看运行日志。
- 底部 `@` 显式添加当前文件、当前选区或选择的文本文件；点击胶囊 `×` 移除。
- 编辑器选中的代码自动显示为文件名与行号胶囊，切换到聊天框不会丢失；点击胶囊查看原位置，`×` 可取消本次自动引用。右键“引用到 DeepSeek Harness”可固定引用。
- 回复支持 Markdown 表格、列表、引用和带复制按钮的代码块；工作区文件链接可跳转到对应行。发送后的代码引用可折叠查看。
- 点击模型名称读取 DSH 的模型目录并选择会话模型。
- Enter 发送，Shift+Enter 换行；生成过程中发送按钮变为停止。
- 思考及工具过程可展开；工具返回文件差异时提供变更卡片和 VS Code 差异视图。
- 发送失败保留草稿；重载后恢复当前会话。
- 0.2.2 按 Cline 的紧凑侧栏布局调整：小圆角输入框、独立模型工具栏、边框工具卡片，跟随 VS Code 主题。多行输入自动增高，上翻历史时可“回到最新”。设计参考及第三方说明见 `THIRD_PARTY_NOTICES.md`。

当前是第一版：历史读取 follow 的最近消息窗口，未提供向前分页；Agent 标签只表示当前工作方式；差异视图展示工具实际返回的变更片段；审批需在 DSH 客户端处理。只有显示为胶囊的选区及显式附件会随消息发送，不自动附加整个文件。

`node tests/runtime-ui.cjs` 启动真实 DSH、创建测试会话并请求一条简短回复（使用已配置的模型），验证流式消息和历史恢复。

`node tests/browser-ui.cjs` 使用 Playwright 检查前端交互并截图，需要可用的 Playwright/Chromium。可通过 `PLAYWRIGHT_MODULE` 指定模块路径、`PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定浏览器，`UI_OUTPUT_DIR` 指定截图目录。截图使用测试对话，不是实时会话。

`npx -y @vscode/vsce package -o dsh-vscode-native-0.2.2.vsix` 生成安装包，必须包含 `ws` 运行依赖和编译步骤复制的 Markdown 静态资源及许可证。

前端静态资源位于 `media/`；回复通过禁用原始 HTML 的 markdown-it 渲染，不执行模型输出的 HTML，不加载外部图片。文件链接由扩展端校验；认证凭据不传入 Webview。
