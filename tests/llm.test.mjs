// LLM 接线单元测试（离线、确定性）：只测真实代码的纯逻辑，
// 不伪造任何模型输出；真实 API 行为由 tests/llm.integration.test.mjs 覆盖。
import{test}from'node:test';import assert from'node:assert/strict';
import{createSseParser,encodeToolName,decodeToolName,loadLlmConfig,DEFAULT_MODEL,DEFAULT_BASE_URL,LlmError,streamChat}from'../src/llm.js';
import{buildTools,buildSystemPrompt,toApiMessages,parseToolArguments,MAX_ROUNDS}from'../src/agent.js';
import{TOOL_CATALOG}from'../src/commands.js';

test('工具名映射：目录名 a.b ↔ API 名 a_b 一一对应且满足官方命名规则',()=>{
 const enc=new Set();
 for(const t of TOOL_CATALOG){
  const e=encodeToolName(t.name);
  assert.match(e,/^[a-zA-Z0-9_-]+$/,`${t.name} 编码后必须满足官方 function.name 模式`);
  assert.equal(decodeToolName(e),t.name);
  assert.ok(!enc.has(e),'编码后不得重名');enc.add(e);
 }
});
test('SSE 解析：跨 chunk 分帧、data: 前缀与 [DONE] 终止帧',()=>{
 const p=createSseParser();
 const out=[...p.push('data: {"a":1}\n\ndata: {"b'),...p.push('":2}\r\ndata: [DONE]\n\n'),...p.flush()];
 assert.deepEqual(out,['{"a":1}','{"b":2}','[DONE]']);
});
test('SSE 解析：忽略非 data 行（注释/心跳）',()=>{
 const p=createSseParser();
 assert.deepEqual([...p.push(': keep-alive\n\ndata: {"x":9}\n\n')],['{"x":9}']);
});
test('UI 消息 → API 消息：assistant/tool 严格配对、工具名编码、欢迎语跳过',()=>{
 const api=toApiMessages([
  {id:0,role:'system',text:'欢迎语'},
  {id:1,role:'user',text:'把时间设到 900 秒'},
  {id:2,role:'assistant',text:'',toolCalls:[{id:'call_1',name:'display.seek',args:'{"seconds":900}'}]},
  {id:3,role:'tool',toolCallId:'call_1',name:'display.seek',text:'显示游标已设为 900 秒',ok:true},
  {id:4,role:'assistant',text:'完成'}]);
 assert.equal(api.length,4);
 assert.equal(api[0].role,'user');assert.equal(api[0].content,'把时间设到 900 秒');
 assert.equal(api[1].role,'assistant');assert.equal(api[1].tool_calls[0].function.name,'display_seek');
 assert.equal(api[2].role,'tool');assert.equal(api[2].tool_call_id,'call_1');
 assert.equal(api[3].role,'assistant');assert.equal(api[3].content,'完成');
});
test('工具目录完整暴露：每个目录工具都有参数 schema，status 为补充',()=>{
 const tools=buildTools();const names=tools.map(t=>t.function.name);
 for(const t of TOOL_CATALOG)assert.ok(names.includes(encodeToolName(t.name)),`缺少工具 ${t.name}`);
 assert.ok(names.includes('status'));
 for(const t of tools){assert.equal(t.type,'function');assert.equal(typeof t.function.description,'string');
  assert.equal(t.function.parameters.type,'object');}
});
test('工具参数解析：空串 → 空对象；非法 JSON 显式报错，绝不静默猜测',()=>{
 assert.deepEqual(parseToolArguments(''),{});
 assert.deepEqual(parseToolArguments('  '),{});
 assert.deepEqual(parseToolArguments('{"seconds":600}'),{seconds:600});
 assert.throws(()=>parseToolArguments('{oops'),Error);
});
test('系统提示注入真实上下文（项目/草稿/场景/作业），并声明合成数据边界',()=>{
 const s=buildSystemPrompt({project:'轨道仿真实验室',session:'会话 1',draft:'d1',head:'r2',buffer:'',
  scene:'测试场景（Terra/Terra-01: 高度 700 km；时长 5400s；0 个可用性事件）',time:300,view:'全局总览',
  selected:'Terra-01(Terra-01)',playing:false,delivery:'即时',jobs:'无',evaluations:'无'});
 assert.ok(s.includes('轨道仿真实验室'));assert.ok(s.includes('r2'));
 assert.ok(s.includes('合成示例数据'));assert.ok(s.includes('严禁编造工具结果'));
});
test('Node 环境（无 localStorage/密钥）下配置回退为官方默认值',()=>{
 const cfg=loadLlmConfig();
 assert.equal(cfg.model,DEFAULT_MODEL);assert.equal(cfg.baseUrl,DEFAULT_BASE_URL);
 assert.equal(cfg.apiKey,'');assert.equal(cfg.builtinKey,false);
});
test('未配置密钥时 streamChat 抛出真实错误，不做任何演示回退',async()=>{
 await assert.rejects(()=>streamChat({apiKey:'',messages:[{role:'user',content:'hi'}]}),LlmError);
});
test('Agent 轮数上限是真实常量',()=>{assert.ok(MAX_ROUNDS>=2&&MAX_ROUNDS<=16);});
test('0.9 新增工具全部暴露给模型：assets_list / subpoint_query / display_rate',()=>{
 const tools=buildTools(),names=tools.map(t=>t.function.name);
 for(const n of['assets_list','subpoint_query','display_rate'])assert.ok(names.includes(n),`缺少 ${n}`);
 const sp=tools.find(t=>t.function.name==='subpoint_query');
 assert.ok(sp.function.parameters.properties.asset_id&&sp.function.parameters.properties.seconds,'subpoint_query 参数 schema 完整');
 const dr=tools.find(t=>t.function.name==='display_rate');
 assert.deepEqual(dr.function.parameters.properties.speed.enum,[1,10,30,60,120],'倍速枚举与界面一致');
});
test('系统提示注入 2D 地面轨迹图状态（开启/关闭两态）',()=>{
 const mk=map2d=>buildSystemPrompt({project:'p',session:'s',draft:'d',head:'r1',buffer:'',scene:'x',time:0,view:'v',selected:'a',playing:false,map2d,delivery:'即时',jobs:'无',evaluations:'无'});
 assert.ok(mk(true).includes('2D 地面轨迹图：已开启'));
 assert.ok(mk(false).includes('2D 地面轨迹图：未开启'));
});
