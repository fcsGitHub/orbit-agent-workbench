// Agent 循环：把工作台的真实工具目录暴露给 DeepSeek 模型；模型提出工具调用，
// 统一分发器真实执行后把结果回传，模型基于真实结果继续，直到给出最终回答。
// 没有 mock：模型输出来自官方 API，工具结果来自统一提交链（CAS · 幂等 · 回执）。
import{TOOL_CATALOG}from'./commands.js';
import{streamChat,encodeToolName,LlmError}from'./llm.js';

export const MAX_ROUNDS=8; // 单次提问的真实工具轮数上限，防止失控循环
// status 是分发器中的真实分支（浏览器内状态 JSON），对模型有价值的补充
const EXTRA_TOOLS=[{name:'status',description:'查询工作台当前状态 JSON（项目/会话/草稿/本地缓冲/作业/评价/视图/游标）',input:{}}];

// 与 src/commands.js 分发器分支一一对应的 JSON Schema
const TOOL_SCHEMAS={
 'workspace.open':{kind:{type:'string',enum:['orbit','scenario','models','experiments','replay','terminal','browser','files'],description:'要打开或聚焦的工作区类型'}},
 'view.set':{view:{type:'string',enum:['global','relative','comm','observation'],description:'global 全局总览 / relative 相对轨迹 / comm 通信几何 / observation 对地遥感'}},
 'view.select':{id:{type:'string',description:'场景对象 ID 或名称，例如 Echo-02'}},
 'view.follow':{enabled:{type:'boolean',description:'true 开启镜头跟随 / false 关闭'},id:{type:'string',description:'可选：跟随目标对象 ID，默认保持当前选中'}},
 'station.add':{lat:{type:'number',description:'纬度 -90..90（度，北正）'},lon:{type:'number',description:'经度 -180..180（度，东正）'},name:{type:'string',description:'可选测站名称'}},
 'station.remove':{id:{type:'string',description:'测站 ID 或名称'}},
 'stations.list':{},
 'passes.list':{station_id:{type:'string',description:'可选：限定测站 ID 或名称'},asset_id:{type:'string',description:'可选：限定场景对象 ID 或名称'},mask_deg:{type:'number',description:'可选：掩蔽角（度 0-80），默认用面板设置'}},
 'passes.joint':{asset_id:{type:'string',description:'可选：限定场景对象 ID 或名称'},mask_deg:{type:'number',description:'可选：掩蔽角（度 0-80），默认用面板设置'}},
 'events.list':{},
 'eclipse.list':{asset_id:{type:'string',description:'可选：限定场景对象 ID 或名称，默认全部对象'}},
 'assets.list':{},
 'subpoint.query':{asset_id:{type:'string',description:'可选：场景对象 ID 或名称，默认当前选中对象'},seconds:{type:'number',description:'可选：场景秒 0..duration，默认当前显示游标时刻'}},
 'display.rate':{speed:{type:'number',enum:[1,10,30,60,120],description:'播放倍速'}},
 'view.capture':{},
 'display.seek':{seconds:{type:'number',description:'显示游标秒数（0 到场景时长）；只改呈现，不推进计算'}},
 'display.play':{playing:{type:'boolean',description:'true 开始播放 / false 暂停'}},
 'knowledge.set':{delivery:{type:'string',enum:['instant','delayed'],description:'instant 即时交付 / delayed 延迟 60 秒（演示投影）'}},
 'model.update':{altitude:{type:'number',description:'轨道高度 160–36000 km；写入本地草稿缓冲，未保存'}},
 'draft.save':{key:{type:'string',description:'可选幂等键'}},
 'draft.restore':{source_revision:{type:'string',description:'要恢复的历史版本，例如 r1'}},
 'draft.fork':{source_revision:{type:'string',description:'分支来源版本，默认当前 head'}},
 'experiment.preflight':{source_revision:{type:'string',description:'预检的来源版本，默认当前来源/head；只读，不创建锁'}},
 'experiment.freeze':{source_revision:{type:'string',description:'冻结的来源版本，默认当前来源/head'}},
 'batch.submit':{lock_id:{type:'string',description:'实验锁 ID，例如 L1；默认最新锁'}},
 'job.pause':{job_id:{type:'string',description:'作业 ID，例如 J1'}},
 'job.resume':{job_id:{type:'string',description:'作业 ID，例如 J1'}},
 'job.cancel':{job_id:{type:'string',description:'作业 ID，例如 J1'}},
 'jobs.list':{},
 'evaluation.create':{job_id:{type:'string',description:'已完成的作业 ID，例如 J1'}},
 'results.list':{},
 'comparison.create':{a:{type:'string',description:'左侧评价 ID，例如 E1'},b:{type:'string',description:'右侧评价 ID，例如 E2'}},
 'receipt.query':{receipt_id:{type:'string',description:'回执 ID，例如 rcp-1'}},
 'receipts.list':{},
 'artifact.export':{evaluation_id:{type:'string',description:'评价 ID，例如 E1；会触发浏览器下载'}},
 'scene.validate':{},
 'scene.export':{},
 'replay.open':{job_id:{type:'string',description:'作业 ID，例如 J1；绑定其固定评价'}},
 'status':{},
};

