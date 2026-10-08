import React,{useState,useRef,useEffect,useMemo} from 'react';import{createRoot}from'react-dom/client';
import{Plus,PanelLeftClose,PanelLeftOpen,PanelRightClose,PanelRightOpen,ChevronDown,ChevronRight,ArrowUp,Terminal,Globe,FileCode2,Orbit,Box,FlaskConical,History,Settings2,Play,Pause,RotateCcw,Maximize2,Minimize2,X,Folder,FolderOpen,Check,Copy,Download,Upload,Home,Layers,Crosshair,ChevronsLeft,Command,Info,CheckCircle2,AlertCircle,Search,FileJson,Satellite,Camera,Radio,Activity,Square,MessageSquare,ExternalLink,Clock,MoreHorizontal,Lock,ShieldCheck,ListChecks,GitBranch,Save,Radar,MapPin,Map as MapIcon,Wrench}from'lucide-react';
import OrbitViewport from './OrbitViewport.jsx';import GroundMap from './GroundMap.jsx';import{DEFAULT_SCENE,clone,validateScene,stateAt,EARTH_R,norm,sub,fmt,formatTime,observedTime,observationAvailable,lineOfSight,rtn,groundPoint,footprintRadius,eventTime,activeEvents,deliveryEvents,sunDirectionECI,inEarthShadow,stationEcef,lookAngles,passWindows,jointVisibility,sunEvents,subsolarPoint}from'./domain.js';import{parseCommand,TOOL_CATALOG}from'./commands.js';
import{bootstrapProject,createSession,createDraft,saveDraft,forkDraft,preflight,freezeExperiment,submitBatch,jobTick,pauseJob,resumeJob,cancelJob,jobSummary,buildEvaluation,listEvaluations,listJobs,listLocks,label,threeWayMerge,restoreRevision,createComparison,queryReceipt,listReceipts,listComparisons,archiveSession,snapshotProject,restoreProject}from'./app.js';
import{loadLlmConfig,saveLlmConfig,testConnection,EFFORT_LEVELS}from'./llm.js';
import{runAgentTurn,buildSystemPrompt,toApiMessages}from'./agent.js';
const TAB_INFO={orbit:['三维视图',Orbit],scenario:['场景',FileJson],models:['模型',Box],experiments:['实验',FlaskConical],replay:['回放',History],terminal:['终端',Terminal],browser:['浏览器',Globe],files:['文件',FileCode2]};
const VIEWS={global:'全局总览',relative:'相对轨迹',comm:'通信几何',observation:'对地遥感'};
const JOB_STATE_LABEL={queued:'排队',running:'运行中',pausing:'暂停中',paused:'已暂停',completed:'已完成',cancelled:'已取消',failed:'失败'};
function IconButton({icon:Icon,label,onClick,active=false,...rest}){return <button type="button" className={'icon-button '+(active?'active':'')} title={label} aria-label={label} onClick={onClick} {...rest}><Icon size={16}/></button>}
function PageHeading({icon:I,title,description,children}){return <header className="page-heading"><div><div className="page-title"><I size={19}/><h2>{title}</h2></div><p>{description}</p></div><div className="page-actions">{children}</div></header>;}
function Modal({title,onClose,children,wide}){return <div className="modal-backdrop" onClick={onClose}><section className={'modal '+(wide?'modal-wide':'')} role="dialog" aria-modal="true" aria-label={title} onClick={e=>e.stopPropagation()}><header><h2>{title}</h2><IconButton icon={X} label="关闭" onClick={onClose}/></header>{children}</section></div>;}
// 极简 Markdown 渲染（模型真实输出的常用子集：标题/有序无序列表/粗体/行内代码/围栏代码块）。
// 不引入外部依赖（保持单文件离线产物），不渲染原始 HTML——全部经 React 文本节点输出，无注入面。
function mdInline(text,key){
 return String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((p,i)=>p.startsWith('**')&&p.endsWith('**')&&p.length>4?<strong key={key+i}>{p.slice(2,-2)}</strong>:p.startsWith('`')&&p.endsWith('`')&&p.length>2?<code className="md-inline" key={key+i}>{p.slice(1,-1)}</code>:<React.Fragment key={key+i}>{p}</React.Fragment>);
}
function renderMarkdown(src){
 if(!src)return null;
 const lines=String(src).split('\n'),out=[];let i=0,k=0;
 while(i<lines.length){
  const l=lines[i];
  if(/^```/.test(l.trim())){const buf=[];i++;while(i<lines.length&&!/^```/.test(lines[i].trim()))buf.push(lines[i++]);i++;out.push(<pre className="md-codeblock" key={k++}>{buf.join('\n')}</pre>);continue;}
  const h=l.match(/^#{1,4}\s+(.*)$/);
  if(h){out.push(<h5 className="md-heading" key={k++}>{mdInline(h[1],'h'+k)}</h5>);i++;continue;}
  if(/^\s*(?:[-*•]|\d+[.、)])\s+/.test(l)){ // 连续同类列表项聚合为一个 ul/ol
   const ord=/^\s*\d+[.、)]\s+/.test(l),items=[];
   while(i<lines.length&&/^\s*(?:[-*•]|\d+[.、)])\s+/.test(lines[i])&&/^\s*\d+[.、)]\s+/.test(lines[i])===ord)items.push(lines[i++].replace(/^\s*(?:[-*•]|\d+[.、)])\s+/,''));
   const List=ord?'ol':'ul';
   out.push(<List className="md-list" key={k++}>{items.map((it,j)=><li key={j}>{mdInline(it,'l'+k+j)}</li>)}</List>);continue;}
  if(/^\s*\|.*\|\s*$/.test(l)){ // 管道表格：| 表头 | 分隔行 | 数据行 |（模型常用输出形态）
   const rows=[];
   while(i<lines.length&&/^\s*\|.*\|\s*$/.test(lines[i]))rows.push(lines[i++].trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(c=>c.trim()));
   const sep=rows.length>1&&rows[1].every(c=>/^:?-{3,}:?$/.test(c));
   if(sep){
    const head=rows[0],body=rows.slice(2);
    out.push(<table className="md-table" key={k++}><thead><tr>{head.map((h,j)=><th key={j}>{mdInline(h,'th'+k+j)}</th>)}</tr></thead><tbody>{body.map((r,j)=><tr key={j}>{r.map((c,q)=><td key={q}>{mdInline(c,'td'+k+j+q)}</td>)}</tr>)}</tbody></table>);continue;}
   out.push(<pre className="md-codeblock" key={k++}>{rows.map(r=>r.join(' | ')).join('\n')}</pre>);continue;}
  if(!l.trim()){i++;continue;}
  const buf=[l];i++;
  while(i<lines.length&&lines[i].trim()&&!/^```/.test(lines[i].trim())&&!/^#{1,4}\s+/.test(lines[i])&&!/^\s*(?:[-*•]|\d+[.、)])\s+/.test(lines[i])&&!/^\s*\|.*\|\s*$/.test(lines[i]))buf.push(lines[i++]);
  out.push(<p key={k++}>{buf.map((s,j)=><React.Fragment key={j}>{mdInline(s,'p'+k+j)}{j<buf.length-1?<br/>:null}</React.Fragment>)}</p>);
 }
 return out.length?out:[src];
}
// 脏导航守卫（UX06）：保留 / 保存 / 放弃 / 取消，失败不丢缓冲
function GuardDialog({guard,onClose,onSave,onDiscard}){
 return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="未保存的编辑"><section className="modal" onClick={e=>e.stopPropagation()}><header><h2>有未保存的草稿编辑</h2></header><p className="guard-text">本地缓冲基于 {label(guard.base)}，尚未保存为版本。{guard.what}会怎么处理这些编辑？</p><div className="dialog-actions"><button onClick={onDiscard}>放弃修改并继续</button><button onClick={onClose}>取消</button><button className="primary" onClick={onSave}><Save size={14}/>保存草稿并继续</button></div><small className="muted">保存失败时会留在原编辑器并保留输入。</small></section></div>;}
// CAS 冲突（UX01）：base / local / current 三方呈现，合并或分支，没有“确认覆盖”
function ConflictDialog({conflict,onMerge,onFork,onDiscard,onClose}){
 const m=useMemo(()=>threeWayMerge(conflict.base_scene,conflict.local_scene,conflict.current_scene),[conflict]);
 return <div className="modal-backdrop" onClick={onClose}><section className="modal modal-wide" role="dialog" aria-modal="true" aria-label="版本冲突" onClick={e=>e.stopPropagation()}><header><h2>保存冲突</h2><IconButton icon={X} label="关闭" onClick={onClose}/></header>
 <p className="guard-text">草稿已在其他会话前进到 <strong>{label(conflict.head)}</strong>；本地缓冲基于 <strong>{label(conflict.base)}</strong>。“确认覆盖”不是合法操作，请合并或另存分支。</p>
 <div className="conflict-columns">
  <div><h4>基线 {label(conflict.base)}</h4><pre>{JSON.stringify(conflict.base_scene,null,1)}</pre></div>
  <div><h4>本地缓冲</h4><pre>{JSON.stringify(conflict.local_scene,null,1)}</pre></div>
  <div><h4>当前 head {label(conflict.head)}</h4><pre>{JSON.stringify(conflict.current_scene,null,1)}</pre></div>
 </div>
 <p className={m.ok?'merge-ok':'merge-bad'}>{m.ok?<><CheckCircle2 size={14}/> 结构化合并可以自动完成：字段级合并双方改动。</>:<><AlertCircle size={14}/> 自动合并失败：{m.conflicts[0]}。建议另存为新草稿分支。</>}</p>
 <div className="dialog-actions"><button onClick={onDiscard}>放弃本地缓冲</button><button onClick={onFork}><GitBranch size={14}/>另存为新草稿分支</button><button className="primary" disabled={!m.ok} onClick={onMerge}><Check size={14}/>应用合并到缓冲</button></div></section></div>;}
function App({p,bump,version,sessionId,sessionItems,activeSession,onNewSession,onSessionSwitch,onArchiveSession,initialUi,uiRegistry,snapshotInfo}){
 const session=p.sessions[sessionId],draftId=session.draft_id||p.default_draft_id,draft=p.drafts[draftId]||Object.values(p.drafts)[0];
 const iu=initialUi||{};
 const[buf,setBuf]=useState(iu.buf&&iu.buf.dirty&&iu.buf.scene?iu.buf:null),[conflict,setConflict]=useState(null),[guard,setGuard]=useState(null);
 const[time,setTime]=useState(typeof iu.time==='number'?iu.time:300),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(iu.speed||30),[selected,setSelected]=useState(iu.selected||'terra-01'),[reference,setReference]=useState(iu.reference||'terra-01'),[view,setView]=useState(iu.view||'global'),[layers,setLayers]=useState({orbits:true,prediction:true,links:false,fov:false,ground:true,sun:true,map2d:true,...(iu.layers||{})}),[prediction,setPrediction]=useState(iu.prediction||'circular'),[horizon,setHorizon]=useState(iu.horizon||1200),[delivery,setDelivery]=useState(iu.delivery||'instant'),[perspective,updatePerspective]=useState(iu.perspective||'研究组 A'),[follow,setFollow]=useState(!!iu.follow),[stations,setStations]=useState(Array.isArray(iu.stations)?iu.stations:[]),[stationArm,setStationArm]=useState(false),[maskDeg,setMaskDeg]=useState(Number.isFinite(iu.maskDeg)?iu.maskDeg:10),[perfVisible,setPerfVisible]=useState(!!iu.perfVisible);
 const defaultTabs=[{id:'orbit-1',kind:'orbit',dedupe:'orbit:draft-head'},{id:'scenario-1',kind:'scenario',dedupe:'scenario:draft-head'},{id:'models-1',kind:'models',dedupe:'models:draft-head'}];
 const[tabs,setTabs]=useState(Array.isArray(iu.tabs)&&iu.tabs.length?iu.tabs:defaultTabs),[activeTab,setActiveTab]=useState(iu.activeTab||'orbit-1'),[maximized,setMaximized]=useState(false),[collapsed,setCollapsed]=useState(false),[sidebar,setSidebar]=useState(true),[projectsFold,setProjectsFold]=useState(false),[width,setWidth]=useState(62),[addOpen,setAddOpen]=useState(false),[toast,setToast]=useState(''),[input,setInput]=useState('');
 const[messages,setMessages]=useState(Array.isArray(iu.messages)&&iu.messages.length?iu.messages:[{id:0,role:'system',text:WELCOME}]),[resetKey,setResetKey]=useState(0),[inspector,setInspector]=useState(true),[objectsOpen,setObjectsOpen]=useState(false),[settingsOpen,setSettingsOpen]=useState(false),[sessionName,setSessionName]=useState(session.name),[llmConfig,setLlmConfigState]=useState(()=>loadLlmConfig()),[llmBusy,setLlmBusy]=useState(false),[llmCfg,setLlmCfg]=useState(null),[keyDraft,setKeyDraft]=useState(''),[connTest,setConnTest]=useState(null);
 const[sourceRev,setSourceRev]=useState(draft.revisions[iu.sourceRev]?iu.sourceRev:null),[pf,setPf]=useState(null),[lastEvalId,setLastEvalId]=useState(p.evaluations[iu.lastEvalId]?iu.lastEvalId:null),[filesDirty,setFilesDirty]=useState(false);
 useEffect(()=>{bump()},[stations]); // 测站是用户创建的显示层数据：变更即触发快照保存（否则刷新丢失）
 const uid=useRef(1),chatEnd=useRef(null),shell=useRef(null),upload=useRef(null),captureRef=useRef(null);
 function addStation(lat,lon,name){const st={id:`sta-${uid.current++}-${Date.now().toString(36)}`,name:name||`测站 ${stations.length+1}`,lat,lon,ecef:stationEcef(lat,lon)};setStations(v=>[...v,st]);notify(`测站 ${st.name} 已添加：纬度 ${lat}° · 经度 ${lon}°（显示层分析，不进入实验指纹）`);return st;}
 const msgRef=useRef(messages),dispatchRef=useRef(null),llmAbort=useRef(null),busyRef=useRef(false);
 msgRef.current=messages; // 渲染同步；Agent 异步循环内的 pushMsg/patchMsg 以 ref 为准
 dispatchRef.current=dispatchCommand; // Agent 多轮工具执行始终拿到最新渲染闭包（缓冲/状态不滞后）
 function setLlmConfig(next){setLlmConfigState(next);saveLlmConfig(next);}
 const partyKnowledge=useRef({'研究组 A':'instant','研究组 B':'delayed'});function setPerspective(v){partyKnowledge.current[perspective]=delivery;updatePerspective(v);setDelivery(partyKnowledge.current[v]);}
 const notify=m=>setToast(m);
 function openSettings(){setLlmCfg(null);setKeyDraft('');setConnTest(null);setSettingsOpen(true);}
 const head=draft.head,headScene=draft.revisions[head].scene;
 const displayedScene=buf?buf.scene:headScene,editingBase=buf?buf.base:head;
 const asset=displayedScene.assets.find(a=>a.id===selected)||displayedScene.assets[0];
 const current=tabs.find(t=>t.id===activeTab);
 const lastEval=lastEvalId?p.evaluations[lastEvalId]:listEvaluations(p).at(-1)||null;
 useEffect(()=>{ // 每次渲染登记本会话可恢复的呈现状态（§37.4：呈现状态可保存为偏好）
  if(uiRegistry)uiRegistry.current[sessionId]={tabs,activeTab,time,speed,view,layers,prediction,horizon,delivery,perspective,selected,reference,sourceRev,lastEvalId,follow,stations,maskDeg,perfVisible,buf,
   // 快照保存于生成中途时，恢复后不能永远显示“生成中…”：如实标记为已中断
   messages:messages.slice(-40).map(m=>m.streaming?{...m,streaming:false,interrupted:true,text:m.text||'（保存工作区快照时该回答仍在生成，已中断；以上为停止前模型已生成的真实输出）'}:m)};
 });
 useEffect(()=>{if(!toast)return;let h=setTimeout(()=>setToast(''),4500);return()=>clearTimeout(h)},[toast]);
 useEffect(()=>{chatEnd.current?.scrollIntoView({block:'end',behavior:'smooth'})},[messages]);
 useEffect(()=>{setTime(t=>Math.min(t,displayedScene.duration))},[displayedScene.duration]);
 useEffect(()=>{if(playing){let previous=performance.now();const h=setInterval(()=>{let now=performance.now(),dt=(now-previous)/1000;previous=now;setTime(t=>{const n=Math.min(displayedScene.duration,t+dt*speed);if(n>=displayedScene.duration)setPlaying(false);return n})},100);return()=>clearInterval(h)}},[playing,speed,displayedScene.duration]);
 // ---------- 编辑缓冲（§37.3 EditBuffer）：未保存内容不进入领域真相 ----------
 function editScene(fn,{skipValidate,label:lbl}={}){
  const cur=clone(displayedScene),next=fn(cur);
  if(!skipValidate){const v=validateScene(next);if(!v.ok){notify(v.error);return false;}}
  setBuf({scene:next,base:editingBase,dirty:true});return true;}
 function updateAsset(patch){return editScene(s=>({...s,assets:s.assets.map(a=>a.id===asset.id?{...a,...patch}:a)}));}
 function saveDraftAction(key,override){ // override：文件编辑器等入口直接提交场景，绕过滞后闭包
  const scene=override?override.scene:buf?.scene,base=override?override.base:buf?.base,dirty=override?true:!!(buf&&buf.dirty);
  if(!dirty)return{ok:true,text:'没有未保存的编辑；当前显示 head '+label(head)};
  const r=saveDraft(p,draftId,scene,base,{sessionId,key:key||`save:${sessionId}:${uid.current++}`});
  bump();
  if(!r.ok){if(r.code==='E_CONFLICT'){setConflict(r);notify('保存冲突：草稿已被其他会话前进');}else notify(r.error||'保存失败');
   return{ok:false,text:r.error||'保存失败'};}
  setBuf(null);
  const text=r.reused?'内容与已保存版本一致：复用回执 '+r.receipt.receipt_id:`已保存 ${label(r.revision_id)} · 回执 ${r.receipt.receipt_id}`;
  notify(text);return{ok:true,receipt:r.receipt,text};}
 function forkAction(source,sessionIdArg){
  const src=source||head;const r=forkDraft(p,src,{sessionId,key:`fork:${sessionId}:${uid.current++}`});
  bump();if(!r.ok)return{ok:false,text:r.error};
  const text=(r.reused?'复用分支 ':'已创建分支 ')+r.draft_id+'（来源 '+label(src)+'）';
  notify(text);return{ok:true,receipt:r.receipt,text};}
 function preflightAction(source){
  const rev=source||sourceRev||head;const r=preflight(p,rev);setPf({...r,source_revision:rev});openTab('experiments');
  const text=r.ok?`预检通过：${r.budget.runs} 个运行计划、${r.budget.total_samples} 个样本；未创建任何锁（来源 ${label(rev)}）`:'预检存在阻塞项：'+r.blocking.join('；');
  notify(r.ok?'预检完成':'预检存在阻塞项');return{ok:r.ok,text};}
 function freezeAction(source){
  const rev=source||sourceRev||head;const r=freezeExperiment(p,rev,{sessionId,key:`freeze:${rev}`});
  bump();if(!r.ok){notify(r.error);return{ok:false,text:r.error};}
  const text=r.reused?`复用已有锁 ${r.lock.lock_id}（来源 ${label(r.lock.source_revision_id)}；head 可能已前移，来源保持精确）`:`已冻结 ${r.lock.lock_id} · 来源 ${label(rev)} · ${r.lock.content_hash.slice(0,11)}`;
  notify('实验已冻结');return{ok:true,receipt:r.receipt,text};}
 function submitAction(lockId){
  const lock=lockId?Object.values(p.locks).find(l=>l.lock_id===lockId):listLocks(p).at(-1);
  if(!lock){const msg='还没有实验锁：先执行 冻结实验（预检通过后从精确来源版本生成）';notify(msg);return{ok:false,text:msg};}
  // 每次点击都是新的提交意图；网络重试在服务适配层用同一幂等键（此处由服务层按键去重）
  const r=submitBatch(p,lock.lock_id,{sessionId,key:`submit:${lock.lock_id}:${uid.current++}`});
  bump();if(!r.ok){notify(r.error);return{ok:false,text:r.error};}
  const text=r.reused?`复用作业 ${r.job.job_id}（同一锁的重复提交）`:`作业 ${r.job.job_id} 已受理：${r.job.plans.length} 个 RunPlan · 锁 ${lock.lock_id} · 来源 ${label(lock.source_revision_id)}`;
  notify('作业已提交');return{ok:true,receipt:r.receipt,text};}
 function jobControl(action,jobId){
  const id=(jobId||'').toUpperCase()||listJobs(p).at(-1)?.job_id;if(!id)return{ok:false,text:'没有作业'};
  const r=action==='pause'?pauseJob(p,id,{sessionId}):action==='resume'?resumeJob(p,id,{sessionId}):cancelJob(p,id,{sessionId});
  bump();if(!r.ok&&!r.status){notify(r.error);return{ok:false,text:r.error};}
  const text=action==='pause'?`作业 ${id}：PAUSING（计算边界后转 PAUSED） · control_revision=${r.control_revision}`:action==='resume'?`作业 ${id}：已继续 · control_revision=${r.control_revision}`:`作业 ${id}：${r.status==='already-terminal'?'已是终态 '+r.state+'，不再变化':'已请求取消，未完成槽位保留在总体中'}`;
  notify(text);return{ok:true,text};}
 function evaluateAction(jobId){
  const id=(jobId||'').toUpperCase()||listJobs(p).at(-1)?.job_id;const r=buildEvaluation(p,id);
  if(!r.ok){notify(r.error);return{ok:false,text:r.error};}
  setLastEvalId(r.evaluation.evaluation_id);openTab('replay',{binding:'replay:'+id,title:'回放 · '+id});bump();
  const text=`已固定评价 ${r.evaluation.evaluation_id}（来源快照 ${r.evaluation.source_snapshot.source_revision_id} · ${r.evaluation.source_snapshot.content_hash.slice(0,11)}）`;
  notify('评价已固定');return{ok:true,reused:r.reused,text};}
 function exportEvaluation(evalId){
  const ev=p.evaluations[(evalId||'').toUpperCase()]||lastEval;
  if(!ev){notify('还没有已固定的评价');return{ok:false,text:'没有已固定的评价'};}
  const payload={export_scope:'prototype-in-memory',exported_at_label:'session',evaluation:ev,lock:p.locks[ev.lock_id],job_summary:jobSummary(p.jobs[ev.job_id])};
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`evaluation-${ev.evaluation_id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  notify('已导出评价 JSON');return{ok:true,text:'已导出 '+ev.evaluation_id+'（scope：prototype-in-memory）'};}
 function restoreAction(source){
  const src=source;if(!src)return{ok:false,text:'请指定要恢复的版本，例如：恢复版本 r1'};
  const r=restoreRevision(p,draftId,src,{sessionId,key:`restore:${src}:${draft.head}`});
  bump();if(!r.ok){notify(r.error);return{ok:false,text:r.error};}
  const text=(r.reused?'内容未变化，复用回执 ':'已恢复为 ')+label(r.revision_id)+'（内容来自 '+label(src)+'；历史保留，不倒退）';
  notify('版本已恢复');return{ok:true,receipt:r.receipt,text};}
 function comparisonAction(a,b){
  if(!a||!b)return{ok:false,text:'请提供两个评价，例如：比较 E1 E2'};
  const r=createComparison(p,a,b,{sessionId,key:`cmp:${a}:${b}`});
  bump();if(!r.ok){notify(r.error);return{ok:false,text:r.error};}
  openTab('experiments');
  const text=r.reused?`复用比较 ${r.comparison.comparison_id}`:`已创建比较 ${r.comparison.comparison_id}：${r.comparison.rows.length} 个案例按 ID 对齐；${r.comparison.comparable?'共享运行模型与采样':'⚠ 运行因素不一致，比较结果不可直接归因'}`;
  notify('比较已创建');return{ok:true,receipt:r.receipt,text};}
 function newDraft(){
  const doIt=()=>{const made=createDraft(p,clone(DEFAULT_SCENE),{name:'新场景草稿',label:'从模板创建'});bump();
   if(!made.ok){notify(made.error);return;}
   session.draft_id=made.draft_id;setBuf(null);setSourceRev(null);setPf(null);bump();notify('已从模板创建 '+made.draft_id+'（r1）');};
  if(buf?.dirty){setGuard({what:'新建草稿',base:buf.base,run:()=>{setBuf(null);doIt();}});return;}
  doIt();}
 function requestArchive(id){
  if(!onArchiveSession)return;
  const doIt=()=>onArchiveSession(id);
  if(id===sessionId&&buf?.dirty){setGuard({what:'归档此会话会丢弃它的本地缓冲与对话记录',base:buf.base,run:doIt});return;}
  doIt();}
 function exportScene(){const url=URL.createObjectURL(new Blob([JSON.stringify(displayedScene,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='orbit-scene.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify(buf?.dirty?'已导出本地草稿预览 JSON（未保存）':'已导出当前场景 JSON');}
 function copyText(t){ // 非安全上下文（file:// 打开）时回退 execCommand
  const done=()=>notify('已复制到剪贴板');
  const fallback=()=>{const ta=document.createElement('textarea');ta.value=t;ta.style.cssText='position:fixed;opacity:0';document.body.appendChild(ta);ta.select();let ok=false;try{ok=document.execCommand('copy');}catch(e){}ta.remove();ok?done():notify('复制失败：浏览器拒绝了剪贴板访问');};
  if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(t).then(done,fallback);else fallback();}
 function exportChat(){ // 对话留存：真实消息（含模型推理元数据、工具调用与回执）导出为 Markdown
  const md=messages.map(m=>{
   if(m.role==='user')return'**用户**\n\n'+m.text;
   if(m.role==='system')return'*系统提示*\n\n'+m.text;
   if(m.role==='assistant')return`**助手**${m.model?' · '+m.model:''}${m.rounds?` · ${m.rounds} 轮工具`:''}${m.usage?` · tokens ${m.usage.total_tokens}`:''}\n\n${m.toolCalls&&m.toolCalls.length?'调用工具：'+m.toolCalls.map(c=>c.name).join('、')+'\n\n':''}${m.error?'（请求失败）\n':''}${m.text||''}`;
   return`**工具 ${m.name}**${m.ok?'（已执行）':'（未执行）'}${m.receipt?' · 回执 '+m.receipt.receipt_id:''} · ${m.time||''} UTC\n\n\`\`\`\n${m.text}\n\`\`\``;}).join('\n\n---\n\n');
  const url=URL.createObjectURL(new Blob([`# 对话导出 · ${session.name}\n\n${new Date().toLocaleString()} · 合成场景 · 圆轨道二体@0.1\n\n${md}\n`],{type:'text/markdown'})),a=document.createElement('a');a.href=url;a.download='conversation.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('已导出对话 Markdown（真实消息记录）');}
 function applyImported(next){const v=validateScene(next);if(!v.ok){notify(v.error);return false;}
  setBuf({scene:clone(next),base:head,dirty:true});notify('导入内容进入本地草稿缓冲；保存草稿后成为版本');return true;}
 async function importScene(e){const f=e.target.files?.[0];if(!f)return;if(f.size>1000000){notify('文件超过 1 MB 上限');return;}try{applyImported(JSON.parse(await f.text()));}catch{notify('文件不是有效的 JSON');}e.target.value='';}
 // ---------- 标签 binding（§37.2）：默认 (kind, binding) 聚焦已有；显式新建才第二份 ----------
 function openTab(kind,opts={}){
  setCollapsed(false);
  const dedupe=opts.binding||kind+':draft-head';
  const found=!opts.newInstance&&tabs.find(t=>t.dedupe===dedupe);
  if(found){setActiveTab(found.id);return found.id;}
  const id=`${kind}-${uid.current++}`;
  setTabs(v=>[...v,{id,kind,dedupe,title:opts.title}]);setActiveTab(id);return id;}
 function closeTab(id){
  const tab=tabs.find(t=>t.id===id);
  const really=()=>{const next=tabs.filter(t=>t.id!==id);setTabs(next);if(activeTab===id)setActiveTab(next.at(-1)?.id||null);};
  if(tab?.kind==='files'&&filesDirty){setGuard({what:'关闭文件标签会丢失未应用的文本编辑',base:editingBase,run:()=>{setFilesDirty(false);really();}});return;}
  really();}
 function changeView(v){setView(v);setLayers(l=>({...l,links:v==='comm',fov:v==='observation',prediction:v==='relative'||v==='global'}));openTab('orbit');}
 function switchDraft(nextDraftId,force){
  const doIt=()=>{session.draft_id=nextDraftId;setBuf(null);setSourceRev(null);setPf(null);bump();notify('已切换编辑目标到 '+nextDraftId);};
  if(!force&&buf?.dirty){setGuard({what:'切换编辑目标',base:buf.base,run:doIt});return;}
  doIt();}
 // ---------- 统一分发器：Agent 工具调用、快捷操作与控制台调用同一动作（§38.1） ----------
 function dispatchCommand(name,args,source='local'){
  const cmd={name,args:args||{}};let result,ok=true,receipt;
  try{switch(cmd.name){
   case'help':result='显示动作：显示相对轨迹 / 全局总览 / 通信几何 / 对地遥感、时间设为 900 秒、播放、暂停、倍速 30、选择 Echo-02、跟随、取消跟随、导出视角。\n对象：对象列表、星下点 [对象] [秒]（纬度/经度 + 光照状态）。\n测站：测站列表、添加测站（如“添加测站 北纬40 西经105”由模型处理）、过境、事件列表。\n光照：光照事件（卫星日出/日落 = 出影/进影时刻，二分精化）。\n草稿：高度设为 700 km（写本地缓冲）、保存草稿、新分支、恢复版本 r1。\n实验：预检、冻结实验、提交运行、任务、暂停作业 J1、继续作业 J1、取消作业 J1、固定评价 J1、回放 J1、结果、比较 E1 E2、导出评价 E1。\n审计：回执 rcp-1、回执列表。\n其他：校验场景、导出场景、打开终端、打开文件、status、ls、cat scene.json。';break;
   case'workspace.open':openTab(cmd.args.kind,source==='terminal'?{newInstance:true}:{});result=`已打开${TAB_INFO[cmd.args.kind][0]}工作区`;break;
   case'view.set':changeView(cmd.args.view);result=`已切换为${VIEWS[cmd.args.view]}（显示预设；不改仿真 frame 与运行）`;break;
   case'display.seek':if(cmd.args.seconds<0||cmd.args.seconds>displayedScene.duration)throw Error(`时间须在 0–${displayedScene.duration} 秒之间`);setTime(cmd.args.seconds);setPlaying(false);openTab('orbit');result=`显示游标已设为 ${formatTime(cmd.args.seconds)} UTC（T+${cmd.args.seconds}s）；display.seek 不推进任何计算`;break;
   case'display.play':setPlaying(cmd.args.playing);result=cmd.args.playing?'本地显示已开始播放（显示动作，无领域回执）':'本地显示已暂停';break;
   case'knowledge.set':setDelivery(cmd.args.delivery);openTab('orbit');result=cmd.args.delivery==='delayed'?'已采用 20 秒采样、60 秒交付延迟（演示知识投影）':'已采用 20 秒采样、即时交付';break;
   case'view.select':{const q=String(cmd.args.id||'').toLowerCase();const a=displayedScene.assets.find(a=>a.id===q||a.id===cmd.args.id||a.name.toLowerCase()===q);if(!a)throw Error(`没有对象 ${cmd.args.id}`);setSelected(a.id);openTab('orbit');result=`已选择 ${a.name}`;break;}
   case'view.follow':{const on=!!cmd.args.enabled;const target=cmd.args.id?displayedScene.assets.find(a=>a.id===cmd.args.id||a.name.toLowerCase()===String(cmd.args.id).toLowerCase()):null;if(on&&target)setSelected(target.id);setFollow(on);if(on)openTab('orbit');result=on?`跟随已开启：镜头追踪 ${(target?target.name:asset.name)} 的已交付样本位置（显示动作；样本按 20 秒步进更新）`:'跟随已关闭，镜头回到自由控制';break;}
   case'station.add':{const lat=+cmd.args.lat,lon=+cmd.args.lon;if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw Error('需要纬度 -90..90 与经度 -180..180（单位：度）');const st=addStation(lat,lon,cmd.args.name);result=`已添加 ${st.name}（纬度 ${lat}° · 经度 ${lon}°）；过境分析为显示层只读信息，不进入实验运行指纹`;break;}
   case'station.remove':{const st=stations.find(s=>s.id===cmd.args.id||s.name===cmd.args.id);if(!st)throw Error(`没有测站 ${cmd.args.id}；用 stations.list 查看现有测站`);setStations(v=>v.filter(s=>s.id!==st.id));result=`已移除测站 ${st.name}（${st.lat}°, ${st.lon}°）`;break;}
   case'stations.list':result=stations.length?stations.map(s=>`${s.id} · ${s.name} · 纬度 ${s.lat}° · 经度 ${s.lon}°`).join('\n'):'没有测站；开启测站面板的添加模式后点击地球，或调用 station.add（纬度, 经度）';break;
   case'passes.list':{const sts=cmd.args.station_id?stations.filter(s=>s.id===cmd.args.station_id||s.name===cmd.args.station_id):stations;if(!sts.length){ok=false;result='没有测站；先添加测站（station.add 或点击地球）';break;}
    const mask=Number.isFinite(+cmd.args.mask_deg)?Math.max(0,Math.min(80,+cmd.args.mask_deg)):maskDeg;
    const as=cmd.args.asset_id?displayedScene.assets.filter(a=>a.id===cmd.args.asset_id||a.name.toLowerCase()===String(cmd.args.asset_id).toLowerCase()):displayedScene.assets;
    const rows=[];for(const st of sts)for(const a of as)for(const w of passWindows(a,st,displayedScene.duration,mask,10))if(w.set>time)rows.push({...w,station:st.name,asset:a.name});
    rows.sort((x,y)=>x.rise-y.rise);
    result=rows.length?rows.slice(0,8).map(w=>`${w.station} ← ${w.asset}：升 ${formatTime(w.rise)} · 落 ${formatTime(w.set)} · 最大仰角 ${w.maxElevation}°`).join('\n')+`\n（掩蔽角 ${mask}°，步进 10 秒近似；显示层分析）`:`掩蔽角 ${mask}° 下当前时刻之后没有过境窗口（步进 10 秒近似）`;break;}
   case'passes.joint':{if(!stations.length){ok=false;result='没有测站；接力观测需要至少一个测站';break;}
    const mask=Number.isFinite(+cmd.args.mask_deg)?Math.max(0,Math.min(80,+cmd.args.mask_deg)):maskDeg;
    const as=cmd.args.asset_id?displayedScene.assets.filter(a=>a.id===cmd.args.asset_id||a.name.toLowerCase()===String(cmd.args.asset_id).toLowerCase()):displayedScene.assets;
    const rows=[];for(const a of as)for(const w of jointVisibility(a,stations,displayedScene.duration,mask,10))if(w.set>time)rows.push({...w,asset:a.name});
    rows.sort((x,y)=>x.rise-y.rise);
    result=rows.length?rows.slice(0,6).map(w=>`${w.asset}：${formatTime(w.rise)} – ${formatTime(w.set)} · ${w.coverage.map(c=>c.name).join('→')} · 最高 ${w.maxElevation}°`).join('\n')+`\n（任一站可见即覆盖；掩蔽角 ${mask}°，步进 10 秒近似）`:`掩蔽角 ${mask}° 下当前时刻之后没有联合覆盖窗口`;break;}
   case'events.list':{const evs=displayedScene.events;if(!evs.length){result='场景没有事件；可在场景页添加';break;}
    result=evs.map(e=>{const t0=eventTime(e),active=activeEvents(displayedScene,time,e.target).some(x=>x.id===e.id);return`${e.id} · ${e.target} · ${e.trigger==='seeded'?`种子 ${e.seed}`:'定时'} · ${formatTime(t0)} 起 ${e.duration}s${active?' · 进行中':' · 未活动'} · ${e.note}`;}).join('\n')+'\n（事件只改载荷可用性，不改变轨道）';break;}
   case'eclipse.list':{const as=cmd.args.asset_id?displayedScene.assets.filter(a=>a.id===cmd.args.asset_id||a.name.toLowerCase()===String(cmd.args.asset_id).toLowerCase()):displayedScene.assets;
    const rows=[];for(const a of as)for(const e of sunEvents(a,Date.parse(displayedScene.epoch),displayedScene.duration,30))if(e.t>time)rows.push({asset:a.name,...e});
    rows.sort((x,y)=>x.t-y.t);
    result=rows.length?rows.slice(0,8).map(e=>`${e.asset} ${e.kind==='sunrise'?'日出（出影）':'日落（进影）'} · ${formatTime(e.t)} UTC · T+${fmt(e.t,0)}s`).join('\n')+'\n（圆柱本影近似 · 边界二分精化到亚秒 · 显示层分析，不进入实验运行指纹）':'当前时刻之后场景内没有明暗交替事件';break;}
   case'view.capture':{const fn=captureRef.current;if(!fn)throw Error('三维视口尚未就绪，无法截取视角');const a=document.createElement('a');a.href=fn();a.download=`orbit-view-T${Math.floor(time)}s.png`;a.click();result='已导出当前视角 PNG（显示动作，无领域回执）';break;}
   case'assets.list':{result=displayedScene.assets.map(a=>{const p=stateAt(a,0).period;return`${a.id} · ${a.name} · 高度 ${a.altitude} km · 倾角 ${a.inclination}° · 升交点赤经 ${a.raan}° · 相位 ${a.phase}° · 周期 ${fmt(p/60)} min · 载荷 ${a.payloads.map(x=>`${x.name}(${x.kind}${x.enabled?'':'·已停用'})`).join('、')}`;}).join('\n')+`\n（共 ${displayedScene.assets.length} 个对象 · 合成场景 · 圆轨道二体@0.1）`;break;}
   case'subpoint.query':{const q=String(cmd.args.asset_id||'').toLowerCase();const a=q?displayedScene.assets.find(z=>z.id===q||z.id===cmd.args.asset_id||z.name.toLowerCase()===q):asset;
    if(!a)throw Error(`没有对象 ${cmd.args.asset_id}；可用 assets.list 查看全部对象`);
    const t=cmd.args.seconds==null?time:+cmd.args.seconds;
    if(!Number.isFinite(t)||t<0||t>displayedScene.duration)throw Error(`seconds 须在 0–${displayedScene.duration} 之间（当前显示时刻 ${Math.floor(time)}s）`);
    const g=groundPoint(stateAt(a,t).position,t),lit=!inEarthShadow(stateAt(a,t).position,sunDirectionECI(Date.parse(displayedScene.epoch)+t*1000));
    result=`${a.name} 星下点（T+${fmt(t,0)}s · ${formatTime(t)} UTC）：纬度 ${fmt(g.lat,2)}° · 经度 ${fmt(g.lon,2)}° · ${lit?'光照中':'地影内（圆柱本影近似）'}${t===time?'（当前显示时刻）':''}\n（ECI→地球固连系恒定自转约定 · 显示层分析，不进入实验运行指纹）`;break;}
   case'display.rate':{const sp=+cmd.args.speed;if(![1,10,30,60,120].includes(sp))throw Error('倍速只支持 1 / 10 / 30 / 60 / 120');setSpeed(sp);result=`显示倍速已设为 ${sp}×（显示动作：只改呈现速度，不推进计算；当前游标 T+${Math.floor(time)}s）`;break;}
   case'model.update':{const done=updateAsset({altitude:cmd.args.altitude});if(!done)throw Error('轨道高度须为 160–36000 km');openTab('models');result=`${asset.name} 高度 ${cmd.args.altitude} km 已写入本地草稿缓冲（未保存；执行 保存草稿 生成新版本）`;break;}
   case'draft.save':({receipt,text:result}=saveDraftAction(cmd.args.key));break;
   case'draft.fork':({receipt,text:result}=forkAction(cmd.args.source_revision));break;
   case'draft.restore':({receipt,text:result}=restoreAction(cmd.args.source_revision));break;
   case'comparison.create':({receipt,text:result}=comparisonAction(cmd.args.a,cmd.args.b));break;
   case'receipt.query':{const r=queryReceipt(p,cmd.args.receipt_id);if(!r){ok=false;result=`回执 ${cmd.args.receipt_id} 不存在`;break;}result=JSON.stringify(r,null,2);break;}
   case'receipts.list':{const rs=listReceipts(p,10);result=rs.length?rs.map(r=>`${r.receipt_id} · ${r.action} · ${r.status}${r.revision_id?' · '+label(r.revision_id):''}${r.lock_id?' · '+r.lock_id:''}${r.job_id?' · '+r.job_id:''}${r.session_id?' · '+r.session_id:''}`).join('\n'):'还没有回执；领域动作会生成可追溯回执';break;}
   case'experiment.preflight':({ok,text:result}=preflightAction(cmd.args.source_revision));break;
   case'experiment.freeze':({receipt,text:result}=freezeAction(cmd.args.source_revision));break;
   case'batch.submit':({receipt,text:result}=submitAction(cmd.args.lock_id));break;
   case'job.pause':case'job.resume':case'job.cancel':{const r=jobControl(cmd.name.split('.')[1],cmd.args.job_id);result=r.text;ok=r.ok;break;}
   case'jobs.list':{const js=listJobs(p);result=js.length?js.map(j=>{const s=jobSummary(j);return`${j.job_id} · ${JOB_STATE_LABEL[j.state]} · 槽位 ${s.done}/${s.planned} 完成${s.cancelled?` · ${s.cancelled} 取消`:''} · 锁 ${j.lock_id} · 来源 ${label(p.locks[j.lock_id]?.source_revision_id)}`;}).join('\n'):'没有作业；先 预检 → 冻结实验 → 提交运行';break;}
   case'evaluation.create':{const r=evaluateAction(cmd.args.job_id);result=r.text;ok=r.ok;break;}
   case'results.list':{const evs=listEvaluations(p);result=evs.length?evs.map(ev=>`${ev.evaluation_id} · 作业 ${ev.job_id} · 锁 ${ev.lock_id} · 来源 ${label(ev.source_snapshot.source_revision_id)} · ${ev.metrics.length} 个样本`).join('\n'):'没有已固定的评价；完成的作业执行 固定评价 J1';break;}
   case'artifact.export':{const r=exportEvaluation(cmd.args.evaluation_id);result=r.text;ok=r.ok;break;}
   case'replay.open':{const id=(cmd.args.job_id||'').toUpperCase();const ev=Object.values(p.evaluations).find(e=>e.job_id===id);if(!ev){result=`作业 ${id} 还没有固定评价；回放标签将显示 unavailable，不会回退到当前草稿`;}openTab('replay',{binding:'replay:'+id,title:'回放 · '+id});result=result||`已打开绑定 ${id} 的回放标签`;break;}
   case'scene.validate':{const v=validateScene(displayedScene);if(!v.ok)throw Error(v.error);result=`Schema 与引用校验通过：${displayedScene.assets.length} 个对象、${displayedScene.events.length} 个事件${buf?.dirty?'（本地草稿预览，未保存）':''}`;break;}
   case'scene.export':exportScene();result='已创建当前显示场景的 JSON 下载';break;
   case'status':result=JSON.stringify({project:p.name,session:session.name,draft:draftId,head:label(head),buffer:buf?.dirty?`dirty base ${label(buf.base)}`:'clean',source_revision:sourceRev?label(sourceRev):'head',evaluations:listEvaluations(p).length,jobs:listJobs(p).length,time_seconds:+time.toFixed(1),playing,view,selected,delivery,model:'circular-two-body@0.1',protocol:'prototype-in-memory'},null,2);break;
   case'files.list':result='scene.json\ntools.json\nREADME.md';break;
   case'files.read':result=cmd.args.path==='scene.json'?(buf?.dirty?'# 本地草稿预览（未保存；保存草稿后成为版本）\n':'')+JSON.stringify(displayedScene,null,2):cmd.args.path==='tools.json'?JSON.stringify(TOOL_CATALOG,null,2):README;break;
   case'clear':result='';break;
   default:ok=false;result=source==='agent'?`未知工具 ${cmd.name}：不在本工作台的工具目录中`:'这条输入未匹配到本地工具；自然语言提问会交给 DeepSeek 模型处理，或输入“帮助”查看命令。';}}catch(e){ok=false;result=e.message;}
  return{name:cmd.name,args:cmd.args,text:result,ok,receipt};}
 function execute(raw,source='terminal'){
  const cmd=typeof raw==='string'?parseCommand(raw):raw;if(!cmd)return'';
  return dispatchCommand(cmd.name,cmd.args,source).text;}
 function pushMsg(m){msgRef.current=[...msgRef.current,m];setMessages(msgRef.current);return m;}
 function patchMsg(id,fn){msgRef.current=msgRef.current.map(m=>m.id===id?fn(m):m);setMessages(msgRef.current);}
 function runQuick(name,args){ // 快捷操作：真实工具直接执行（不经模型），如实记录
  const out=dispatchCommand(name,args,'quick');
  pushMsg({id:uid.current++,role:'tool',name:out.name,args:out.args,text:out.text,ok:out.ok,time:formatTime(time),receipt:out.receipt,execution:'local-shortcut'});
  bump(); // 对话记录随快照保存：纯聊天/快捷操作没有领域动作，需显式触发一次快照保存
 }
 function agentContext(){return{project:p.name,session:session.name,draft:label(draftId),head:label(head),
  buffer:buf&&buf.dirty?`基于 ${label(buf.base)} 的未保存编辑`:'',
  scene:`${headScene.name}（${headScene.assets.map(a=>`${a.name}/${a.id}: 高度 ${a.altitude} km、倾角 ${a.inclination}°`).join('；')}；时长 ${headScene.duration}s；${headScene.events.length} 个可用性事件）`,
  time:Math.floor(time),view:VIEWS[view]||view,selected:asset?`${asset.name}(${asset.id})`:'—',playing,
  map2d:!!layers.map2d,
  delivery:delivery==='delayed'?'延迟 60 秒':'即时',
  jobs:listJobs(p).length?listJobs(p).map(j=>`${j.job_id}=${jobSummary(j).state}`).join('、'):'无',
  evaluations:listEvaluations(p).length?listEvaluations(p).map(ev=>ev.evaluation_id).join('、'):'无'};}
 function agentExecuteTool(name,args,callId){ // 模型请求的工具调用：走同一分发器真实执行并记录回执
  const out=(dispatchRef.current||dispatchCommand)(name,args,'agent');
  pushMsg({id:uid.current++,role:'tool',toolCallId:callId,name:out.name,args:out.args,text:out.text,ok:out.ok,time:formatTime(time),receipt:out.receipt,execution:'deepseek-tool-call'});
  return out;}
 async function agentTurn(text){
  if(busyRef.current)return;busyRef.current=true;setLlmBusy(true);
  pushMsg({id:uid.current++,role:'user',text});setInput('');
  const aid=uid.current++,currentId={id:aid};
  pushMsg({id:aid,role:'assistant',text:'',reasoning:'',model:llmConfig.model,streaming:true});
  const ac=new AbortController();llmAbort.current=ac;
  let pending={text:'',reasoning:''},raf=0;
  const flush=()=>{raf=0;if(!pending.text&&!pending.reasoning)return;
   patchMsg(currentId.id,m=>({...m,text:m.text+pending.text,reasoning:m.reasoning+pending.reasoning}));pending={text:'',reasoning:''};};
  const schedule=()=>{if(raf)return;if(typeof requestAnimationFrame==='function')raf=requestAnimationFrame(flush);else flush();};
  const onEvent=ev=>{
   if(ev.type==='text')pending.text+=ev.text;
   else if(ev.type==='reasoning')pending.reasoning+=ev.text;
   else if(ev.type==='tool_calls'){flush();patchMsg(currentId.id,m=>({...m,streaming:false,toolCalls:ev.calls.map(c=>({id:c.id,name:c.name,args:c.arguments}))}));}
   else if(ev.type==='round_start'){flush();patchMsg(currentId.id,m=>({...m,streaming:false}));
    const nid=uid.current++;pushMsg({id:nid,role:'assistant',text:'',reasoning:'',model:llmConfig.model,streaming:true,round:ev.round});currentId.id=nid;}
  };
  try{
   const history=toApiMessages(msgRef.current.filter(m=>m.id!==aid));
   const res=await runAgentTurn({config:llmConfig,systemPrompt:buildSystemPrompt(agentContext()),apiMessages:history,executeTool:agentExecuteTool,signal:ac.signal,onEvent});
   flush();
   patchMsg(currentId.id,m=>({...m,streaming:false,usage:res.usage,rounds:res.rounds}));
  }catch(e){
   flush();
   const note=e&&e.name==='AbortError'?'（已停止：以上为停止前模型已生成的真实输出）':'请求失败：'+(e&&e.message||e);
   patchMsg(currentId.id,m=>({...m,streaming:false,error:!(e&&e.name==='AbortError'),text:m.text?m.text+'\n\n'+note:note}));
  }finally{busyRef.current=false;setLlmBusy(false);llmAbort.current=null;bump();} // 对话完成后触发快照保存（纯对话没有领域动作，不 bump 会丢对话记录）
 }
 const cfgDraft=llmCfg||{model:llmConfig.model,effort:llmConfig.effort,baseUrl:llmConfig.baseUrl};
 function saveLlmSettings(){setLlmConfig({...cfgDraft,apiKey:keyDraft.trim()||llmConfig.apiKey});notify('模型连接设置已保存');}
 async function testLlm(){setConnTest({busy:true});try{const r=await testConnection({...cfgDraft,apiKey:keyDraft.trim()||llmConfig.apiKey});setConnTest({ok:true,latencyMs:r.latencyMs,content:r.content});}catch(e){setConnTest({ok:false,error:e&&e.message||String(e)});}}
 function resizeDown(e){e.preventDefault();const startX=e.clientX,startW=width,bounds=shell.current.getBoundingClientRect();const move=ev=>setWidth(Math.min(78,Math.max(40,startW+(startX-ev.clientX)/bounds.width*100)));const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);}
 const revisions=Object.values(draft.revisions);
 const shared={scene:displayedScene,time,setTime,playing,setPlaying,speed,setSpeed,selected,setSelected,reference,setReference,asset,view,changeView,layers,setLayers,prediction,setPrediction,horizon,setHorizon,delivery,setDelivery,perspective,setPerspective,follow,setFollow,stations,setStations,stationArm,setStationArm,addStation,captureRef,maskDeg,setMaskDeg,perfVisible,setPerfVisible,updateAsset,exportScene,notify,execute,resetKey,setResetKey,inspector,setInspector,objectsOpen,setObjectsOpen,previewTag:buf?.dirty?'本地草稿预览 · 未保存':'草稿预览 · '+label(head),refMissing:!displayedScene.assets.some(a=>a.id===reference)};
 return <div hidden={!activeSession} className={'app '+(maximized?'maximized':'')+(!sidebar?' sidebar-hidden':'')}>
 {!maximized&&sidebar&&<aside className="sidebar"><div className="brand"><span className="brand-mark"><Orbit size={19}/></span><span>Orbit Agent</span><IconButton icon={PanelLeftClose} label="折叠项目栏" onClick={()=>setSidebar(false)}/></div><button className="new-session" onClick={onNewSession}><Plus size={16}/>新会话<span>＋</span></button><div className="sidebar-caption">项目</div><button className="project-row" onClick={()=>setProjectsFold(v=>!v)}>{projectsFold?<ChevronRight size={13}/>:<ChevronDown size={13}/>}<FolderOpen size={16}/><span>{p.name}</span></button>
  {!projectsFold&&<div className="draft-list">{Object.values(p.drafts).map(d=><button key={d.draft_id} className={'draft-row '+(d.draft_id===draftId?'active':'')} title={d.draft_id===draftId?'当前编辑目标':'切换此会话的编辑目标'} onClick={()=>switchDraft(d.draft_id)}><FileJson size={13}/><span>{d.name}</span><small>{label(d.head)}</small></button>)}<button className="draft-row draft-new" onClick={newDraft} title="从默认模板创建新草稿"><Plus size={13}/><span>从模板新建草稿</span></button></div>}
  <div className="sidebar-caption">会话</div>
  {sessionItems.map(item=><div key={item} className="session-item"><button className={"session-row "+(item===sessionId?"active":"")} onClick={()=>onSessionSwitch(item)}><MessageSquare size={14}/><span>{p.sessions[item]?.name||item}</span></button>{sessionItems.length>1&&<button className="session-archive" aria-label={`归档会话 ${p.sessions[item]?.name||item}`} title="归档会话（作业继续存在）" onClick={()=>requestArchive(item)}><X size={11}/></button>}</div>)}
  <div className="project-path">浏览器内存 · prototype-in-memory</div><div className="sidebar-footer"><span className="avatar">O</span><div>本地工作区<small>合成数据 · DeepSeek 官方 API 已连接</small></div><IconButton icon={Info} label="关于与实现边界" onClick={()=>openSettings()}/></div></aside>}
 <main className="main-shell" ref={shell}>
 {!maximized&&<section className={'chat-panel '+(collapsed?'full':'')} style={!collapsed?{width:`${100-width}%`}:{}}><header className="chat-header">{!sidebar&&<IconButton icon={PanelLeftOpen} label="展开项目栏" onClick={()=>setSidebar(true)}/>}<span>{sessionName}</span><div className="header-actions"><IconButton icon={Download} label="导出对话为 Markdown" onClick={exportChat}/><IconButton icon={Settings2} label="工具与能力" onClick={()=>openSettings()}/>{collapsed&&<IconButton icon={PanelRightOpen} label="展开工作区" onClick={()=>setCollapsed(false)}/>}</div></header><div className="conversation"><div className="session-intro"><div className="intro-orbit"><Orbit size={25}/></div><h1>从一个问题，进入仿真</h1><p>对话调度工具，工作区呈现结果</p></div>{messages.map(m=>m.role==='user'?<div className="user-message" key={m.id}>{m.text}</div>:m.role==='system'?<div className="assistant-message" key={m.id}><span className="assistant-logo"><Orbit size={16}/></span><p>{m.text}</p></div>:m.role==='assistant'?<div className={'assistant-message llm'+(m.error?' llm-error':'')} key={m.id}><span className="assistant-logo"><Orbit size={16}/></span><div className="assistant-body">{m.reasoning?<details className="reasoning" open={!!m.streaming&&!m.text}><summary>思考过程 · 模型真实推理输出</summary><pre>{m.reasoning}</pre></details>:null}{m.toolCalls&&m.toolCalls.length?<div className="tool-chips">{m.toolCalls.map(c=><span key={c.id} className="tool-chip" title={'真实工具调用 · 参数 '+(typeof c.args==='string'?c.args:JSON.stringify(c.args))}><Wrench size={11}/>{c.name}</span>)}</div>:null}{m.text?<div className={'md-body'+(m.streaming?' streaming':'')}>{renderMarkdown(m.text)}</div>:m.streaming?<p className="streaming pending">正在请求 DeepSeek 官方 API…</p>:null}<div className="msg-meta-row"><small className="msg-meta">{[m.model,m.rounds?`${m.rounds} 轮工具`:'',m.usage?`tokens ${m.usage.total_tokens}`:'',m.streaming?'生成中…':'',m.interrupted?'已中断':'',m.error?'失败':''].filter(Boolean).join(' · ')}</small>{!m.streaming&&m.text&&<button className="msg-copy" onClick={()=>copyText(m.text)} title="复制这条回答"><Copy size={11}/>复制</button>}</div></div></div>:<div className="tool-message" key={m.id}><div className="tool-heading">{m.ok?<CheckCircle2 size={15}/>:<AlertCircle size={15}/>}<span>{m.name}</span><small>{m.ok?(m.receipt?'已执行 · '+m.receipt.receipt_id:'已执行'):'未执行'}</small></div><p>{m.text}</p><details><summary>工具调用</summary><pre>{JSON.stringify({tool:m.name,arguments:m.args,simulation_time:m.time,receipt:m.receipt||null,execution:m.execution||'local-deterministic'},null,2)}</pre></details></div>)}<div ref={chatEnd}/></div><div className="composer-area"><div className="suggestions"><button onClick={()=>runQuick('view.set',{view:'relative'})}><Orbit size={13}/>相对轨迹</button><button onClick={()=>runQuick('experiment.preflight',{})}><ShieldCheck size={13}/>预检</button><button onClick={()=>runQuick('draft.save',{})}><Save size={13}/>保存草稿</button><button onClick={()=>runQuick('workspace.open',{kind:'terminal'})}><Terminal size={13}/>终端</button></div><form className="composer" onSubmit={e=>{e.preventDefault();if(!llmBusy&&input.trim())agentTurn(input)}}><textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(!llmBusy&&input.trim())agentTurn(input)}}} placeholder={llmBusy?'模型正在通过真实 API 处理…':'向 DeepSeek 提问，例如：把时间设到 900 秒，然后总结当前实验状态'} aria-label="Agent 输入" rows={2}/><div className="composer-bottom"><button type="button" className="mode-label" onClick={()=>openSettings()}><Command size={13}/>DeepSeek · {llmConfig.model}<ChevronDown size={12}/></button>{llmBusy?<button type="button" className="send-button stop" onClick={()=>llmAbort.current&&llmAbort.current.abort()} aria-label="停止生成"><Square size={15}/></button>:<button type="submit" className="send-button" disabled={!input.trim()} aria-label="发送给模型"><ArrowUp size={17}/></button>}</div></form><div className="composer-note">真实 LLM · {llmConfig.model} 经 DeepSeek 官方 API 流式连接 · 工具经统一提交链（CAS · 幂等 · 回执）</div></div></section>}
 {<>{!maximized&&!collapsed&&<div className="resize-handle" role="separator" aria-label="调整工作区宽度" aria-orientation="vertical" aria-valuenow={width} tabIndex={0} onPointerDown={resizeDown} onKeyDown={e=>{if(e.key==='ArrowLeft')setWidth(w=>Math.min(78,w+3));if(e.key==='ArrowRight')setWidth(w=>Math.max(40,w-3));}}/>}
 <section className="workspace" hidden={collapsed} style={maximized?{width:'100%'}:{width:`${width}%`}}>
 <div className="context-bar" aria-label="当前上下文"><span><FolderOpen size={12}/>{p.name}</span><span><MessageSquare size={12}/>{session.name}</span><span><FileJson size={12}/>草稿 {draftId} · head {label(head)}</span>{buf?.dirty&&<span className="ctx-dirty"><AlertCircle size={12}/>本地缓冲 · 基于 {label(buf.base)}</span>}{conflict&&<span className="ctx-dirty">冲突待处理</span>}<span><History size={12}/>结果 {lastEval?lastEval.evaluation_id+' · '+label(lastEval.source_snapshot.source_revision_id):'—'}</span><span>视角 {perspective} · 演示</span></div>
 <header className="workspace-tabs"><div className="tabs-scroll">{tabs.map(t=>{const [name,I]=TAB_INFO[t.kind];return <div key={t.id} className={'workspace-tab '+(t.id===activeTab?'active':'')}><button onClick={()=>setActiveTab(t.id)}><I size={14}/>{t.title||name}</button><button className="close-tab" aria-label={`关闭${t.title||name}`} onClick={()=>closeTab(t.id)}><X size={12}/></button></div>})}</div><div className="workspace-actions"><div className="add-menu-wrap"><IconButton icon={Plus} label="新建工作区标签" onClick={()=>setAddOpen(v=>!v)}/>{addOpen&&<div className="add-menu">{Object.entries(TAB_INFO).map(([kind,[name,I]])=><button key={kind} onClick={()=>{openTab(kind,{newInstance:true,binding:kind==='replay'?'replay:none':kind+':new-'+uid.current++,title:kind==='replay'?'回放 · 未绑定':undefined});setAddOpen(false)}}><I size={15}/>{name}</button>)}</div>}</div><IconButton icon={maximized?Minimize2:Maximize2} label={maximized?'还原工作区':'最大化工作区'} onClick={()=>setMaximized(v=>!v)}/><IconButton icon={PanelRightClose} label="折叠工作区" onClick={()=>{setCollapsed(true);setMaximized(false)}}/></div></header>
 <div className="workspace-body">{!current?<div className="empty-workspace"><Plus size={25}/><h2>打开一个工作区</h2><p>三维仿真、终端、浏览器和文件，使用同一组工具与对象上下文</p><button className="primary" onClick={()=>openTab('orbit')}>打开三维视图</button></div>:tabs.map(t=><div key={t.id} className="tab-pane" hidden={t.id!==activeTab}>{t.kind==='orbit'?<OrbitPanel {...shared}/>:t.kind==='scenario'?<ScenarioPanel {...shared} editScene={editScene} draft={draft} head={head} revisions={revisions} restoreAction={restoreAction} onImport={()=>upload.current.click()}/>:t.kind==='models'?<ModelsPanel {...shared} editScene={editScene}/>:t.kind==='experiments'?<ExperimentsPanel p={p} bump={bump} draft={draft} head={head} revisions={revisions} sourceRev={sourceRev} setSourceRev={setSourceRev} pf={pf} setPf={setPf} notify={notify} openTab={openTab} actions={{preflightAction,freezeAction,submitAction,jobControl,evaluateAction,exportEvaluation,forkAction,comparisonAction}}/>:t.kind==='replay'?<ReplayPanel p={p} jobId={t.dedupe?.split(':')[1]} delivery={delivery} notify={notify}/>:t.kind==='terminal'?<TerminalPanel key={t.id} execute={execute}/>:t.kind==='files'?<FilesPanel key={t.id} p={p} draft={draft} head={head} displayedScene={displayedScene} buf={buf} editingBase={editingBase} saveDraftAction={saveDraftAction} exportScene={exportScene} onDirty={setFilesDirty} notify={notify}/>:<BrowserPanel key={t.id}/>}</div>)}</div>
 <footer className="workspace-status"><span><span className="tiny-dot"/>本地仿真</span><span>{listJobs(p).filter(j=>!['completed','cancelled','failed'].includes(j.state)).length?`作业 ${listJobs(p).filter(j=>!['completed','cancelled','failed'].includes(j.state)).map(j=>j.job_id).join(' ')} 进行中`:'无进行中作业'}</span><span className="status-spacer"/><span>{asset.name}</span><span>T+{Math.floor(time)}s</span></footer></section></>}
 {collapsed&&maximized===false&&<button className="collapsed-workspace-tab" onClick={()=>setCollapsed(false)}><PanelRightOpen size={17}/><span>工作区</span></button>}</main>
 <input ref={upload} type="file" accept=".json,application/json" hidden onChange={importScene}/>
 {toast&&<div role="status" className="toast"><Check size={16}/>{toast}</div>}
 {guard&&<GuardDialog guard={guard} onClose={()=>setGuard(null)} onDiscard={()=>{const run=guard.run;setBuf(null);setGuard(null);run();}} onSave={()=>{const run=guard.run;const r=saveDraftAction();if(r.ok){setGuard(null);run();}}}/>}
 {conflict&&<ConflictDialog conflict={conflict} onClose={()=>setConflict(null)}
  onMerge={()=>{const m=threeWayMerge(conflict.base_scene,conflict.local_scene,conflict.current_scene);if(!m.ok){notify('自动合并失败：'+m.conflicts[0]);return;}setBuf({scene:m.scene,base:conflict.head,dirty:true});setConflict(null);notify('合并结果已进入缓冲（基于 '+label(conflict.head)+'），检查后保存');}}
  onFork={()=>{const made=createDraft(p,conflict.local_scene,{name:displayedScene.name+'（分支）',source_revision_id:conflict.base,label:'从冲突缓冲创建'});bump();if(made.ok){setConflict(null);setBuf(null);switchDraft(made.draft_id,true);}else notify(made.error);}}
  onDiscard={()=>{setBuf(null);setConflict(null);notify('已放弃本地缓冲，显示当前 head');}}/>}
 {settingsOpen&&<Modal title="工具与实现边界" onClose={()=>setSettingsOpen(false)} wide>
  <p>这是可以运行的前端工作台。所有场景数据均为合成数据；领域动作经由统一提交链（ChangeSet 摘要 → CAS → 幂等键 → 回执），显示动作只改呈现状态。</p>
  <dl><dt>对象与状态</dt><dd>Project / WorkSession / DraftRevision / ExperimentLock / BatchJob / Evaluation 在内存中分离；会话只持有草稿引用，不隐式克隆场景；运行结果冻结于锁与来源版本</dd><dt>工作区快照</dt><dd>{snapshotInfo?.restored?`已从浏览器 localStorage 恢复${snapshotInfo.normalized.length?`（${snapshotInfo.normalized.length} 个中断作业规范化为已暂停，等待显式继续）`:''}${snapshotInfo.savedAt?' · 保存于 '+new Date(snapshotInfo.savedAt).toLocaleString():''}`:'自动保存到浏览器 localStorage（§37.4 原型）；仅含合成数据与呈现偏好，不含凭据或权限令牌。刷新后恢复，中断的作业不会自动重跑。'}</dd><dt>已实现</dt><dd>Three.js 场景（真实太阳方位光照、地影标记与日出/日落时刻、星下点轨迹、跟随镜头、速度矢量）、圆轨道传播、统一显示时间、草稿版本与 CAS 冲突合并、预检/冻结/批量作业/固定评价、作业暂停恢复取消、回放绑定、结果比较、版本恢复、JSON 校验导入导出</dd><dt>模型接入</dt><dd>DeepSeek 官方 API 真实流式连接（{llmConfig.model}）：模型提出工具调用，经统一提交链真实执行；对话、工具结果与连通性测试均无模拟回退</dd><dt>未连接</dt><dd>真实 PTY、操作系统文件、MCP 服务与权限后端。前端研究组视角不提供安全隔离；快照保存失败时静默降级为内存工作区</dd><dt>动力学</dt><dd>球形地球、圆轨道解析二体模型；无 J2、阻力、太阳/月球摄动或机动；ECI 示意坐标</dd><dt>测量与预测</dt><dd>20 秒采样；可选 60 秒交付延迟；无噪声或协方差。通信仅球体遮挡几何；遥感仅天底圆锥足迹</dd><dt>参考</dt><dd><a href="https://www.kimi.com/code/docs/en/kimi-code-desktop/interface-and-sessions.html" target="_blank" rel="noreferrer">Kimi Code Desktop</a> · <a href="https://threejs.org" target="_blank" rel="noreferrer">Three.js</a> · <a href="https://svs.gsfc.nasa.gov/2915" target="_blank" rel="noreferrer">NASA Blue Marble</a></dd></dl><details><summary>统一工具目录 · 可替换运行时适配器</summary><pre>{JSON.stringify(TOOL_CATALOG,null,2)}</pre></details>
  <div className="llm-settings"><h3>模型连接 · DeepSeek 官方 API</h3><div className="form-grid"><label>模型 ID<input value={cfgDraft.model} onChange={e=>setLlmCfg({...cfgDraft,model:e.target.value})}/></label><label>推理力度（effort）<select value={cfgDraft.effort} onChange={e=>setLlmCfg({...cfgDraft,effort:e.target.value})}>{EFFORT_LEVELS.map(l=><option key={l} value={l}>{l}</option>)}</select></label><label>API Base URL<input value={cfgDraft.baseUrl} onChange={e=>setLlmCfg({...cfgDraft,baseUrl:e.target.value})}/></label><label>API Key{llmConfig.builtinKey?'（构建时已从 keys.txt 注入）':''}<input type="password" placeholder={llmConfig.builtinKey?'已内置 keys.txt 密钥':'sk-…'} value={keyDraft} onChange={e=>setKeyDraft(e.target.value)}/></label></div><div className="action-row"><button className="primary" onClick={saveLlmSettings}>保存连接设置</button><button onClick={testLlm} disabled={!!(connTest&&connTest.busy)}>{connTest&&connTest.busy?'请求中…':'测试连接（真实请求）'}</button>{connTest&&!connTest.busy&&(connTest.ok?<small className="conn-ok"><CheckCircle2 size={14}/>连通：{connTest.latencyMs} ms · 模型回复“{connTest.content}”</small>:<small className="conn-bad"><AlertCircle size={14}/>{connTest.error}</small>)}</div><small className="muted">对话与测试都直接请求官方 API，无代理、无模拟回退；密钥在构建时从 keys.txt 读取，可在此覆盖。</small></div>
  <div className="dialog-actions"><button onClick={()=>{try{localStorage.removeItem(SNAPSHOT_KEY)}catch(e){};location.reload();}}><RotateCcw size={14}/>清除快照并重置工作区</button></div></Modal>}</div>;}
function OrbitPanel(p){const{scene,time,setTime,playing,setPlaying,speed,setSpeed,asset,selected,setSelected,reference,setReference,view,changeView,layers,setLayers,prediction,setPrediction,horizon,setHorizon,delivery,setDelivery,perspective,setPerspective,follow,setFollow,stations,setStations,stationArm,setStationArm,addStation,captureRef,maskDeg,setMaskDeg,perfVisible,setPerfVisible,resetKey,setResetKey,inspector,setInspector,objectsOpen,setObjectsOpen,previewTag,refMissing}=p;
 const[table,setTable]=useState(false),[layerMenu,setLayerMenu]=useState(false),[stationsOpen,setStationsOpen]=useState(false);
 const sample=observedTime(time,delivery),available=observationAvailable(time,delivery),s=stateAt(asset,sample),geo=groundPoint(s.position,sample),sunDir=sunDirectionECI(Date.parse(scene.epoch)),inShadow=inEarthShadow(s.position,sunDir),ref=scene.assets.find(a=>a.id===reference)||scene.assets[0],rel=rtn(sub(s.position,stateAt(ref,sample).position),stateAt(ref,sample));
 const passes=useMemo(()=>{const rows=[];for(const st of stations)for(const a of scene.assets)for(const w of passWindows(a,st,scene.duration,maskDeg,10))if(w.set>time)rows.push({...w,station:st.name,asset:a.name});rows.sort((x,y)=>x.rise-y.rise);return rows.slice(0,8);},[stations,scene,maskDeg,Math.floor(time/30)]); // 过境窗口每 30 显示秒或掩蔽角变化时重算
 const jointPasses=useMemo(()=>{const rows=[];for(const a of scene.assets)for(const w of jointVisibility(a,stations,scene.duration,maskDeg,10))if(w.set>time)rows.push({...w,asset:a.name});rows.sort((x,y)=>x.rise-y.rise);return rows.slice(0,6);},[stations,scene,maskDeg,Math.floor(time/30)]);
 const sunEvts=useMemo(()=>sunEvents(asset,Date.parse(scene.epoch),scene.duration,30),[asset,scene.duration]); // 日出/日落：步进扫描定位 + 二分精化边界
 const nextLight=sunEvts.find(e=>e.t>time);
 return <div className="orbit-panel"><div className="orbit-toolbar"><button className="toolbar-label" onClick={()=>setObjectsOpen(v=>!v)}><Satellite size={15}/><span>对象</span><ChevronDown size={12}/></button><div className="view-select"><select aria-label="分析视图" value={view} onChange={e=>changeView(e.target.value)}>{Object.entries(VIEWS).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></div><span className="preview-tag">{previewTag}</span><span className="toolbar-spacer"/><IconButton icon={Layers} label="分析图层" active={layerMenu} onClick={()=>setLayerMenu(v=>!v)}/><IconButton icon={MapIcon} label={layers.map2d?'关闭 2D 地面轨迹图':'打开 2D 地面轨迹图（等距圆柱投影 · 晨昏线）'} active={layers.map2d} onClick={()=>setLayers(l=>({...l,map2d:!l.map2d}))}/><IconButton icon={MapPin} label="地面测站与过境" active={stationsOpen} onClick={()=>setStationsOpen(v=>!v)}/><IconButton icon={FileJson} label="数值表" active={table} onClick={()=>setTable(v=>!v)}/><IconButton icon={Activity} label="性能自检（FPS/绘制调用）" active={perfVisible} onClick={()=>setPerfVisible(v=>!v)}/><IconButton icon={Settings2} label="显示检查器" active={inspector} onClick={()=>setInspector(v=>!v)}/></div>
 <div className="canvas-area"><OrbitViewport {...p} onAddStation={addStation} onSelect={setSelected}/><div className="viewport-context"><span>{view==='relative'?(refMissing?'参考体不可用 · 已按首个对象显示':'RTN · '+ref.name):'ECI · 地心'}</span><span>{view==='relative'?'坐标 km · 显示比例 0.015':'距离 km · 地球 R 6,371'}</span><span>样本 {available?formatTime(sample):'等待首次交付'} UTC</span><span>DRAFT 预览 · 非运行投影</span></div><div className="viewport-title"><span>01 / {VIEWS[view]}</span><strong>{scene.name}</strong></div><div className="viewport-controls"><IconButton icon={Home} label="重置镜头" onClick={()=>setResetKey(v=>v+1)}/><IconButton icon={Radar} label={follow?'关闭跟随（镜头追踪选中对象）':'跟随选中对象（显示动作）'} active={follow} onClick={()=>{setFollow(v=>!v);if(!follow)setResetKey(k=>k+1)}}/><IconButton icon={Crosshair} label="聚焦选中对象的相对视图" onClick={()=>{setReference(selected);changeView('relative');setResetKey(v=>v+1)}}/><IconButton icon={Camera} label="导出当前视角 PNG" onClick={()=>{const fn=captureRef&&captureRef.current;if(!fn){notify('三维视口尚未就绪');return;}const a=document.createElement('a');a.href=fn();a.download=`orbit-view-T${Math.floor(time)}s.png`;a.click();notify('已导出当前视角 PNG');}}/></div><div className="viewport-legend"><span><i className="solid-line"/>已交付样本的轨道</span><span><i className="dashed-line"/>模型预测</span><span><i className="ground-dot"/>星下点轨迹 · 昼色/夜灰</span><span><i className="event-arc"/>事件不可用弧段</span><span><i className="light-mark"/>日出/日落标记</span><span>测站连线 · 仰角≥掩蔽角</span><span>2D 地图 · 轨迹/晨昏线/直下点</span><span>航天器尺寸已放大</span></div><div className="earth-credit">Three.js · NASA Blue Marble 静态表面影像</div>
 {objectsOpen&&<div className="object-tree floating-panel"><header>场景对象 <small>{scene.assets.length}</small></header>{scene.assets.map(a=><div key={a.id}><button className={selected===a.id?'selected':''} onClick={()=>setSelected(a.id)}><span className="shape-dot" style={{borderColor:a.color}}/><span>{a.name}</span><ChevronDown size={12}/></button>{selected===a.id&&<div className="tree-children"><span><Box size={12}/>平台 · 圆轨道</span>{a.payloads.map(x=><span key={x.id}>{x.kind==='camera'?<Camera size={12}/>:<Radio size={12}/>} {x.name}</span>)}</div>}</div>)}<label>相对参考体<select value={reference} onChange={e=>setReference(e.target.value)}>{scene.assets.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label></div>}
 {layerMenu&&<div className="layer-menu floating-panel"><header>分析图层</header>{[['orbits','轨道历史','过去一圈，180 段采样'],['prediction','被动预测','虚线；无机动模型'],['links','通信视线','仅球形地球遮挡'],['fov','遥感视场','选中对象的天底相机'],['ground','星下点轨迹','选中对象的地面轨迹 · 天底连线'],['sun','光照标记','日出/日落（出影/进影）时刻标记'],['map2d','2D 地面轨迹图','等距圆柱投影 · 全对象轨迹 · 晨昏线 · 测站 · 点击选中']].map(([k,n,h])=><label key={k}><input type="checkbox" checked={layers[k]} onChange={e=>setLayers(l=>({...l,[k]:e.target.checked}))}/><span>{n}<small>{h}</small></span></label>)}</div>}
 {stationsOpen&&<div className="station-panel floating-panel"><header>地面测站 <small>{stations.length}</small><IconButton icon={X} label="关闭测站面板" onClick={()=>setStationsOpen(false)}/></header>
  <label className="station-arm"><input type="checkbox" checked={stationArm} onChange={e=>setStationArm(e.target.checked)}/><span>{stationArm?'添加模式已开启：点击地球放置测站':'开启添加模式后点击地球放置测站'}</span></label>
  <label className="station-mask">掩蔽角<select aria-label="测站掩蔽角" value={maskDeg} onChange={e=>setMaskDeg(+e.target.value)}>{[0,5,10,15,20].map(m=><option key={m} value={m}>{m}°</option>)}</select><small>站星连线与过境判定的最低仰角</small></label>
  {!stations.length&&<p className="panel-muted">还没有测站；也可在对话中说“在北纬 40° 西经 105° 添加测站”</p>}
  {stations.map(st=>{const la=available&&view!=='relative'?lookAngles(asset,sample,st):null;const vis=la&&la.elevation>=maskDeg;return <div key={st.id} className="station-row"><div className="station-meta"><strong>{st.name}</strong><small>纬度 {st.lat}° · 经度 {st.lon}°</small></div><span className={vis?'station-ok':''} title={`选中对象 ${asset.name} 相对此测站的方位角/仰角`}>{la?`${asset.name} ${la.azimuth.toFixed(0)}°/${la.elevation.toFixed(0)}°`:'—'}</span><IconButton icon={X} label={`移除测站 ${st.name}`} onClick={()=>setStations(v=>v.filter(x=>x.id!==st.id))}/></div>;})}
  <div className="pass-list"><header>过境窗口 <small>自当前时刻未结束 · 掩蔽角 {maskDeg}°</small></header>
   {passes.length?passes.map((w,i)=><div key={i} className="pass-row"><strong>{w.asset}</strong><span>→ {w.station}</span><span>{formatTime(w.rise)} – {formatTime(w.set)}</span><small>最高 {w.maxElevation}°</small></div>):<p className="panel-muted">当前时刻之后无过境窗口</p>}
   <small className="panel-note">步进 10 秒近似 · 球形地球 · 显示层分析，不进入实验运行指纹</small></div>
  {!!stations.length&&<div className="pass-list"><header>接力观测 <small>任一站可见即覆盖</small></header>
   {jointPasses.length?jointPasses.map((w,i)=><div key={i} className="pass-row"><strong>{w.asset}</strong><span>{formatTime(w.rise)} – {formatTime(w.set)}</span><small>{w.coverage.map(c=>c.name).join(' → ')} · 最高 {w.maxElevation}°</small></div>):<p className="panel-muted">当前时刻之后无联合覆盖窗口</p>}
   <small className="panel-note">掩蔽角 {maskDeg}° · 步进 10 秒近似 · coverage 按站交接排列</small></div>}</div>}
 {inspector&&<aside className="viewport-inspector floating-panel"><header><span className="shape-dot" style={{borderColor:asset.color}}/>{asset.name}<IconButton icon={X} label="关闭检查器" onClick={()=>setInspector(false)}/></header><div className="inspector-sub">民用卫星 / {available?(activeEvents(scene,sample,asset.id).length?'载荷暂不可用':`样本有效 · ${inShadow?'地影内（标记）':'光照中'}`):'等待样本'}</div><div className="value-pairs"><span>轨道高度<strong>{fmt(asset.altitude,0)} <small>km</small></strong></span><span>轨道速度<strong>{available?fmt(norm(s.velocity),3):'—'} <small>km/s</small></strong></span><span>倾角<strong>{fmt(asset.inclination)}<small> °</small></strong></span><span>周期<strong>{fmt(s.period/60)} <small>min</small></strong></span><span>下一明暗<strong>{nextLight?`${nextLight.kind==='sunrise'?'日出':'日落'} T+${fmt(nextLight.t,0)}s`:(inShadow?'场景内保持地影':'场景内全程光照')}</strong></span></div><div className="inspector-section"><span>预测假设（分析显示）</span><select aria-label="预测模型" value={prediction} onChange={e=>setPrediction(e.target.value)}><option value="circular">圆轨道二体 · A</option><option value="linear">惯性匀速外推 · B</option></select><label>预测时域<select value={horizon} onChange={e=>setHorizon(+e.target.value)}><option value={600}>10 分钟</option><option value={1200}>20 分钟</option><option value={2400}>40 分钟</option></select></label><small>显示预测不进入实验运行指纹</small></div><div className="inspector-section"><span>光照事件 · 场景全程</span>{sunEvts.length?sunEvts.map((e,i)=><div key={i} className={'light-row'+(e.t<time?' past':'')}><i className={e.kind==='sunrise'?'light-rise':'light-set'}/><span>{e.kind==='sunrise'?'日出（出影）':'日落（进影）'}</span><code>T+{fmt(e.t,0)}s · {formatTime(e.t)}</code></div>):<small>场景时长内无明暗交替</small>}<small>圆柱本影近似 · 边界二分精化 · 显示层分析</small></div><div className="inspector-section"><span>感知交付（演示投影）</span><select aria-label="感知交付模式" value={delivery} onChange={e=>setDelivery(e.target.value)}><option value="instant">20 秒采样 · 即时交付</option><option value="delayed">20 秒采样 · 延迟 60 秒</option></select><small>{available?`样本年龄 ${fmt(time-sample,0)}s`:'尚无可用样本'} · 无测量噪声</small></div><div className="inspector-note">{view==='relative'?(available?`R ${fmt(rel[0])} · T ${fmt(rel[1])} · N ${fmt(rel[2])} km`:'未交付，暂无相对坐标'):view==='comm'?'几何可见不代表链路预算成立或成功交付':view==='observation'?'足迹覆盖不代表有效成像；未分析云层、光照和地形':'圆轨道解析二体；无摄动与机动'}</div></aside>}
 {table&&<div className="number-table floating-panel"><header>样本数值 · ECI · km<IconButton icon={X} label="关闭数值表" onClick={()=>setTable(false)}/></header><table><thead><tr><th>对象</th><th>X</th><th>Y</th><th>Z</th><th>样本 UTC</th></tr></thead><tbody>{scene.assets.map(a=>{const q=stateAt(a,sample);return<tr key={a.id}><td><button onClick={()=>setSelected(a.id)}>{a.name}</button></td>{q.position.map((x,i)=><td key={i}>{available?fmt(x):'未知'}</td>)}<td>{available?formatTime(sample):'未交付'}</td></tr>})}</tbody></table></div>}
 </div>
 {layers.map2d&&<div className="map-strip"><GroundMap scene={scene} time={time} selected={selected} stations={stations} stationArm={stationArm} onAddStation={addStation} onSelect={setSelected}/></div>}
 <div className="timeline"><div className="timeline-top"><div className="playback-buttons"><IconButton icon={RotateCcw} label="回到开始" onClick={()=>{setTime(0);setPlaying(false)}}/><button className="play-button" onClick={()=>setPlaying(v=>!v)} aria-label={playing?'暂停':'播放'}>{playing?<Pause size={14} fill="currentColor"/>:<Play size={14} fill="currentColor"/>}</button><select value={speed} onChange={e=>setSpeed(+e.target.value)} aria-label="播放速度">{[1,10,30,60,120].map(s=><option key={s} value={s}>{s}×</option>)}</select></div><div className="utc-time">{formatTime(time)}<span>UTC · {new Date(Date.parse(scene.epoch)+time*1000).toISOString().slice(0,10)}</span></div><div className="timeline-perspective"><select aria-label="合成参与方视角" value={perspective} onChange={e=>setPerspective(e.target.value)}><option>研究组 A</option><option>研究组 B</option></select><small>演示视角 · 无权限隔离</small></div></div><div className="timeline-track"><input aria-label="仿真时间秒" type="range" min={0} max={scene.duration} step={1} value={time} onChange={e=>{setTime(+e.target.value);setPlaying(false)}}/>{scene.events.map(e=><button key={e.id} className="event-marker" title={`${e.note} · T+${eventTime(e)}s`} style={{left:`${eventTime(e)/scene.duration*100}%`}} onClick={()=>{setTime(eventTime(e));setPlaying(false)}}/>)}<div className="time-ticks">{[0,.25,.5,.75,1].map(n=><span key={n}>{formatTime(scene.duration*n).slice(0,5)}</span>)}</div></div></div></div>}
function ScenarioPanel(p){const{scene,editScene,notify,exportScene,onImport}=p;const[draft,setDraft]=useState({target:scene.assets[0].id,trigger:'scheduled',at:1500,duration:120,seed:42,note:'平台例行校验'});useEffect(()=>{if(!scene.assets.some(a=>a.id===draft.target))setDraft(d=>({...d,target:scene.assets[0].id}))},[scene.assets,draft.target]);function add(){const e={...draft,id:`event-${Date.now()}`,kind:'temporary-unavailable',window:draft.trigger==='seeded'?600:0};const ok=editScene(s=>({...s,events:[...s.events,e]}));if(ok)notify('事件已写入本地草稿缓冲；保存草稿后成为版本');}return <div className="page-scroll"><PageHeading icon={FileJson} title="场景与事件" description="编辑进入本地草稿缓冲；保存草稿生成不可变版本"><button onClick={onImport}><Upload size={14}/>导入</button><button onClick={exportScene}><Download size={14}/>导出 JSON</button></PageHeading><div className="section-title">场景配置</div><div className="form-grid"><label>场景名称<input key={scene.name} defaultValue={scene.name} maxLength={80} onBlur={e=>{const name=e.target.value.trim();if(name){if(!editScene(s=>({...s,name}),{skipValidate:false}))e.target.value=scene.name;}else{e.target.value=scene.name;notify("场景名称不能为空")}}}/></label><label>时长（秒）<input type="number" min={60} max={86400} key={scene.duration} defaultValue={scene.duration} onBlur={e=>{if(!editScene(s=>({...s,duration:+e.target.value})))e.target.value=scene.duration;}}/></label><label>历元<input readOnly value="2026-10-04 00:00:00 UTC"/></label><label>模型<input readOnly value="圆轨道解析二体 @0.1"/></label></div><div className="section-title">事件计划 <span>{scene.events.length} 个事件</span></div><div className="event-list">{scene.events.map(e=><div className="event-row" key={e.id}><div className="event-time">{formatTime(eventTime(e))}<small>T+{eventTime(e)}s</small></div><div className="event-desc"><strong>{e.note}</strong><span>{e.target} / platform · 暂不可用 {e.duration}s</span><small>{e.trigger==='seeded'?`种子 ${e.seed} · 窗口 ${e.window||600}s`:'定时触发'} · 恢复时仅移除本事件原因</small></div><IconButton icon={X} label={`移除事件 ${e.note}`} onClick={()=>editScene(s=>({...s,events:s.events.filter(x=>x.id!==e.id)}))}/></div>)}</div><section className="editor-section"><div className="section-title">添加事件</div><div className="form-grid"><label>目标平台<select value={draft.target} onChange={e=>setDraft(d=>({...d,target:e.target.value}))}>{scene.assets.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>触发方式<select value={draft.trigger} onChange={e=>setDraft(d=>({...d,trigger:e.target.value}))}><option value="scheduled">定时</option><option value="seeded">种子随机 · 600s 窗口</option></select></label><label>起始时间（秒）<input type="number" value={draft.at} onChange={e=>setDraft(d=>({...d,at:+e.target.value}))}/></label><label>持续时间（秒）<input type="number" value={draft.duration} onChange={e=>setDraft(d=>({...d,duration:+e.target.value}))}/></label><label>随机种子<input type="number" value={draft.seed} onChange={e=>setDraft(d=>({...d,seed:+e.target.value}))}/></label><label>说明<input value={draft.note} onChange={e=>setDraft(d=>({...d,note:e.target.value}))}/></label></div><button className="primary" onClick={add}><Plus size={15}/>添加到本地缓冲</button></section>
<section className="editor-section"><div className="section-title">版本历史 <span>{p.revisions.length} 个版本 · 不可变</span></div><div className="rev-list">{p.revisions.slice().reverse().map(r=><div className={'rev-row'+(r.revision_id===p.head?' current':'')} key={r.revision_id}><strong>{r.revision_id.replace(/^[a-z]\d+-/,'')}</strong>{r.revision_id===p.head&&<small>当前 head</small>}<code>{r.content_hash.slice(0,11)}</code><span>{r.label||(r.source_revision_id?'fork 来源 '+r.source_revision_id:'编辑保存')}</span><span className="job-spacer"/>{r.revision_id!==p.head&&<button onClick={()=>p.restoreAction(r.revision_id)}><RotateCcw size={12}/>恢复为此内容</button>}</div>)}</div><p className="muted">恢复不倒退历史：旧版本内容会成为新的 head 修订，r1…rN 全部保留；实验与回放继续引用各自的精确来源。</p></section>
<div className="inline-note"><Info size={16}/><span>事件仅控制平台载荷可用性，不改变轨道。相同种子产生相同时间。编辑只写本地草稿缓冲；保存草稿生成 DraftRevision，实验从精确版本冻结。</span></div></div>}
function ModelsPanel(p){const{scene,asset,setSelected,updateAsset,editScene}=p;const[component,setComponent]=useState('orbit');useEffect(()=>{if(!['orbit','attitude','resources',...asset.payloads.map(x=>x.id)].includes(component))setComponent('orbit')},[asset.id,asset.payloads,component]);const selectedPayload=asset.payloads.find(x=>x.id===component);const field=(label,key,min,max)=><label>{label}<input key={asset.id+key+asset[key]} type="number" min={min} max={max} step="0.1" defaultValue={asset[key]} onBlur={e=>{if(!updateAsset({[key]:+e.target.value}))e.target.value=asset[key]}}/></label>;return <div className="models-page"><PageHeading icon={Box} title="组合模型" description="共享平台能力与多个独立民用载荷；编辑写入本地草稿缓冲"/><div className="model-columns"><aside className="model-tree">{scene.assets.map(a=><div key={a.id}><button className={a.id===asset.id?'active':''} onClick={()=>{setSelected(a.id);setComponent('orbit')}}><Satellite size={15}/>{a.name}</button>{a.id===asset.id&&<div className="model-children">{[['orbit','轨道',Orbit],['attitude','姿态',Crosshair],['resources','电源与存储',Activity],...a.payloads.map(x=>[x.id,x.name,x.kind==='camera'?Camera:Radio])].map(([id,name,I])=><button className={component===id?'selected':''} key={id} onClick={()=>setComponent(id)}><I size={14}/>{name}</button>)}</div>}</div>)}</aside><div className="model-editor"><div className="model-path">{asset.id} / {selectedPayload?'payload':'platform'} / {component}</div><h3>{selectedPayload?.name||({orbit:'圆轨道传播器',attitude:'天底指向假设',resources:'平台资源接口'}[component])}</h3>{component==='orbit'?<><div className="form-grid">{field('高度（km）','altitude',160,36000)}{field('倾角（°）','inclination',0,180)}{field('升交点赤经（°）','raan',0,360)}{field('初始相位（°）','phase',0,360)}</div><div className="binding-list"><span>提供 <code>orbit.kinematics</code></span><span>消费者 <code>camera · radiometer · display</code></span><span>坐标 <code>ECI 示例惯性系 · km / s</code></span></div><p className="muted">圆轨道 e=0。编辑写入本地缓冲，保存草稿后整条轨道以新版本重新计算；未模拟轨道转移或推进系统。</p></>:component==='attitude'?<><p>遥感传感器始终指向地心，滚转固定为零。</p><div className="binding-list"><span>提供 <code>attitude.nadir</code></span><span>依赖 <code>orbit.kinematics</code></span></div><p className="muted">这是几何假设，不是姿态动力学或执行机构模型。</p></>:component==='resources'?<><p>载荷可用性由平台事件的原因集合统一管理。</p><div className="binding-list"><span>提供 <code>availability.causes</code></span><span>事件 <code>temporary-unavailable</code></span></div><p className="muted">电池、功率消耗与存储流量尚未数值积分；这里声明组合接口，不显示虚构遥测。</p></>:selectedPayload?<><label className="toggle-field"><input type="checkbox" checked={selectedPayload.enabled} onChange={e=>updateAsset({payloads:asset.payloads.map(x=>x.id===component?{...x,enabled:e.target.checked}:x)})}/>启用载荷</label><label>全视场角（°）<input type="number" min={1} max={60} value={selectedPayload.fov} onChange={e=>{const n=+e.target.value;if(n>=1&&n<=60)updateAsset({payloads:asset.payloads.map(x=>x.id===component?{...x,fov:n}:x)})}}/></label><div className="binding-list"><span>需要 <code>orbit.kinematics</code></span><span>需要 <code>attitude.nadir</code></span><span>需要 <code>platform.availability</code></span></div><p className="muted">{selectedPayload.kind==='camera'?`当前球面足迹半径约 ${footprintRadius(asset.altitude,selectedPayload.fov)===null?'超出圆形足迹模型范围':fmt(footprintRadius(asset.altitude,selectedPayload.fov))+' km'}；只显示选中对象的相机几何`:'当前载荷为声明式组件；未实现科学测量值或射频链路预算'}</p></>:null}</div></div></div>}
function ExperimentsPanel({p,bump,draft,head,revisions,sourceRev,setSourceRev,pf,setPf,notify,openTab,actions}){
 const jobs=listJobs(p),evaluations=listEvaluations(p),locks=listLocks(p),comparisons=listComparisons(p);
 const[cmpA,setCmpA]=useState(null),[cmpB,setCmpB]=useState(null);
 const aSel=cmpA||evaluations.at(-1)?.evaluation_id||'',bSel=cmpB||evaluations.at(-2)?.evaluation_id||aSel;
 const rev=sourceRev&&revisions.some(r=>r.revision_id===sourceRev)?sourceRev:head,selectedRevObj=revisions.find(r=>r.revision_id===rev);
 const lastLock=locks.filter(l=>l.source_revision_id===rev).at(-1);
 return <div className="page-scroll"><PageHeading icon={FlaskConical} title="实验假设" description="预检只读不改状态；冻结从精确来源版本生成锁；作业独立于视图存在"/>
 <div className="section-title">运行来源（DraftRevision）</div>
 <div className="form-grid">
  <label>来源版本<select value={rev} onChange={e=>{setSourceRev(e.target.value);setPf(null)}}>{revisions.slice().reverse().map(r=><option key={r.revision_id} value={r.revision_id}>{label(r.revision_id)}{r.revision_id===head?' · head':''}{r.source_revision_id?' · fork':''}</option>)}</select></label>
  <label>内容摘要<input readOnly value={selectedRevObj?selectedRevObj.content_hash:'—'}/></label>
  <label>实验锁{lastLock?<input readOnly value={`${lastLock.lock_id} · 来源 ${label(lastLock.source_revision_id)}`}/>:<input readOnly value="尚未冻结"/>}</label>
 </div>
 <p className="muted">固定运行模型 circular-two-body@0.1：球形地球，μ = 398600.4418 km³/s²，R = 6371 km；相对秒驱动演算。显示预测假设与感知交付模式不进入运行指纹。保存后的草稿继续编辑不会改变已冻结来源。</p>
 <div className="section-title">1 · 预检（只读，不创建锁）</div>
 <div className="action-row"><button className="primary" onClick={()=>actions.preflightAction(rev)}><ShieldCheck size={14}/>预检 {label(rev)}</button>{pf&&pf.source_revision===rev&&<small className="muted">报告缓存于本会话；来源切换后失效</small>}</div>
 {pf&&pf.source_revision===rev&&<div className="pf-report">{pf.ok?<div className="pf-line ok"><CheckCircle2 size={15}/>无阻塞项</div>:<div className="pf-line bad"><AlertCircle size={15}/>{pf.blocking.join('；')}</div>}
  {!!pf.warnings.length&&<div className="pf-line warn"><AlertCircle size={15}/>{pf.warnings.join('；')}</div>}
  <div className="pf-grid"><div><h5>实际消费的因素</h5><ul>{Object.entries(pf.factors).map(([k,v])=><li key={k}><code>{k}</code> {Array.isArray(v)?v.join(', '):String(v)}</li>)}</ul></div><div><h5>不进入运行指纹</h5><ul>{pf.not_consumed.map(x=><li key={x}>{x}</li>)}</ul><h5>预算估计</h5><ul><li>{pf.budget.runs} 个运行计划 × {pf.budget.samples_per_run} 样本</li><li>总计 {pf.budget.total_samples} 个科学样本槽位</li></ul></div></div></div>}
 <div className="section-title">2 · 冻结实验（ExperimentLock）</div>
 <div className="action-row"><button className="primary" disabled={pf&&pf.source_revision===rev&&!pf.ok} onClick={()=>actions.freezeAction(rev)}><Lock size={14}/>冻结 {label(rev)}</button><small className="muted">相同来源版本与内容重复冻结会复用同一把锁；head 前移不影响已冻结来源</small></div>
 {!!locks.length&&<div className="lock-list">{locks.slice().reverse().map(l=><div className="lock-row" key={l.lock_id}><Lock size={13}/><strong>{l.lock_id}</strong><span>来源 {label(l.source_revision_id)}</span><code>{l.content_hash.slice(0,11)}</code><span>{l.scene.assets.length} 对象 · {l.scene.events.length} 事件</span></div>)}</div>}
 <div className="section-title">3 · 提交运行（BatchJob）</div>
 <div className="action-row"><button className="primary" disabled={!lastLock} onClick={()=>actions.submitAction(lastLock?.lock_id)}><Play size={14}/>提交运行{lastLock?'（'+lastLock.lock_id+'）':'（先冻结）'}</button><small className="muted">RunPlan 槽位在提交时固定；之后的草稿编辑与队列无关</small></div>
 <div className="section-title">任务 {jobs.length?`· ${jobs.length} 个作业`:''}</div>
 {!jobs.length?<div className="empty-state"><ListChecks size={22}/><p>还没有作业</p><span>预检 → 冻结 → 提交运行；没有结果时这里不显示合成数字</span></div>:<div className="job-list">{jobs.slice().reverse().map(j=>{const s=jobSummary(j);return <div className="job-row" key={j.job_id}><div className="job-head"><strong>{j.job_id}</strong><span className={'job-state st-'+j.state}>{JOB_STATE_LABEL[j.state]}</span><small>锁 {j.lock_id} · 来源 {label(p.locks[j.lock_id]?.source_revision_id)}</small><span className="job-spacer"/><button disabled={!['queued','running','pausing'].includes(j.state)} onClick={()=>actions.jobControl('pause',j.job_id)}><Pause size={12}/>暂停</button><button disabled={j.state!=='paused'&&j.state!=='pausing'} onClick={()=>actions.jobControl('resume',j.job_id)}><Play size={12}/>继续</button><button disabled={['completed','cancelled','failed'].includes(j.state)} onClick={()=>actions.jobControl('cancel',j.job_id)}><Square size={12}/>取消</button></div><div className="job-progress"><span style={{width:`${s.planned?100*(s.done+s.cancelled)/s.planned:0}%`}} className={s.cancelled?'partial':'full'}/></div><div className="job-meta"><span>槽位 {s.done}/{s.planned} 完成{s.cancelled?` · ${s.cancelled} 取消`:''}</span><span>commit_seq {j.commit_seq} · control_revision {j.control_revision}</span>{j.state==='completed'&&<button className="primary mini" onClick={()=>actions.evaluateAction(j.job_id)}><CheckCircle2 size={12}/>固定评价</button>}{j.evaluation_id&&p.evaluations[j.evaluation_id]&&<button className="mini" onClick={()=>openTab('replay',{binding:'replay:'+j.job_id,title:'回放 · '+j.job_id})}><History size={12}/>打开回放</button>}</div></div>})}</div>}
 <div className="section-title">结果（固定评价）{evaluations.length?`· ${evaluations.length}`:''}</div>
 {!evaluations.length?<p className="muted">还没有已固定的评价。作业完成后执行“固定评价”生成冻结 source snapshot 的 Evaluation；在此之前不会显示任何合成数字。</p>:<div className="eval-list">{evaluations.slice().reverse().map(ev=><div className="eval-card" key={ev.evaluation_id}><div className="eval-head"><strong>{ev.evaluation_id}</strong><span>作业 {ev.job_id} · 锁 {ev.lock_id} · 来源 {label(ev.source_snapshot.source_revision_id)}</span><code>{ev.source_snapshot.content_hash.slice(0,11)}</code><span className="job-spacer"/><button onClick={()=>openTab('replay',{binding:'replay:'+ev.job_id,title:'回放 · '+ev.job_id})}><History size={12}/>回放</button><button onClick={()=>actions.exportEvaluation(ev.evaluation_id)}><Download size={12}/>导出</button></div>
  <table className="eval-table"><thead><tr><th>RunPlan 案例</th><th>样本</th><th>几何可见</th><th>最小间距 km</th><th>载荷可用</th></tr></thead><tbody>{ev.metrics.map(m=><tr key={m.case_id}><td>{m.case_id}</td><td>{m.samples}</td><td>{m.visible} / {m.samples}（{(m.visible_fraction*100).toFixed(1)}%）</td><td>{fmt(m.min_distance_km,0)}</td><td>{(m.availability_fraction*100).toFixed(1)}%</td></tr>)}{ev.missing_values.map(c=><tr key={c} className="eval-missing"><td>{c}</td><td colSpan={4}>无已提交值（槽位保留在总体中，不填补 0）</td></tr>)}</tbody></table>
  <small>分母来自固定 RunPlan；分母={ev.denominator.planned}，完成 {ev.denominator.done}，取消 {ev.denominator.cancelled}。几何采样不是连续时间极值，也不是任务成功率。</small></div>)}</div>}
 <div className="section-title">比较（显式计划）{comparisons.length?`· ${comparisons.length}`:''}</div>
 {evaluations.length<2?<p className="muted">比较需要两个已固定评价：用不同来源版本分别 冻结 → 提交运行 → 固定评价，然后在此对齐比较。</p>
 :<><div className="action-row"><select aria-label="比较左侧评价" value={aSel} onChange={e=>setCmpA(e.target.value)}>{evaluations.slice().reverse().map(ev=><option key={ev.evaluation_id} value={ev.evaluation_id}>{ev.evaluation_id} · 来源 {ev.source_snapshot.source_revision_id.replace(/^[a-z]\d+-/,'')}</option>)}</select><span>↔</span><select aria-label="比较右侧评价" value={bSel} onChange={e=>setCmpB(e.target.value)}>{evaluations.slice().reverse().map(ev=><option key={ev.evaluation_id} value={ev.evaluation_id}>{ev.evaluation_id} · 来源 {ev.source_snapshot.source_revision_id.replace(/^[a-z]\d+-/,'')}</option>)}</select><button className="primary" disabled={aSel===bSel} onClick={()=>actions.comparisonAction(aSel,bSel)}><GitBranch size={14}/>创建比较</button>{aSel===bSel&&<small className="muted">左右选择不能相同</small>}</div>
 {!!comparisons.length&&<div className="cmp-list">{comparisons.slice().reverse().map(c=><div className="eval-card" key={c.comparison_id}><div className="eval-head"><strong>{c.comparison_id}</strong><span>{c.refs[0]} ↔ {c.refs[1]}</span><span className={'cmp-badge '+(c.comparable?'ok':'bad')}>{c.comparable?'共享运行模型与采样':'因素不一致'}</span><span className="job-spacer"/></div>
  {!!c.differences.length&&<ul className="cmp-diff">{c.differences.map(d=><li key={d}>{d}</li>)}</ul>}
  <table className="eval-table"><thead><tr><th>案例</th><th>左 · 几何可见</th><th>右 · 几何可见</th><th>左 · 最小间距 km</th><th>右 · 最小间距 km</th></tr></thead><tbody>{c.rows.map(row=><tr key={row.case_id}><td>{row.case_id}</td><td>{row.a?`${row.a.visible} / ${row.a.samples}`:'—（仅单侧）'}</td><td>{row.b?`${row.b.visible} / ${row.b.samples}`:'—（仅单侧）'}</td><td>{row.a?fmt(row.a.min_distance_km,0):'—'}</td><td>{row.b?fmt(row.b.min_distance_km,0):'—'}</td></tr>)}</tbody></table>
  <small>比较固定双方评价与来源快照；正式分母各自保留（{c.refs[0]}：planned {c.denominators[c.refs[0]].planned} · {c.refs[1]}：planned {c.denominators[c.refs[1]].planned}）。差异声明列出实际不同的输入。</small></div>)}</div>}</>}
 <div className="inline-note"><Info size={16}/><span>预检与冻结、提交是分开的动作：预检绝不创建锁；冻结可以从任何历史版本进行（head 已前移也可）；作业与评价分离。控制台命令 preview：预检 / 冻结实验 / 提交运行 / 任务 / 固定评价 J1 / 回放 J1 / 比较 E1 E2。</span></div></div>;}
function ReplayPanel({p,jobId,delivery,notify}){
 const boundJob=jobId&&jobId!=='none'?jobId:null;
 const ev=boundJob?Object.values(p.evaluations).find(e=>e.job_id===boundJob):null;
 const[time,setTime]=useState(0),[playing,setPlaying]=useState(false);
 useEffect(()=>{setTime(0);setPlaying(false)},[jobId]);
 useEffect(()=>{if(!playing||!ev)return;let previous=performance.now();const h=setInterval(()=>{const now=performance.now(),dt=(now-previous)/1000;previous=now;setTime(t=>{const n=Math.min(p.locks[ev.lock_id].scene.duration,t+dt*30);if(n>=p.locks[ev.lock_id].scene.duration)setPlaying(false);return n})},100);return()=>clearInterval(h)},[playing,ev]);
 if(!ev)return <div className="page-scroll"><PageHeading icon={History} title={'回放 · '+(boundJob||'未绑定')} description="此标签绑定固定结果来源"/><div className="empty-state"><AlertCircle size={26}/><p>unavailable：绑定的结果不存在或尚未固定评价</p><span>{boundJob?'作业 '+boundJob+' 完成并“固定评价”后，此标签才会显示数据':'从实验页的已完成作业打开回放'}；不会回退到当前草稿场景</span></div></div>;
 const scene=p.locks[ev.lock_id].scene,received=deliveryEvents(scene,time,delivery);
 return <div className="page-scroll"><PageHeading icon={History} title={'回放 · REPLAY · '+ev.job_id} description="固定来源快照的历史读取；与本会话的草稿编辑相互独立"/>
 <div className="replay-binding"><span>来源修订 {label(ev.source_snapshot.source_revision_id)}</span><span>锁 {ev.lock_id}</span><code>{ev.source_snapshot.content_hash.slice(0,11)}</code><span>评价 {ev.evaluation_id}</span></div>
 <div className="replay-clock">{formatTime(time)}<span>UTC / T+{fmt(time,0)}s</span></div><div className="playback-buttons"><IconButton icon={RotateCcw} label="回到开始" onClick={()=>{setTime(0);setPlaying(false)}}/><button className="play-button" onClick={()=>setPlaying(v=>!v)} aria-label={playing?'暂停':'播放'}>{playing?<Pause size={14} fill="currentColor"/>:<Play size={14} fill="currentColor"/>}</button></div>
 <input className="wide-range" type="range" min={0} max={scene.duration} value={time} onChange={e=>{setTime(+e.target.value);setPlaying(false)}} aria-label="回放时间"/>
 <div className="section-title">截至当前时刻已交付的通知</div>
 {!received.length?<div className="empty-state"><Clock size={24}/><p>尚无事件通知</p><span>拖动时间轴经过事件交付点</span></div>:received.map(e=><div className="replay-event" key={e.id}><span className="event-symbol"><Activity size={17}/></span><div><strong>{e.note}</strong><p>{e.target} / platform</p><span>发生 {formatTime(e.occurredAt)} · 获知 {formatTime(e.learnedAt)} UTC</span></div><small>{e.active?'已知：暂不可用':'已知：已恢复'}</small></div>)}
 <div className="inline-note"><Info size={16}/><span>回放读取冻结的场景字节，不跟随草稿 head。历史时刻只列出当时已交付知识；迟到观测不回填历史。感知交付选择是演示投影。</span></div></div>;}
const README=`轨道 Agent 工作台 0.9\n\n所有输入为合成场景，当前运行于浏览器内存（prototype-in-memory）。\n\n运行时：\n- Three.js 真实 WebGL 视口；真实太阳方位光照、地影标记、日出/日落时刻（出影/进影，边界二分精化到亚秒，轨道上 3D 标记）、星下点轨迹（过去实线/未来虚线）、跟随镜头、速度矢量\n- 2D 地面轨迹图（等距圆柱投影）：全对象星下点轨迹、晨昏线夜半球遮罩、太阳直下点、事件标记与测站；点击星下点选中对象，测站添加模式下点击放置\n- 地面测站：点击地球或 2D 地图添加，掩蔽角可配置（0–20°），站星连线与过境窗口联动；显示方位角/仰角；多站接力观测联合窗口
- 态势标注：事件不可用弧段、轨道方向箭头、星下点轨迹昼夜分段（向阳=对象色/地影=灰蓝）\n- 圆轨道解析二体；ECI 示例惯性系；km、s、度\n- 20 秒观测采样，可选 60 秒交付延迟\n- RTN 相对坐标、被动预测、球形地球视线、天底圆锥足迹\n- 平台 + 多载荷组合、JSON Schema、定时 / 种子事件\n\n应用层：\n- Project / WorkSession / DraftRevision 对象分离；会话只持引用，不隐式克隆场景\n- 草稿保存走 CAS + 幂等键 + 回执；冲突提供三方合并或分支，没有“确认覆盖”\n- 预检只读；冻结从精确来源版本生成锁（head 前移不影响）\n- 批量作业固定 RunPlan 槽位；暂停/继续/取消与物理提交分离（control_revision）\n- 完成后固定评价（Evaluation），回放标签绑定冻结快照，不跟随草稿 head\n- 显示动作（display.*）与领域动作分离；控制台与界面调用同一服务\n\n语言模型：\n- 已连接 DeepSeek 官方 API（deepseek-flash），真实流式输出，无模拟回退\n- 模型提出工具调用，统一分发器真实执行后回传结果，多轮直至最终回答\n- 工具目录 43 个：含 assets.list（对象清单）、subpoint.query（星下点/光照）、display.rate（倍速）等\n- 助手回答以 Markdown 渲染；工具调用以标签行展示；对话可导出 Markdown 存档\n- API key 在构建时从 keys.txt 注入；可在“工具与能力 → 模型连接”覆盖并测试\n\n边界：\n- 终端是本地命令控制台，不是操作系统 shell 或 PTY\n- 文件为浏览器内虚拟文件；刷新页面状态重置\n- 浏览器使用隔离 iframe；站点策略可能拒绝嵌入\n- 前端研究组切换不提供访问控制\n- 无 J2、阻力、机动、姿态动力学、功率积分或精确测量\n- 太阳方向为低精度解析式（±0.5°），地影为圆柱本影近似；过境为固定步进扫描；光照事件边界经二分精化到亚秒（物理模型本身仍是近似）\n- 以上太阳/地影/测站分析只服务显示与对话，不进入实验指标\n\n数据来源：NASA Blue Marble 历史地表拼图，非实时影像。\n底图仅供视觉背景，几何计算不读取像素。\n`;
function TerminalPanel({execute}){const[lines,setLines]=useState([{kind:'info',text:'Orbit local console v0.3\n浏览器内有限命令，不执行系统 shell；自然语言对话由 DeepSeek 模型在聊天面板处理。输入 help 查看命令。'}]),[command,setCommand]=useState('');const end=useRef(null);useEffect(()=>{end.current?.scrollIntoView({block:'nearest'})},[lines]);function run(e){e.preventDefault();const q=command.trim();if(!q)return;if(q==='clear')setLines([]);else{const result=execute(q,'terminal');setLines(v=>[...v,{kind:'input',text:q},{kind:'output',text:result}])}setCommand('')}return <div className="terminal-panel"><div className="terminal-info"><span><Terminal size={14}/>本地命令控制台</span><small>PTY 后端未连接</small></div><div className="terminal-output">{lines.map((l,i)=><pre key={i} className={l.kind}>{l.kind==='input'?'orbit > ':''}{l.text}</pre>)}<div ref={end}/></div><form className="terminal-form" onSubmit={run}><span>orbit ›</span><input autoFocus value={command} onChange={e=>setCommand(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();run(e)}}} placeholder="help / status / 预检 / 冻结实验 / 提交运行 / 任务" aria-label="本地终端命令" autoComplete="off"/><button type="submit" aria-label="运行本地命令"><ArrowUp size={15}/></button></form><div className="terminal-examples">快捷命令 {['status','jobs','冻结实验','seek 900'].map(q=><button key={q} onClick={()=>setCommand(q)}>{q}</button>)}</div></div>}
function FilesPanel({p,draft,head,displayedScene,buf,editingBase,saveDraftAction,exportScene,onDirty,notify}){
 const headText=JSON.stringify(draft.revisions[head].scene,null,2);
 const staticText={ 'tools.json':()=>JSON.stringify(TOOL_CATALOG,null,2),'README.md':()=>README};
 const[file,setFile]=useState('scene.json'),[texts,setTexts]=useState({}),[dirtyMap,setDirtyMap]=useState({}),[status,setStatus]=useState(''),[error,setError]=useState(false);
 const bufText=buf?.dirty?JSON.stringify(displayedScene,null,2):headText;
 useEffect(()=>{if(!dirtyMap['scene.json'])setTexts(t=>({...t,['scene.json']:bufText}))},[bufText,dirtyMap]);
 useEffect(()=>{onDirty(!!dirtyMap['scene.json'])},[dirtyMap,onDirty]);
 const text=texts[file]??(staticText[file]?staticText[file]():bufText),dirty=!!dirtyMap[file];
 function choose(f){setFile(f);setStatus('');}
 function save(){
  if(file!=='scene.json')return;
  let parsed;try{parsed=JSON.parse(text)}catch(e){setError(true);setStatus('JSON 解析失败：'+e.message);return;}
  const v=validateScene(parsed);if(!v.ok){setError(true);setStatus('校验失败：'+v.error);return;}
  // 统一提交链：文件编辑器与其他入口共用同一 CAS 保存；冲突时打开三方对话框，没有“确认覆盖”
  const r=saveDraftAction(`files:${Math.random().toString(36).slice(2,8)}`,{scene:parsed,base:editingBase});
  if(r.ok){setError(false);setStatus('校验通过，已保存为新版本'+(r.receipt?' · 回执 '+r.receipt.receipt_id:''));setDirtyMap(m=>({...m,['scene.json']:false}));}
  else{setError(true);setStatus('保存未完成：冲突已在对话框中打开；文本编辑保留');}
 }
 return <div className="files-panel"><div className="file-sidebar"><span>虚拟工作区</span>{['scene.json','tools.json','README.md'].map(f=><button key={f} className={f===file?'active':''} onClick={()=>choose(f)}><FileCode2 size={14}/>{f}{f==='scene.json'&&dirtyMap[f]&&<i/>}</button>)}<small>位于浏览器内存<br/>不访问本机磁盘</small></div><div className="file-editor"><header><span>{file}{dirty&&<i/>}</span>{file==='scene.json'&&<><button onClick={exportScene}><Download size={14}/>导出</button><button className="primary" onClick={save}><Check size={14}/>校验并保存（CAS）</button></>}</header><textarea className="code-editor" spellCheck={false} aria-label={file+' 编辑器'} value={text} readOnly={file!=='scene.json'} onChange={e=>{setTexts(t=>({...t,[file]:e.target.value}));setDirtyMap(m=>({...m,[file]:true}))}}/>{status&&<div className={'file-result '+(error?'error':'')}>{error?<AlertCircle size={14}/>:<CheckCircle2 size={14}/>} {status}</div>}<footer>{file==='scene.json'?'保存走统一提交链：CAS 冲突时合并或分支，不会静默覆盖':'只读文件'} · UTF-8</footer></div></div>}
function BrowserPanel(){const[address,setAddress]=useState('https://threejs.org'),[url,setUrl]=useState(''),[error,setError]=useState('');function go(e){e.preventDefault();try{const u=new URL(address);if(u.protocol!=='https:')throw Error('仅支持 HTTPS 地址');if(u.username||u.password)throw Error('地址不能包含凭据');setUrl(u.href);setError('')}catch(e){setError(e.message)}}return <div className="browser-panel"><form className="browser-bar" onSubmit={go}><Globe size={15}/><input value={address} onChange={e=>setAddress(e.target.value)} aria-label="浏览器地址"/><button type="submit">打开</button>{url&&<a href={url} target="_blank" rel="noopener noreferrer" title="在独立标签页打开"><ExternalLink size={16}/></a>}</form><div className="browser-notice">隔离 iframe 预览；部分网站禁止嵌入。无法显示时，可在独立标签页打开。未连接浏览器自动化服务。</div>{error&&<div className="file-result error">{error}</div>}{url?<iframe title="外部网页预览" src={url} sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer"/>:<div className="browser-empty"><Globe size={34}/><h2>浏览器工作区</h2><p>查阅参考，与场景保持在同一个会话</p><div>{[['Three.js','https://threejs.org'],['Kimi Code Desktop','https://www.kimi.com/code/docs/en/kimi-code-desktop/interface-and-sessions.html'],['NASA Blue Marble','https://svs.gsfc.nasa.gov/2915']].map(([n,u])=><button key={n} onClick={()=>{setAddress(u);setUrl(u)}}>{n}<ExternalLink size={13}/></button>)}</div></div>}</div>}
const SNAPSHOT_KEY='orbit-agent-workbench-snapshot-v1';
const WELCOME='场景已就绪。已连接 DeepSeek 官方 API：直接用自然语言下指令，例如“把时间设到 900 秒并显示相对轨迹”；模型提出的工具调用经统一提交链真实执行（CAS · 幂等 · 回执）。';
function SessionHost(){
 const init=useRef(null);
 if(!init.current){ // 启动恢复（§37.4 原型）：快照 → 校验 → 对象规范化；失败则从模板引导
  let raw=null;try{raw=JSON.parse(localStorage.getItem(SNAPSHOT_KEY)||'null')}catch(e){}
  const r=restoreProject(raw);
  if(r.ok){
   const sessions=Object.keys(r.project.sessions).filter(id=>r.project.sessions[id]&&!r.project.sessions[id].archived);
   if(!sessions.length)sessions.push(createSession(r.project,'会话 1',r.project.default_draft_id));
   init.current={project:r.project,sessions,active:sessions[0],restored:true,normalized:r.normalized_jobs,savedAt:raw.saved_at_epoch||null,ui:raw.ui||{}};
  }else{
   const p=bootstrapProject(DEFAULT_SCENE);const sid=createSession(p,'近地轨道协同观测',p.default_draft_id);
   init.current={project:p,sessions:[sid],active:sid,restored:false,normalized:[],savedAt:null,ui:{}};
  }
 }
 const p=init.current.project;
 const[version,setVersion]=useState(0),bump=()=>setVersion(v=>v+1);
 const[sessions,setSessions]=useState(init.current.sessions),[active,setActive]=useState(init.current.active);
 const uiRegistry=useRef(init.current.ui);
 useEffect(()=>{ // 领域状态变化后防抖保存快照；仅合成数据，不含凭据（§37.4 边界）
  const h=setTimeout(()=>{try{const snap=snapshotProject(p);snap.ui=uiRegistry.current;localStorage.setItem(SNAPSHOT_KEY,JSON.stringify(snap));}catch(e){}},600);return()=>clearTimeout(h)},[version]);
 useEffect(()=>{ // 作业泵：计算独立于视图与会话生命周期（§37.2）；暂停在边界生效
  const h=setInterval(()=>{let any=false;for(const j of listJobs(p))if(['queued','running','pausing'].includes(j.state)){jobTick(p,j.job_id);any=true;}if(any)bump();},300);return()=>clearInterval(h)},[]);
 function addSession(){const n=sessions.length+1;const id=createSession(p,'会话 '+n,p.default_draft_id);setSessions(s=>[...s,id]);setActive(id);bump();}
 function archiveSessionUI(id){ // UX07：归档是组织状态；作业属于项目继续运行
  const remaining=sessions.filter(x=>x!==id);if(remaining.length<1)return;
  archiveSession(p,id);
  setSessions(remaining);if(active===id)setActive(remaining[0]);bump();
 }
 return sessions.map(s=><App key={s} p={p} bump={bump} version={version} sessionId={s} sessionItems={sessions} activeSession={s===active} onNewSession={addSession} onSessionSwitch={setActive} onArchiveSession={archiveSessionUI} initialUi={uiRegistry.current[s]||null} uiRegistry={uiRegistry} snapshotInfo={{restored:init.current.restored,normalized:init.current.normalized,savedAt:init.current.savedAt}}/>)
}
createRoot(document.getElementById('root')).render(<SessionHost/>);
