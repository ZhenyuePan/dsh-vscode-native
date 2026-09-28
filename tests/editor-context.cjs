const assert = require('node:assert/strict');
const Module = require('node:module');
const events = {};
const listen = name => cb => { events[name] = cb; return {dispose(){}}; };
function document(name) {
 return {uri:{scheme:'file',fsPath:`/workspace/src/${name}`,toString(){return this.fsPath}},version:1,lineCount:30,languageId:'typescript',getText(range){return range ? 'const selected = 42;\n' : 'entire file';}};
}
const selection = {isEmpty:false,start:{line:9,character:0},end:{line:12,character:0}};
const editor = {document:document('auth.ts'),selections:[selection]};
const api = {
 window:{activeTextEditor:editor,visibleTextEditors:[editor],onDidChangeActiveTextEditor:listen('active'),onDidChangeTextEditorSelection:listen('selection'),showQuickPick:async()=>{api.window.activeTextEditor=undefined;events.active(undefined);return '当前文件';}},
 workspace:{asRelativePath:uri=>uri.fsPath.replace('/workspace/',''),onDidChangeTextDocument:listen('change'),onDidCloseTextDocument:listen('close')}
};
const original = Module._load;
Module._load = function(id,...args){return id==='vscode'?api:original.call(this,id,...args)};
const {EditorContext}=require('../out/editor-context');
async function main(){
 const ctx=new EditorContext(()=>{});
 assert.equal(ctx.items()[0].label,'auth.ts:10–12');
 assert(ctx.items()[0].text.includes('/workspace/src/auth.ts'));
 assert(ctx.items()[0].text.includes('行号：10–12'));
 assert(ctx.items()[0].text.includes('const selected = 42;'));
 api.window.activeTextEditor=undefined;events.active(undefined);
 assert.equal(ctx.items().length,1,'Webview focus must not clear selected code');
 await ctx.choose(); assert(ctx.items().some(i=>i.preview==='entire file'),'QuickPick focus must retain last editor');
 const auto=ctx.items().find(i=>i.automatic);ctx.remove(auto.id);
 assert(!ctx.items().some(i=>i.automatic));events.active(undefined);assert(!ctx.items().some(i=>i.automatic));
 editor.document.version++;events.change({document:editor.document});assert(ctx.items().some(i=>i.automatic));
 const frozen=ctx.items();ctx.clearSent(frozen);assert.equal(ctx.items().length,1,'manual refs clear after send, current selection remains');
 ctx.pinSelection();assert.equal(ctx.items().length,1);assert(!ctx.items()[0].automatic);
 ctx.clearSent(ctx.items());assert.equal(ctx.items().length,0);
 editor.selections=[{isEmpty:true,start:{line:1,character:0},end:{line:1,character:0}}];events.selection({textEditor:editor});assert.equal(ctx.items().length,0);
 ctx.dispose();console.log('Editor context: focus loss, precise file/line/code, picker, removal, changes and pinning passed');
}
main().catch(e=>{console.error(e);process.exitCode=1});
