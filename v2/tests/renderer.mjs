// Execute the pinned renderer in jsdom. No browser, clipboard, selection or GUI.
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import ts from '../.qa/v1/node_modules/typescript/lib/typescript.js';
import React from '../.qa/tools/node_modules/react/index.js';
import jsx from '../.qa/tools/node_modules/react/jsx-runtime.js';
import ReactDOM from '../.qa/tools/node_modules/react-dom/client.js';
import {flushSync} from '../.qa/tools/node_modules/react-dom/index.js';
import {JSDOM} from '../.qa/tools/node_modules/jsdom/lib/api.js';
import {Marked} from '../.qa/tools/node_modules/marked/lib/marked.esm.js';
import {markedHighlight} from '../.qa/tools/node_modules/marked-highlight/src/index.js';
import hljs from '../.qa/tools/node_modules/highlight.js/lib/common.js';
import createDOMPurify from '../.qa/tools/node_modules/dompurify/dist/purify.es.mjs';
import Ajv from '../.qa/tools/node_modules/ajv/dist/2020.js';
import addFormats from '../.qa/tools/node_modules/ajv-formats/dist/index.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixtures=path.join(root,'tests/fixtures/host');
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://synthetic.invalid'});
const win=dom.window;
Object.assign(globalThis,{window:win,document:win.document,Element:win.Element,DOMParser:win.DOMParser});
let osCalls=[];win.tezbar=new Proxy({}, {get(_,p){return()=>{osCalls.push(p);throw new Error(`Denied OS ${String(p)}`)}}});
const context=vm.createContext({window:win,document:win.document,Element:win.Element,DOMParser:win.DOMParser,console});
const load=(source,mocks)=>{const exports={};const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
vm.compileFunction(compiled,['exports','require'],{parsingContext:context})(exports,p=>{if(p==='react')return React;if(p==='react/jsx-runtime')return jsx;if(!(p in mocks))throw new Error(`Denied renderer import ${p}`);return mocks[p]});return exports;};
const read=p=>fs.readFileSync(path.join(fixtures,p),'utf8');
const Markdown=load(read('src/renderer/ui/Markdown.tsx'),{'marked':{Marked},'marked-highlight':{markedHighlight},'highlight.js/lib/common':{__esModule:true,default:hljs},'dompurify':{__esModule:true,default:createDOMPurify(win)}}).Markdown;
const Detail=load(read('src/renderer/src/raycast-api/detail-runtime.tsx'),{'../../ui/Markdown':{Markdown},'../../ui/primitives':{cx:(...v)=>v.filter(Boolean).join(' ')},'../../colorConverter':{buildColorFormatRows:()=>{throw new Error('Unexpected color surface')}}}).DetailRuntime;
const actionContext=React.createContext(null),navigationContext=React.createContext(null);
const mocks={'./detail-runtime':{DetailRuntime:Detail},'./action-runtime':{Action:()=>null,ActionPanel:()=>null,ActionPanelOverlay:()=>null},'./action-runtime-registry':{ActionRegistryContext:actionContext},'./form-runtime':{FormRuntime:()=>{throw new Error('Unexpected form')}},'./grid-runtime':{GridRuntime:()=>{throw new Error('Unexpected grid')}},'./list-runtime':{ListRuntime:()=>{throw new Error('Unexpected list')}},'./hooks':{NavigationContext:navigationContext,setRuntimeContext:()=>{}}};
const app=ReactDOM.createRoot(document.getElementById('root'));
const primary='text-differ:fixture';let calls=[];
const testBody='left <img src="file:///unselected"> ↔ right\n\n-<script>alert(1)</script>\n+[x](https://evil.invalid)\n![p](file:///secret)\n```diff\n~~~\n\t  indented & \r\n';
const display=s=>s.replaceAll('\\','\\\\').replaceAll('\r','\\r');
const escape=s=>display(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;').replaceAll('\r','&#13;');
// Also consume native-produced markup from the actual pipe suite when available.
const nativeFixture=path.join(root,'.qa/render-fixture.json');
const native=fs.existsSync(nativeFixture)?JSON.parse(fs.readFileSync(nativeFixture,'utf8')):null;
for(const [label,source]of [['before',read('src/renderer/src/raycast-api/index.tsx')],['after',fs.readFileSync(path.join(root,'.qa/patched-host/src/renderer/src/raycast-api/index.tsx'),'utf8')]]){
 const Surface=load(source,mocks).ExtensionRuntimeSurface;
 calls=[];const runtimeRoot=native?.root??{type:'Detail',props:{markdown:`<pre>${escape(testBody)}</pre>`}};
 flushSync(()=>app.render(React.createElement(Surface,{sessionId:'fixture',extensionId:'com.tezbar.native.text-differ',commandName:'open-with-text-differ',title:'Text Differ',root:runtimeRoot,actions:[{id:primary,title:'Copy Diff',kind:'action'}],onBack:()=>{},onSearchTextChanged:()=>{throw new Error('Unexpected search')},onLoadMore:()=>{throw new Error('Unexpected load more')},onInvokeAction:(...args)=>calls.push(args)})));
 const pre=document.querySelector('pre');assert(pre);assert.equal(pre.textContent,display(native?.text??testBody));
 assert.equal(document.querySelectorAll('a,img,script,pre code,.tezbar-md-code-copy').length,0,'User content must not create active markup or unowned copy actions');
 const enter=[...document.querySelectorAll('button')].find(b=>b.textContent==='Enter');assert(enter);
 enter.dispatchEvent(new win.MouseEvent('click',{bubbles:true}));
 if(label==='before')assert.equal(typeof calls.at(-1)[0],'object','Pinned host mistakenly sends MouseEvent as actionId');
 else assert.deepEqual(calls.at(-1),[primary,undefined]);
 calls=[];win.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.deepEqual(calls.at(-1),[primary]);
 if(label==='after'){
  const actions=[...document.querySelectorAll('button')].find(b=>b.textContent==='Cmd+K');
  flushSync(()=>actions.dispatchEvent(new win.MouseEvent('click',{bubbles:true})));
 }
}
flushSync(()=>app.unmount());assert.deepEqual(osCalls,[]);
const ajv=new Ajv({strict:false,allErrors:true});addFormats(ajv);
const schema=JSON.parse(read('schemas/extension-v3.schema.json'));
const validate=ajv.compile(schema);const manifest=JSON.parse(fs.readFileSync(path.join(root,'extension.json'),'utf8'));assert(validate(manifest),JSON.stringify(validate.errors));
const negatives=[m=>m.schemaVersion=2,m=>m.runtime='javascript',m=>m.protocolVersion=2,m=>m.capabilities.push('host.arbitrary.exec'),m=>m.commands[0].refreshMs=10,m=>m.artifacts={'x86_64-pc-windows-msvc':{url:'file:///bad',sha256:'0'.repeat(64),executable:'../bad',executableSha256:'0'.repeat(64)}},m=>m.unknown=true];
for(const mutate of negatives){const m=structuredClone(manifest);mutate(m);assert(!validate(m),'Schema negative accepted')}
console.log(JSON.stringify({pinnedRendererExecuted:true,detailMouseEventBefore:'object',detailMouseEventAfter:primary,hostilePreTextExact:true,activeContentNodes:0,osEffects:0,actualSchema:true,schemaNegatives:negatives.length,nativeMarkup:!!native},null,2));
win.close();
