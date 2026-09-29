const assert=require('node:assert/strict');
const {DshProcessManager}=require('../out/dsh/process');
const {DshRpcClient}=require('../out/dsh/rpc');
const {DshRemoteMux}=require('../out/dsh/mux');
const {DshQuestions}=require('../out/dsh/questions');
const {Transcript}=require('../media/transcript');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const runtime=new DshProcessManager();let mux,questions,unfollow,rpc,sessionId;const errors=[];
 const wait=async(predicate)=>{const start=Date.now();while(!predicate()){if(errors.length)throw errors[0];if(Date.now()-start>90000)throw Error('Timed out');await delay(100);}};
 try{
  const endpoint=await runtime.start();rpc=new DshRpcClient(endpoint);mux=new DshRemoteMux(endpoint);
  questions=new DshQuestions(rpc,mux,()=>{},e=>errors.push(e));await questions.start();console.log('Real $events handshake: OK');
  sessionId=(await rpc.create(require('node:path').resolve(__dirname,'..'))).sessionId;questions.track(sessionId);
  const store=new Transcript();unfollow=await mux.follow(sessionId,f=>store.apply(f),e=>errors.push(e));
  await rpc.prompt(sessionId,'Integration test: call ask_user_question now with one question id "color", question "Choose a test color", options labels "Blue" and "Green", single select. Do not read or change files. Wait for the actual tool answer. After receiving it, reply with exactly QUESTION_OK followed by the selected label. Do not ask this as plain text.');
  await wait(()=>questions.items(sessionId).length>0);
  const request=questions.items(sessionId)[0];assert.equal(request.questions.length,1);assert(request.questions[0].options.some(o=>o.label==='Blue'));
  console.log('Real ask_user_question options received: OK');
  await questions.answer(sessionId,request.eventId,[{id:request.questions[0].id,selected:['Blue']}]);
  await wait(()=>!store.running&&store.rows().some(r=>r.role==='assistant'&&r.text.includes('QUESTION_OK')));
  assert(store.rows().some(r=>r.role==='assistant'&&r.text.includes('Blue')));console.log('Real answer round-trip and agent continuation: OK');
 }finally{if(sessionId)await rpc.cancel(sessionId).catch(()=>{});unfollow?.();questions?.dispose();mux?.close();runtime.stop();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
