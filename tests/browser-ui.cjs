const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { Transcript } = require('../media/transcript');
const base = path.join(__dirname, '../media');
const fixture = {type:'snapshot',hasMore:false,records:[
 {type:'event',event:{seq:1,type:'user/message',data:{content:[{type:'text',text:'帮我检查登录状态同步，并修复重复请求。'}]}}},
 {type:'event',event:{seq:2,type:'assistant/message',data:{message:{content:[{type:'reasoning',text:'先检查会话状态，再确认请求是否复用了同一个 Promise。'}]}}}},
 {type:'event',event:{seq:3,type:'tool/call',data:{callId:'read',name:'读取',arguments:'{"file_path":"src/auth.ts"}'}}},
 {type:'event',event:{seq:4,type:'tool/result',data:{message:{toolCallId:'read',content:[{type:'text',text:'文件已读取，共 38 行。'}]}}}},
 {type:'event',event:{seq:5,type:'tool/call',data:{callId:'edit',name:'编辑',arguments:'{"file_path":"src/auth.ts"}'}}},
 {type:'event',event:{seq:6,type:'tool/result',data:{message:{toolCallId:'edit',content:[{type:'text',text:'已更新状态同步。'}]},meta:{diffs:[{path:'auth.ts',oldText:'return api.login(credentials);',newText:'loginPromise ??= api.login(credentials);\nreturn loginPromise;'}]}}}},
 {type:'event',event:{seq:7,type:'assistant/message',data:{message:{content:[{type:'text',text:'已修复重复请求，并统一了登录状态。\n\n类型检查通过，**3 项测试通过**。'}]}}}},
 {type:'event',event:{seq:8,type:'turn/end',data:{}}}
]};
async function main() {
 const browser = await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined});
 const page = await browser.newPage({viewport:{width:400,height:840},deviceScaleFactor:2});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<html><head><meta charset="UTF-8"></head><body><div id="app"></div></body></html>');
 await page.evaluate(()=>{ window.sent=[]; window.acquireVsCodeApi=()=>({getState:()=>({}),setState:()=>{},postMessage:m=>window.sent.push(m)}); });
 await page.addStyleTag({content:fs.readFileSync(path.join(base,'sidebar.css'),'utf8')});
 await page.addScriptTag({content:fs.readFileSync(path.join(base,'markdown-it.min.js'),'utf8')});
 await page.addScriptTag({content:fs.readFileSync(path.join(base,'transcript.js'),'utf8')});
 await page.addScriptTag({content:fs.readFileSync(path.join(base,'sidebar.js'),'utf8')});
 const dispatch = m=>page.evaluate(m=>window.dispatchEvent(new MessageEvent('message',{data:m})),m);
 await dispatch({type:'status',status:'ready',label:'workspace'});
 await page.getByLabel('消息',{exact:true}).fill('test'); await page.getByLabel('消息',{exact:true}).press('Enter');
 assert((await page.evaluate(()=>window.sent)).some(m=>m.type==='send'&&m.text==='test'));
 await dispatch({type:'error',message:'test error'}); assert.equal(await page.locator('textarea').inputValue(),'test');
 await dispatch({type:'session',id:'preview'});
 await dispatch({type:'accepted',title:'修复登录状态同步'});
 await dispatch({type:'frame',value:fixture});
 await dispatch({type:'attachments',items:[{id:'file',label:'auth.ts'},{id:'selection',label:'选区 · 12 行'}]});
 await page.waitForTimeout(200);
 const outputs = path.resolve(process.env.UI_OUTPUT_DIR || path.join(__dirname,'../artifacts/ui')); fs.mkdirSync(outputs,{recursive:true});
 await page.screenshot({path:path.join(outputs,'dsh-sidebar-400.png')});
 await page.setViewportSize({width:320,height:800}); await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert(await page.locator('.composer').isVisible());
 await page.screenshot({path:path.join(outputs,'dsh-sidebar-320.png')});
 await page.getByText('查看差异 ↗').click(); assert((await page.evaluate(()=>window.sent)).some(m=>m.type==='diff'&&m.id==='6:0'));
 await page.getByRole('button',{name:'新建会话',exact:true}).click(); assert((await page.evaluate(()=>window.sent)).some(m=>m.type==='new'));
 await page.getByRole('button',{name:'历史会话',exact:true}).click(); assert((await page.evaluate(()=>window.sent)).some(m=>m.type==='history'));
 await dispatch({type:'frame',value:{type:'event',event:{seq:9,type:'assistant/message',data:{message:{content:[{type:'text',text:'<img src=x onerror="window.hacked=1">'}]}}}}});
 await page.waitForTimeout(100); assert.equal(await page.locator('.transcript img').count(),0); assert.equal(await page.evaluate(()=>window.hacked),undefined);
 assert.deepEqual(errors,[]); console.log('Browser UI: send, error draft recovery, history/new/diff actions, 320px overflow, HTML injection checks passed');
 await dispatch({type:'session',id:'markdown-test'});
 const markdownText = '## 选区已收到\n\n你选择了 [auth.ts:10–12](/workspace/src/auth.ts#L10-L12)。\n\n| 场景 | 结果 |\n| --- | --- |\n| 切到聊天框 | 保留选区 |\n| 代码引用 | 点击跳到对应行 |\n\n- **文件**：`src/auth.ts`\n- **行号**：10–12\n\n> 只会附带你看到的代码引用。\n\n```typescript\nconst selected = 42;\n```\n\n[unsafe](javascript:alert(1))';
 await dispatch({type:'frame',value:{type:'snapshot',records:[{type:'event',event:{seq:1,type:'assistant/message',data:{message:{content:[{type:'text',text:markdownText}]}}}}]}});
 await dispatch({type:'attachments',items:[{id:'auto',label:'auth.ts:10–12',automatic:true,detail:'src/auth.ts，行号 10–12',preview:'const selected = 42;'}]});
 await page.waitForTimeout(100);
 assert.equal(await page.locator('.content table').count(),1);assert.equal(await page.locator('.content li').count(),2);
 assert.equal(await page.locator('.content blockquote').count(),1);assert.equal(await page.locator('.code-header').count(),1);
 assert.equal(await page.locator('a[href^="javascript:"]').count(),0);
 await page.getByRole('link',{name:'auth.ts:10–12'}).click();assert((await page.evaluate(()=>window.sent)).some(m=>m.type==='openLink'&&m.target==='/workspace/src/auth.ts#L10-L12'));
 await page.getByRole('button',{name:'复制',exact:true}).click();assert((await page.evaluate(()=>window.sent)).some(m=>m.type==='copy'&&m.text.includes('const selected = 42;')));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:path.join(outputs,'dsh-markdown-selection-320.png')});
 await page.setViewportSize({width:400,height:840});await page.screenshot({path:path.join(outputs,'dsh-markdown-selection-400.png')});
 console.log('Markdown: table/list/heading/blockquote/code copy + clickable source reference + safe links + live selection chip passed');
 // Layout, themes, resizing and stream navigation regression checks.
 await dispatch({type:'session',id:'layout'});
 await dispatch({type:'accepted',title:'修复登录状态同步'});
 await dispatch({type:'frame',value:fixture});
 await dispatch({type:'attachments',items:[{id:'auto',label:'auth.ts:10–12',automatic:true,detail:'src/auth.ts，行号 10–12',preview:'const selected = 42;'}]});
 await page.locator('textarea').fill('请检查选中的代码');
 await page.locator('textarea').blur();
 await page.setViewportSize({width:320,height:800});await page.waitForTimeout(100);
 await page.screenshot({path:path.join(outputs,'dsh-cline-style-dark.png')});
 await page.locator('textarea').fill(Array(20).fill('这是一段多行输入').join('\n'));
 assert.equal(Math.round((await page.locator('textarea').boundingBox()).height),180);
 await page.locator('textarea').fill('');assert.equal(Math.round((await page.locator('textarea').boundingBox()).height),84);
 await page.evaluate(()=>{document.documentElement.style.cssText='color-scheme:light;--vscode-sideBar-background:#f8f8f8;--vscode-foreground:#333;--vscode-descriptionForeground:#616161;--vscode-editorGroup-border:#ddd;--vscode-textCodeBlock-background:#f0f0f0;--vscode-input-background:#fff;--vscode-input-border:#cecece;--vscode-input-placeholderForeground:#767676;--vscode-textLink-foreground:#005fb8;--vscode-textBlockQuote-background:#f3f3f3;--vscode-toolbar-hoverBackground:#e8e8e8;';});
 await page.screenshot({path:path.join(outputs,'dsh-cline-style-light.png')});
 for(const width of [280,320,400]){
  await page.setViewportSize({width,height:600});await page.waitForTimeout(60);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const box=await page.locator('.composer-wrap').boundingBox();assert(box.y+box.height<=601);assert(box.y>=0);
 }
 await page.evaluate(()=>{document.documentElement.style.cssText='--vscode-contrastBorder:#fff';document.body.className='vscode-high-contrast';});
 assert.equal(await page.locator('.composer').evaluate(e=>getComputedStyle(e).borderTopColor),'rgb(255, 255, 255)');
 await page.evaluate(()=>{document.body.className='';document.documentElement.style.cssText='';});
 await dispatch({type:'frame',value:{type:'event',event:{seq:10,type:'assistant/message',data:{message:{content:[{type:'text',text:Array(60).fill('用于验证长消息滚动。').join('\n\n')}]}}}}});
 await page.waitForTimeout(100);
 await page.locator('.transcript').evaluate(e=>{e.scrollTop=0;e.dispatchEvent(new Event('scroll'));});
 assert(await page.getByRole('button',{name:'↓ 回到最新'}).isVisible());
 await page.getByRole('button',{name:'↓ 回到最新'}).click();
 assert(await page.locator('.transcript').evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight<2));
 await dispatch({type:'frame',value:{type:'event',event:{seq:11,type:'turn/start',data:{}}}});
 await page.getByRole('button',{name:'停止生成',exact:true}).click();assert((await page.evaluate(()=>window.sent)).some(m=>m.type==='stop'));
 await page.getByRole('button',{name:'auth.ts:10–12',exact:true}).click();assert((await page.evaluate(()=>window.sent)).some(m=>m.type==='revealContext'&&m.id==='auto'));
 await page.getByRole('button',{name:'移除 auth.ts:10–12',exact:true}).click();assert((await page.evaluate(()=>window.sent)).some(m=>m.type==='removeAttachment'&&m.id==='auto'));
 assert.deepEqual(errors,[]);
 console.log('Cline layout: dark/light/high-contrast, 280/320/400px, textarea autosize, scroll-to-latest, stop and context chip actions passed');
 const store=new Transcript(); store.apply(fixture); const count=store.rows().length; store.apply(fixture); assert.equal(store.rows().length,count);
 store.apply({type:'assistant-stream',frame:{type:'start',attemptId:'a'}});
 store.apply({type:'assistant-stream',frame:{type:'chunk',attemptId:'a',index:0,chunk:{type:'text-delta',index:0,text:'hello'}}});
 store.apply({type:'assistant-stream',frame:{type:'chunk',attemptId:'a',index:1,chunk:{type:'block-end',index:0,block:{type:'text',text:'hello'}}}});
 assert.equal(store.rows().at(-1).text,'hello'); console.log('Projection: snapshot dedup + block-end/delta reconciliation passed');
 await browser.close();
}
main().catch(e=>{console.error(e);process.exit(1)});
