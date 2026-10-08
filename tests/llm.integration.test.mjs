// DeepSeek 官方 API 真实集成测试：直接请求 api.deepseek.com，无任何 mock。
// 密钥从 keys.txt 读取；没有有效密钥或网络不通时，测试如实失败（不跳过、不伪造）。
import{test}from'node:test';import assert from'node:assert/strict';
import fs from'node:fs';
import{streamChat,DEFAULT_MODEL}from'../src/llm.js';

const key=(fs.readFileSync(new URL('../keys.txt',import.meta.url),'utf8').match(/sk-[A-Za-z0-9]+/)||[''])[0];

test('keys.txt 提供真实 DeepSeek 密钥',()=>{
 assert.match(key,/^sk-[A-Za-z0-9]+$/,'keys.txt 必须包含 sk-… 格式的 API key');
});

test('deepseek-flash 真实流式对话：官方 API 返回真实内容与用量',async()=>{
 const events=[];
 const res=await streamChat({apiKey:key,model:DEFAULT_MODEL,effort:'low',
  messages:[{role:'system',content:'只输出 JSON，不要解释。'},{role:'user',content:'返回这个 JSON 本身：{"ok":true,"engine":"deepseek"}'}],
  onEvent:e=>events.push(e.type)});
 assert.equal(res.finish,'stop');
 assert.ok(res.content.includes('"ok"'),'真实回复应包含请求的 JSON 字段');
 assert.ok(res.usage&&res.usage.total_tokens>0,'官方 API 必须返回真实 token 用量');
 assert.ok(events.includes('text'),'流式过程必须产出真实文本增量');
});

test('deepseek-flash 真实工具调用：模型主动请求 display_seek 工具',async()=>{
 const res=await streamChat({apiKey:key,model:DEFAULT_MODEL,effort:'low',
  messages:[{role:'system',content:'你是工具代理：必须调用工具完成任务，不要直接回答。'},{role:'user',content:'把显示时间设为 600 秒'}],
  tools:[{type:'function',function:{name:'display_seek',description:'设置工作台显示游标（秒）',
   parameters:{type:'object',properties:{seconds:{type:'number',description:'0 到场景时长'}},required:['seconds']}}}]});
 assert.equal(res.finish,'tool_calls');
 assert.equal(res.toolCalls.length,1);
 assert.equal(res.toolCalls[0].name,'display.seek','API 工具名 display_seek 应映射回目录名 display.seek');
 const args=JSON.parse(res.toolCalls[0].arguments);
 assert.equal(args.seconds,600);
});
