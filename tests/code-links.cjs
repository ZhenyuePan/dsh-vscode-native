const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const root = path.resolve('/workspace');
let opened, external;
const editor = { revealRange(range) { this.range = range; } };
class Range { constructor(a,b,c,d) { this.start = {line:a,character:b}; this.end = {line:c,character:d}; } }
const api = {
 Uri: { file: fsPath => ({fsPath}), parse: value => value },
 workspace: {workspaceFolders:[{uri:{fsPath:root}}],openTextDocument:async uri => {opened=uri.fsPath;return {lineCount:30,lineAt:()=>({text:'const selected = 42;'})};}},
 window:{showTextDocument:async()=>editor},
 env:{openExternal:async uri=>{external=uri;}},
 Range,Selection:class{constructor(start,end){this.start=start;this.end=end;}},TextEditorRevealType:{InCenter:1}
};
const original=Module._load;
Module._load=function(id,...args){return id==='vscode'?api:original.call(this,id,...args);};
const {openCodeLink}=require('../out/code-links');
async function main(){
 await openCodeLink('src/auth.ts#L10-L12');
 assert.equal(opened,path.join(root,'src/auth.ts'));assert.equal(editor.range.start.line,9);assert.equal(editor.range.end.line,11);
 await openCodeLink(path.join(root,'src/auth.ts')+'#L104');assert.equal(editor.range.start.line,29);
 await openCodeLink('src/my%20file.ts:10:3');assert.equal(opened,path.join(root,'src/my file.ts'));assert.equal(editor.range.start.line,9);
 await assert.rejects(()=>openCodeLink('../outside.ts'));
 await assert.rejects(()=>openCodeLink('command:workbench.action.closeWindow'));
 await assert.rejects(()=>openCodeLink('javascript:alert(1)'));
 await assert.rejects(()=>openCodeLink('src/auth.ts#L0'));
 await openCodeLink('https://example.com/docs');assert.equal(external,'https://example.com/docs');
 console.log('Code links: workspace scope, exact lines, encoded paths, bounds and unsafe schemes passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
