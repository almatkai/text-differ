// Production executable through JSONL pipes; closed source VM, owned fixture files only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import ts from '../.qa/v1/node_modules/typescript/lib/typescript.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const qa=path.join(root,'.qa');
const fixtures=path.join(qa,'fixtures');fs.mkdirSync(fixtures,{recursive:true});
const source=fs.readFileSync(path.join(root,'tests/fixtures/open-with-text-differ.tsx'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function oracle(selected,contents,{readError=false,windows=false}={}) {
  const reads=[],changes=[],sourceWrites=[]; let state=[],index=0,effects=[];
  const context=vm.createContext({}, {codeGeneration:{strings:false,wasm:false}});
  const jsx=(type,props)=>({type,props});
  const deny=(name)=>new Proxy({}, {get(){throw new Error(`Denied ${name}`)}});
  const react={useState(initial){const i=index++;if(state[i]===undefined)state[i]=initial;return[state[i],v=>{state[i]=v}]},useEffect(callback){if(!effects.length)effects.push(callback)}};
  const modules={};
  const load=(name)=>{
    if(modules[name])return modules[name];
    const exports={};modules[name]=exports;
    const src=fs.readFileSync(path.join(root,'tests/fixtures/jsdiff-8.0.4',name),'utf8');
    const require=(p)=>{const n=path.posix.normalize(path.posix.join(path.posix.dirname(name),p));if(!['diff/base.js','util/params.js'].includes(n))throw new Error(`Denied import ${p}`);return load(n)};
    vm.compileFunction(src,['exports','require'],{parsingContext:context})(exports,require);return exports;
  };
  const api={Action:{CopyToClipboard:'CopyToClipboard'},ActionPanel:'ActionPanel',Detail:'Detail',getSelectedFinderItems:async()=>selected.map(p=>({path:p}))};
  const mocks={'@raycast/api':api,'react':react,'react/jsx-runtime':{jsx,jsxs:jsx},'node:fs':{promises:{readFile:async(p,encoding)=>{assert.equal(encoding,'utf8');assert(selected.includes(p));reads.push(p);if(readError)throw new Error('synthetic read error');assert(contents.has(p));return contents.get(p).toString('utf8')}}},'node:path':{__esModule:true,default:{basename:p=>(windows?path.win32:path.posix).basename(p)}},'diff':{diffLines:(a,b)=>{const v=load('diff/line.js').diffLines(a,b);changes.push(v);return v}}};
  Object.assign(context,{process:deny('process'),fetch:()=>{throw new Error('Denied network')},setTimeout:()=>{throw new Error('Denied timer')},console:deny('console')});
  const exports={};vm.compileFunction(compiled,['exports','require'],{parsingContext:context})(exports,p=>{if(!(p in mocks))throw new Error(`Denied import ${p}`);return mocks[p]});
  exports.default();effects[0]();
  return (async()=>{
    for(let i=0;i<20;i++)await Promise.resolve();
    index=0;const tree=exports.default();
    const copyAction=tree.props.actions?.props.children;
    if(copyAction){
      const copySource=fs.readFileSync(path.join(root,'tests/fixtures/worker-copy.js'),'utf8');
      const register=vm.compileFunction(copySource+'\nreturn registerAction;',['import_node_crypto2','copyClipboardContent','pasteClipboardContent','shell'],{parsingContext:context})({createHash},async text=>sourceWrites.push(text),()=>{throw new Error('Denied paste')},deny('shell'));
      const session={currentActions:[],actionHandlers:new Map(),effects:[],effectMode:'synthetic-no-os'};
      register('Action.CopyToClipboard',copyAction.props,session);
      await session.actionHandlers.values().next().value();
      assert.equal(sourceWrites.length,1);
    }
    return JSON.parse(JSON.stringify({markdown:state[0],copy:sourceWrites[0]??null,reads,changes:changes[0]??[]}));
  })();
}
class Host {
  constructor(executable,profile='one') {
    this.pending=new Map();this.seq=0;this.requests=[];this.selected=[];this.ack={ok:true};this.reverse=null;this.events=[];
    const home=path.join(qa,'home'),tmp=path.join(qa,'tmp'),data=path.join(qa,'profiles',profile);
    fs.mkdirSync(data,{recursive:true});
    this.child=spawn(executable,[],{cwd:root,env:{...process.env,HOME:home,TMPDIR:tmp},stdio:['pipe','pipe','pipe']});
    this.stderr='';this.child.stderr.on('data',b=>this.stderr+=b);
    this.exit=new Promise(resolve=>this.child.on('exit',(code,signal)=>{for(const {resolve:r} of this.pending.values())r({error:{code:'exit',message:this.stderr}});resolve({code,signal})}));
    this.hello=new Promise(resolve=>this.resolveHello=resolve);
    createInterface({input:this.child.stdout}).on('line',line=>{
      const f=JSON.parse(line);
      if(f.type==='hello'){this.resolveHello(f);return}
      if(f.type==='response'){const pending=this.pending.get(f.id);this.pending.delete(f.id);pending?.resolve(f);return}
      if(f.type==='request'){
        this.requests.push(f);
        if(this.reverse){this.reverse(f);return}
        assert(['host.selection.read','host.clipboard.write'].includes(f.method),`Unexpected method ${f.method}`);
        if(f.method==='host.selection.read'){assert.deepEqual(f.params,{kind:'files'});this.reply(f,this.selected)}
        else {assert.deepEqual(Object.keys(f.params),['text']);this.reply(f,this.ack)}
      }else this.events.push(f);
    });
    this.ready=(async()=>{assert.equal((await this.hello).id,'com.tezbar.native.text-differ');return this.call('initialize',{protocol:1,extensionId:'com.tezbar.native.text-differ',platform:'macos',packageDir:root,dataDir:data,tempDir:tmp,grantedCapabilities:['selection.read','clipboard.write']})})();
  }
  send(f){this.child.stdin.write(JSON.stringify(f)+'\n')}
  reply(f,result,error){this.send(error?{type:'response',id:f.id,error}:{type:'response',id:f.id,result})}
  begin(method,params){const id=`h:${randomUUID()}`;let resolve;const promise=new Promise(r=>resolve=r);this.pending.set(id,{resolve});this.send({type:'request',id,method,params});return{id,promise}}
  async call(method,params){return (await this.begin(method,params).promise)}
  async open(id){return this.call('session.open',{sessionId:id,commandName:'open-with-text-differ',preferences:{},argumentValues:{}})}
  async action(id,actionId){return this.call('session.call',{sessionId:id,operation:'extension:invoke-action',payload:{actionId}})}
  async refresh(id){return this.call('session.call',{sessionId:id,operation:'extension:refresh-session',payload:{}})}
  async dispose(id){return this.call('session.dispose',{sessionId:id})}
  async close(){this.child.stdin.end();assert.deepEqual(await this.exit,{code:0,signal:null});assert.equal(this.stderr,'')}
}
const body=v=>v.result.root.props.markdown;
const action=v=>v.result.actions[0]?.id;
const unescape=s=>s.slice(s.indexOf('<pre>')+5).replace(/<\/pre>$/,'').replace(/&#13;/g,'\r').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&amp;/g,'&').replace(/\\([\\r])/g,(_,c)=>c==='r'?'\r':'\\');
const executable=process.argv[2]??path.join(root,'target/debug/text-differ');
const host=new Host(executable);await host.ready;
const sourceReadFailure=await oracle(['/synthetic/left','/synthetic/right'],new Map(),{readError:true});assert(sourceReadFailure.markdown.includes('synthetic read error'));assert.equal(sourceReadFailure.copy,null);
const left=path.join(fixtures,'left ``` <img src=x> [x](file:) &.txt'),right=path.join(fixtures,'right 😺.txt');
const pair=[left,right];host.selected=pair;
const cases=[['',''],['a','a'],['','a\nb\n'],['a\nb\n',''],['a\nb\n','c\nd\n'],['a\r\nb\r\n','a\nb\n'],['a\r','a\n'],['a\n','a'],['a\n\n','a\n'],['\ufeffa\n','a\n'],['😺\n👨‍👩‍👧\n','😺\n😃\n'],['[x](https://bad)\n<img src=x>\n```\n','<script>bad</script>\n~~~\n'],['x'.repeat(60000),'y'.repeat(60000)]];
const words=['','a\n','b\n','a\nb\n','b\na\n','a\na\n','\n','\r\n','z'];
for(const a of words)for(const b of words)cases.push([a,b]);
const ties=[''];for(let length=1;length<=4;length++)for(let bits=0;bits<(1<<length);bits++)ties.push(Array.from({length},(_,i)=>((bits>>i)&1)?'b\n':'a\n').join(''));
for(const a of ties)for(const b of ties)cases.push([a,b]);
let seed=17;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed};
for(let i=0;i<300;i++){const make=()=>Array.from({length:rand()%14},()=>['a\n','b\n','c\r\n','\n','x'][rand()%5]).join('');cases.push([make(),make()])}
for(const bytes of [[0xff],[0xe2,0x82],[0xed,0xa0,0x80],[0xf0,0x90,0x80],[0xc0,0xaf],[0xe2,0x28,0xa1]])cases.push([Buffer.from(bytes),Buffer.from('�')]);
let oracleComparisons=0;const samples=[];
for(const [a,b]of cases){
  const contents=new Map([[left,Buffer.from(a)],[right,Buffer.from(b)]]);
  for(const [p,b]of contents)fs.writeFileSync(p,b);
  const sourceResult=await oracle(pair,contents);
  const id=`oracle-${oracleComparisons++}`;const native=await host.open(id);assert(!native.error,JSON.stringify(native));
  const raw=unescape(body(native));const expectedTitle=`${path.basename(left)} ↔ ${path.basename(right)}`;
  assert.equal(raw,`${expectedTitle}\n\n${sourceResult.copy??''}`,JSON.stringify({a,b,sourceResult,native}));
  assert.equal(!!action(native),!!sourceResult.copy);
  if(String(a).includes('<script>')||String(b).includes('<script>'))fs.writeFileSync(path.join(qa,'render-fixture.json'),JSON.stringify({root:native.result.root,text:raw}));
  assert.deepEqual(sourceResult.reads,pair);
  if(oracleComparisons<13)samples.push({input:[Buffer.from(a).toString('base64'),Buffer.from(b).toString('base64')],source:sourceResult,native:native.result});
  if(action(native)){
    const copy=await host.action(id,action(native));assert.equal(copy.result.message,'Copied to clipboard');
    assert.deepEqual(host.requests.at(-1).params,{text:sourceResult.copy});
    assert((await host.action(id,action(native))).error,'Consumed ID must stay stale');
  }
  await host.dispose(id);
}
// Source order and count/read failure behavior, including no copy on both-empty.
for(const count of [0,1,3,128]){host.selected=Array(count).fill(left);const src=await oracle(host.selected,new Map());const n=await host.open(`count-${count}`);assert(src.markdown.includes('Select exactly two files'));assert(body(n).includes('Select exactly two files'));await host.dispose(`count-${count}`)}
fs.writeFileSync(left,'before\n');fs.writeFileSync(right,'after\n');host.selected=pair;
let n=await host.open('snapshot');const original=action(n);fs.writeFileSync(left,'mutated\n');
for(const ack of [null,true,false,{},[],{ok:false},{ok:true,error:'contradiction'},{ok:true,extra:1},{ok:true,message:null}]){
  host.ack=ack;const count=host.requests.length;const result=await host.action('snapshot',action(n));assert.match(result.result.message,/uncertain/);assert.match(result.result.message,/could not|failed|failure|error/i);assert.equal(host.requests.length,count+1);assert.deepEqual(host.requests.at(-1).params,{text:'-before\n+after\n'});n=result;
}
host.reverse=f=>host.reply(f,undefined,{code:'synthetic',message:'clipboard unavailable'});n=await host.action('snapshot',action(n));assert.match(n.result.message,/uncertain/);host.reverse=null;
host.ack={ok:true,message:'done'};n=await host.action('snapshot',action(n));assert.equal(n.result.message,'Copied to clipboard');assert((await host.action('snapshot',original)).error);
const unchangedRequests=host.requests.length;const stableView=body(n);const fresh=await host.refresh('snapshot');assert.equal(body(fresh),stableView);assert.equal(host.requests.length,unchangedRequests);
const previous=action(n);await host.dispose('snapshot');host.selected=[right,left];n=await host.open('snapshot2');assert((await host.action('snapshot2',previous)).error);await host.dispose('snapshot2');
// Same path is source-faithful: context-only diff, not a fabricated error.
host.selected=[left,left];n=await host.open('same');assert(unescape(body(n)).endsWith(' mutated\n'));await host.dispose('same');
// Read failure -> manual retry retains pair identity, ignores a new host selection.
const missing=path.join(fixtures,'missing.txt');host.selected=[missing,right];fs.rmSync(missing,{force:true});n=await host.open('retry');assert(body(n).includes('First selected file'));host.selected=[];fs.writeFileSync(missing,'recovered\n');n=await host.action('retry',action(n));assert(body(n).includes('recovered'));await host.dispose('retry');
// Non-file, binary and limits are explicit errors, never truncated successes.
for(const [name,bytes,expected]of [['control',Buffer.from([0]),'Binary/control'],['oversize',Buffer.alloc(262145,97),'256 KiB'],['lines',Buffer.from('x\n'.repeat(20001)),'Line limit']]){
 fs.writeFileSync(missing,bytes);host.selected=[missing,right];n=await host.open(name);assert(body(n).includes(expected));assert(n.result.actions[0].title.includes('Retry'));await host.dispose(name);
}
host.selected=[fixtures,right];n=await host.open('directory');assert(body(n).includes('not a regular file'));await host.dispose('directory');
fs.writeFileSync(missing,'a\n'.repeat(4000));fs.writeFileSync(right,'b\n'.repeat(4000));host.selected=[missing,right];n=await host.open('work');assert(body(n).includes('work limit'));await host.dispose('work');
fs.writeFileSync(missing,'a'.repeat(200000));fs.writeFileSync(right,'b'.repeat(200000));host.selected=[missing,right];n=await host.open('combined');assert(body(n).includes('Byte limit'));await host.dispose('combined');
// A selected symlink to a regular fixture is supported; no directory walk.
const link=path.join(fixtures,'link.txt');fs.rmSync(link,{force:true});fs.symlinkSync(left,link);host.selected=[link,left];n=await host.open('symlink');assert(action(n));await host.dispose('symlink');
// Malformed selection producers, transport errors, and inaccessible owned fixtures.
for(const selection of [null,true,{},[1],['relative.txt'],['/x\0y']]){host.selected=selection;n=await host.open('selection-shape');assert(body(n).includes('Cannot read validated'));await host.dispose('selection-shape')}
fs.chmodSync(left,0o000);host.selected=pair;n=await host.open('unreadable');assert(body(n).includes('Cannot open selected file'));fs.chmodSync(left,0o600);await host.dispose('unreadable');
host.reverse=f=>host.reply(f,undefined,{code:'synthetic',message:'unselected path secret must not be displayed'});n=await host.open('selection-error');assert(!body(n).includes('secret'));host.reverse=null;await host.dispose('selection-error');
// Saturation/disposal uses actual SDK limits, then recovers without a restart.
host.selected=[];for(let i=0;i<128;i++)assert((await host.open(`capacity-${i}`)).result);
assert((await host.open('capacity-overflow')).error);for(let i=0;i<128;i++)await host.dispose(`capacity-${i}`);
// Cancellation and 140 canceled opens exceed SDK capacity without leaking slots.
for(let i=0;i<140;i++){
 let reverse;const gate=new Promise(r=>reverse=r);host.reverse=f=>reverse(f);
 const pending=host.begin('session.open',{sessionId:`cancel-${i}`,commandName:'open-with-text-differ'});const req=await gate;
 host.send({type:'cancel',requestId:pending.id,reason:'QA'});assert((await pending.promise).error);
 host.reply(req,pair);host.reverse=null;
}
host.selected=pair;n=await host.open('after-cancels');assert(n.result);await host.dispose('after-cancels');
// A canceled ordinary retry cannot commit a newly selected pair or Copy action.
host.selected=[];let ordinary=await host.open('cancel-read');let selectedGate;const selectedWait=new Promise(r=>selectedGate=r);host.reverse=f=>selectedGate(f);
const reading=host.begin('session.call',{sessionId:'cancel-read',operation:'extension:invoke-action',payload:{actionId:action(ordinary)}});const selectionRequest=await selectedWait;
host.send({type:'cancel',requestId:reading.id,reason:'QA'});assert((await reading.promise).error);host.reply(selectionRequest,pair);host.reverse=null;
ordinary=await host.refresh('cancel-read');assert.equal(ordinary.result.actions[0].title,'Retry Comparison');assert(body(ordinary).includes('interrupted'));host.selected=pair;ordinary=await host.action('cancel-read',action(ordinary));assert.equal(ordinary.result.actions[0].title,'Copy Diff');await host.dispose('cancel-read');
// Cancel pending clipboard; late ACK cannot complete/replay it. Retry exact snapshot.
fs.writeFileSync(left,'A');fs.writeFileSync(right,'B');host.selected=pair;n=await host.open('cancel-copy');
let reverse;let gate=new Promise(r=>reverse=r);host.reverse=f=>reverse(f);
let pending=host.begin('session.call',{sessionId:'cancel-copy',operation:'extension:invoke-action',payload:{actionId:action(n)}});let req=await gate;
host.send({type:'cancel',requestId:pending.id,reason:'QA'});assert((await pending.promise).error);host.reply(req,{ok:true});host.reverse=null;
assert((await host.action('cancel-copy',action(n))).error);n=await host.refresh('cancel-copy');assert.match(n.result.message,/uncertain/);assert.equal(n.result.actions[0].title,'Retry Copy Diff');n=await host.action('cancel-copy',action(n));assert.deepEqual(host.requests.at(-1).params,{text:'-A+B'});await host.dispose('cancel-copy');
// Search is inert and latest-search cancellation does not change the snapshot.
host.selected=pair;n=await host.open('search');const copyId=action(n);
await Promise.all(['A','B','A'].map(searchText=>host.call('session.call',{sessionId:'search',operation:'extension:search-text-changed',payload:{searchText}})));
assert.equal(action(await host.refresh('search')),copyId);await host.dispose('search');
// Disposal while copying cancels the operation; late ACK cannot revive its session.
let disposed=await host.open('dispose-copy');let received;const disposalGate=new Promise(r=>received=r);host.reverse=f=>received(f);
const copying=host.begin('session.call',{sessionId:'dispose-copy',operation:'extension:invoke-action',payload:{actionId:action(disposed)}});const clipboard=await disposalGate;
assert((await host.dispose('dispose-copy')).result);assert((await copying.promise).error);host.reply(clipboard,{ok:true});host.reverse=null;assert((await host.refresh('dispose-copy')).error);
// EOF with an active open/reverse request must exit promptly, no detached work.
let wait;gate=new Promise(r=>wait=r);host.reverse=f=>wait(f);pending=host.begin('session.open',{sessionId:'eof',commandName:'open-with-text-differ'});await gate;await host.close();
const other=new Host(executable,'two');await other.ready;other.selected=[];n=await other.open('other');assert(body(n).includes('Select exactly'));await other.dispose('other');await other.close();
for(const profile of ['one','two'])assert.deepEqual(fs.readdirSync(path.join(qa,'profiles',profile)),[],'No domain files, journals, or profile secrets');
fs.writeFileSync(path.join(qa,'oracle-actual-samples.json'),JSON.stringify(samples,null,2)+'\n');
console.log(JSON.stringify({oracleComparisons,productionPipes:true,canceledOpens:140,copyAckNegatives:9,readRecovery:true,profileIsolation:true,executable},null,2));