export function buildTools(){
 return[...TOOL_CATALOG,...EXTRA_TOOLS].filter(t=>TOOL_SCHEMAS[t.name]).map(t=>({type:'function',
  function:{name:encodeToolName(t.name),description:t.description+(t.notes?`（${t.notes}）`:''),
   parameters:{type:'object',properties:TOOL_SCHEMAS[t.name]}}}));
}

export function parseToolArguments(raw){
 if(!raw||!raw.trim())return{};
 try{return JSON.parse(raw);}catch(e){const err=new Error('工具参数不是有效 JSON：'+e.message);throw err;}
}

// UI 消息记录 → API 消息数组（保持 assistant/tool 严格配对）
export function toApiMessages(uiMessages){
 const out=[];
 for(const m of uiMessages){
  if(m.role==='user')out.push({role:'user',content:m.text||''});
  else if(m.role==='assistant'){
   if(m.toolCalls&&m.toolCalls.length)
    out.push({role:'assistant',content:m.text||'',tool_calls:m.toolCalls.map(c=>({id:c.id,type:'function',
     function:{name:encodeToolName(c.name),arguments:typeof c.arguments==='string'?c.arguments:JSON.stringify(c.arguments||{})}}))});
   else if(m.text)out.push({role:'assistant',content:m.text});
  }else if(m.role==='tool'&&m.toolCallId)out.push({role:'tool',tool_call_id:m.toolCallId,content:m.text||''});
 }
 return out;
}

export function buildSystemPrompt(ctx){
 return[
  '你是“轨道 Agent 工作台”的仿真研究助手，通过真实工具调用操作一个浏览器内的民用轨道仿真工作台。',
  '所有工具经统一提交链执行（内容摘要 → CAS → 幂等键 → 回执）。显示动作（display.* / view.* / knowledge.set / workspace.open）只改呈现状态，不产生领域回执；领域动作（draft.* / experiment.* / batch.* / job.* / evaluation / comparison / receipt）返回可追溯的回执 ID。',
  '',
  '当前工作台状态（随每次提问刷新）：',
  `- 项目 ${ctx.project} · 会话 ${ctx.session}`,
  `- 草稿 ${ctx.draft} · head ${ctx.head}${ctx.buffer?` · 本地缓冲：${ctx.buffer}`:' · 无未保存编辑'}`,
  `- 场景：${ctx.scene}`,
  `- 显示游标 T+${ctx.time}s · 视图 ${ctx.view} · 选中 ${ctx.selected} · ${ctx.playing?'播放中':'已暂停'} · 交付 ${ctx.delivery}`,
  `- 2D 地面轨迹图：${ctx.map2d?'已开启（全对象星下点轨迹 · 晨昏线 · 测站，与三维视口并列显示）':'未开启（图层中可开启；呈现动作，不影响计算）'}`,
  `- 实验：${ctx.jobs}`,
  `- 评价：${ctx.evaluations}`,
  '',
  '行为准则：',
  '1. 需要查看或改变工作台状态时调用工具；严禁编造工具结果、回执 ID、数值或作业状态。',
  '2. 工具返回的是真实执行结果，包括失败与限制；如实转述，不要粉饰。',
  '3. 场景全部为合成示例数据；运行模型是 e=0 圆轨道二体（circular-two-body@0.1），无 J2、阻力、机动或链路预算。不要虚构更高的保真度。',
  '4. 用简体中文简洁回答：先说明做了什么，再给结论。领域写入（保存草稿、冻结、提交、暂停/继续/取消）执行前用一句话说明意图。',
 ].join('\n');
}

export async function runAgentTurn({config,systemPrompt,apiMessages,executeTool,signal,onEvent}){
 const messages=[{role:'system',content:systemPrompt},...apiMessages];
 const tools=buildTools();
 for(let round=1;;round++){
  if(round>MAX_ROUNDS)throw new LlmError(`已连续执行 ${MAX_ROUNDS} 轮工具仍未给出最终回答，本轮停止（真实上限；可继续追问）`);
  if(round>1&&onEvent)onEvent({type:'round_start',round});
  const res=await streamChat({apiKey:config.apiKey,baseUrl:config.baseUrl,model:config.model,effort:config.effort,
   messages,tools,signal,onEvent});
  if(res.toolCalls.length){
   messages.push({role:'assistant',content:res.content||'',tool_calls:res.toolCalls.map(c=>({id:c.id,type:'function',
    function:{name:encodeToolName(c.name),arguments:c.arguments}}))});
   if(onEvent)onEvent({type:'tool_calls',calls:res.toolCalls});
   for(const call of res.toolCalls){
    let out,args=null,parseError=null;
    try{args=parseToolArguments(call.arguments);}catch(e){parseError=e;}
    if(parseError)out={ok:false,text:`工具参数解析失败：${parseError.message}（原始参数：${call.arguments}）`};
    else{try{out=await executeTool(call.name,args,call.id);}
     catch(e){out={ok:false,text:'工具执行异常：'+(e&&e.message||e)};}}
    messages.push({role:'tool',tool_call_id:call.id,content:String(out&&out.text||'')});
   }
   continue;
  }
  return{content:res.content,reasoning:res.reasoning,usage:res.usage,finish:res.finish,rounds:round};
 }
}
