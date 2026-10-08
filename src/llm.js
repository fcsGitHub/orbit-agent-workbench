// DeepSeek 官方 API 真实客户端（OpenAI 兼容 /chat/completions）。
// 本文件没有任何 mock、演示回退或伪造响应：所有文本、推理内容与工具调用
// 都来自官方 API 的真实返回；请求失败时抛出真实错误，绝不编造回复。
// API key 来源：构建时从 keys.txt 注入（__DEEPSEEK_API_KEY__），可在设置中覆盖。
const BUILTIN_KEY=typeof __DEEPSEEK_API_KEY__!=='undefined'?__DEEPSEEK_API_KEY__:'';
export const DEFAULT_BASE_URL='https://api.deepseek.com';
export const DEFAULT_MODEL='deepseek-flash'; // DeepSeek-V4.1-Flash，官方模型目录中的 flash 档
export const EFFORT_LEVELS=['low','high','max'];
export const BUILTIN_API_KEY=BUILTIN_KEY;
export const CONFIG_STORAGE_KEY='orbit-llm-config-v1';

export class LlmError extends Error{constructor(message){super(message);this.name='LlmError';}}

// 官方 API 的 function.name 只允许 [a-zA-Z0-9_-]+，工具目录名是 a.b 形式：做一一映射
export const encodeToolName=name=>name.replace(/\./g,'_');
export const decodeToolName=name=>name.replace(/_/g,'.');

function localStorageSafe(){try{return typeof localStorage==='undefined'?null:localStorage;}catch(e){return null;}}

// 运行配置：localStorage 覆盖项优先，否则用构建时注入的 keys.txt 密钥与官方默认值
export function loadLlmConfig(){
 const store=localStorageSafe();let saved={};
 if(store){try{saved=JSON.parse(store.getItem(CONFIG_STORAGE_KEY)||'{}')||{};}catch(e){saved={};}}
 return{model:(saved.model||'').trim()||DEFAULT_MODEL,
  effort:EFFORT_LEVELS.includes(saved.effort)?saved.effort:'low',
  baseUrl:(saved.baseUrl||'').trim()||DEFAULT_BASE_URL,
  apiKey:(saved.apiKey||'').trim()||BUILTIN_KEY,builtinKey:!!BUILTIN_KEY};
}
export function saveLlmConfig(cfg){
 const store=localStorageSafe();if(!store)return;
 try{store.setItem(CONFIG_STORAGE_KEY,JSON.stringify({model:cfg.model,effort:cfg.effort,baseUrl:cfg.baseUrl,
  apiKey:cfg.apiKey===BUILTIN_KEY?'':cfg.apiKey}));}catch(e){}
}

// 流式 SSE 增量解析：按行分帧，返回每个 data: 负载（跨 chunk 安全）
export function createSseParser(){
 let buf='';
 function extract(){const out=[];let i;while((i=buf.indexOf('\n'))>=0){out.push(buf.slice(0,i).replace(/\r$/,''));buf=buf.slice(i+1);}return out;}
 return{push(chunk){buf+=chunk;return extract().filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim());},
  flush(){const rest=buf.replace(/\r$/,'');buf='';return rest.startsWith('data:')?[rest.slice(5).trim()]:[];}};
}

function mergeToolCallDelta(calls,tc){
 const i=tc.index||0;
 if(!calls[i])calls[i]={id:'',name:'',arguments:''};
 if(tc.id)calls[i].id=tc.id;
 if(tc.function){
  if(tc.function.name)calls[i].name+=tc.function.name;
  if(tc.function.arguments)calls[i].arguments+=tc.function.arguments;
 }
}

export async function streamChat({apiKey,baseUrl=DEFAULT_BASE_URL,model=DEFAULT_MODEL,effort,messages,tools,signal,onEvent}){
 if(!apiKey)throw new LlmError('未配置 DeepSeek API key：构建时需要读取 keys.txt，或在“工具与能力 → 模型连接”中填写真实密钥');
 const body={model,messages,stream:true,stream_options:{include_usage:true}};
 if(effort)body.effort=effort;
 if(tools&&tools.length)body.tools=tools;
 let res;
 try{res=await fetch(baseUrl.replace(/\/+$/,'')+'/chat/completions',{method:'POST',signal,
  headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},body:JSON.stringify(body)});}
 catch(e){if(e&&e.name==='AbortError')throw e;throw new LlmError('连接 DeepSeek API 失败：'+(e&&e.message||e));}
 if(!res.ok){
  let detail='';
  try{const j=await res.json();detail=(j&&j.error&&j.error.message)||JSON.stringify(j);}
  catch(e){try{detail=await res.text();}catch(_){/* 无响应体 */}}
  throw new LlmError(`DeepSeek API 返回 HTTP ${res.status}${detail?'：'+detail:''}`);
 }
 if(!res.body)throw new LlmError('DeepSeek API 未返回流式响应体');
 const reader=res.body.getReader(),decoder=new TextDecoder(),parser=createSseParser();
 let content='',reasoning='',usage=null,finish=null;const calls=[];
 const handleData=data=>{
  if(data==='[DONE]')return;
  let chunk;try{chunk=JSON.parse(data);}catch(e){return;} // 无法解析的帧丢弃，不伪造内容
  const choice=chunk.choices&&chunk.choices[0],delta=choice&&choice.delta;
  if(delta){
   if(delta.reasoning_content){reasoning+=delta.reasoning_content;if(onEvent)onEvent({type:'reasoning',text:delta.reasoning_content});}
   if(delta.content){content+=delta.content;if(onEvent)onEvent({type:'text',text:delta.content});}
   if(delta.tool_calls)for(const tc of delta.tool_calls)mergeToolCallDelta(calls,tc);
  }
  if(chunk.usage)usage=chunk.usage;
  if(choice&&choice.finish_reason)finish=choice.finish_reason;
 };
 for(;;){
  let done,value;
  try{({done,value}=await reader.read());}
  catch(e){if(e&&e.name==='AbortError')throw e;throw new LlmError('读取 DeepSeek 流式响应失败：'+(e&&e.message||e));}
  if(done)break;
  for(const data of parser.push(decoder.decode(value,{stream:true})))handleData(data);
 }
 for(const data of parser.flush())handleData(data);
 return{content,reasoning,finish,usage,toolCalls:calls.filter(Boolean).map(c=>({...c,name:decodeToolName(c.name)}))};
}

// 真实连通性测试：一次最小补全，返回真实延迟与真实输出
export async function testConnection(config,signal){
 const t0=Date.now();
 const res=await streamChat({...config,effort:config.effort||'low',
  messages:[{role:'user',content:'这是连通性测试。只回复两个字：连通'}],signal});
 return{latencyMs:Date.now()-t0,content:res.content.trim(),usage:res.usage,finish:res.finish};
}
