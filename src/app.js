// 应用核心：Project / WorkSession / ScenarioDraft / DraftRevision / ExperimentLock /
// BatchJob / Evaluation / Receipt（设计 §36.2 对象表）。所有领域写入经过统一服务：
// ChangeSet 摘要 → CAS → 幂等键 → 回执（§38 提交链）。纯同步、可确定性测试；
// 浏览器内内存实现，明确标注 prototype，不冒充服务端权限或持久事务。
import {clone, validateScene, stateAt, lineOfSight, norm, sub, eventTime} from './domain.js';

// ---------- 确定性序列化与内容摘要 ----------
export function stableStringify(x){
	if(x===null||typeof x!=='object')return JSON.stringify(x);
	if(Array.isArray(x))return '['+x.map(v=>stableStringify(v??null)).join(',')+']';
	return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stableStringify(x[k])).join(',')+'}';
}
export function contentHash(x){
	const s=stableStringify(x);let h1=0x811c9dc5,h2=0x01000193;
	for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);h1=(h1^c)>>>0;h1=Math.imul(h1,0x01000193)>>>0;h2=(h2+c)>>>0;h2=Math.imul(h2,0x85ebca6b)>>>0;}
	return 'b3:'+h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0');
}

// ---------- 项目与会话 ----------
let COUNTERS={rev:0,rcp:0};
export function resetCounters(){COUNTERS={rev:0,rcp:0};}
const nextId=(prefix,n)=>`${prefix}${n}`;
export function createProject(name='轨道仿真实验室'){
	return {project_id:'p-orbit-lab',name,kind:'prototype-in-memory',
	 sessions:{},drafts:{},locks:{},jobs:{},evaluations:{},comparisons:{},receipts:{},idempotency:{},
	 seq:{draft:0,lock:0,job:0,eval:0,receipt:0,session:0,comparison:0}};
}
export function createSession(p,name,draftId){
	const n=++p.seq.session;const id='s'+n;
	p.sessions[id]={session_id:id,name:name||('会话 '+n),project_id:p.project_id,draft_id:draftId||null,archived:false,created_label:'prototype'};
	return id;
}
export function archiveSession(p,sessionId){ // UX07：归档只改组织状态；作业属于项目，继续存在
	const s=p.sessions[sessionId];if(!s)return{ok:false,code:'E_NOT_FOUND',error:`会话 ${sessionId} 不存在`};
	s.archived=true;
	return{ok:true,active_jobs:listJobs(p).filter(j=>!TERMINAL_LOCAL.includes(j.state)).map(j=>j.job_id)};
}
const TERMINAL_LOCAL=['completed','cancelled','failed'];
export function createDraft(p,scene,opts={}){
	const v=validateScene(scene);if(!v.ok)return{ok:false,code:'E_VALIDATE',error:v.error};
	const n=++p.seq.draft,draft_id=nextId('d',n),revision_id=`${draft_id}-r1`;
	p.drafts[draft_id]={draft_id,scenario_id:'scenario-'+n,name:opts.name||scene.name,
	 revisions:{[revision_id]:{revision_id,draft_id,revision:1,content_hash:contentHash(scene),parent_revision_id:opts.parent_revision_id||null,source_revision_id:opts.source_revision_id||null,scene:clone(scene),label:opts.label||'初始版本'}},
	 head:revision_id,head_revision:1};
	if(opts.sessionId&&p.sessions[opts.sessionId])p.sessions[opts.sessionId].draft_id=draft_id;
	return{ok:true,draft_id,revision_id};
}

// ---------- 回执与幂等 ----------
function receipt(p,key,action,target,status,detail,extra={}){
	const hash=extra.change_hash||null;
	if(key){const prev=p.idempotency[key];
	 if(prev){ // 同键已存在：负载一致复用回执，不一致显式冲突，绝不二次写入（UX04/UX05）
		if(prev.change_hash!==hash)return{ok:false,code:'E_IDEMPOTENCY_CONFLICT',receipt_id:prev.receipt_id,error:`幂等键 ${key} 已被不同内容使用`,existing:p.receipts[prev.receipt_id]};
		return{ok:true,reused:true,receipt:p.receipts[prev.receipt_id]};
	 }}
	const n=++p.seq.receipt;const r={receipt_id:'rcp-'+n,idempotency_key:key||null,action,target,status,detail,session_id:extra.sessionId||null,change_hash:hash,protocol:'prototype-in-memory'};
	p.receipts[r.receipt_id]=r;
	if(key)p.idempotency[key]={receipt_id:r.receipt_id,change_hash:hash,action};
	return{ok:true,receipt:r};
}

// ---------- 草稿保存：CAS + 幂等（draft.save） ----------
export function saveDraft(p,draft_id,scene,baseRevisionId,opts={}){
	const draft=p.drafts[draft_id];
	if(!draft)return{ok:false,code:'E_NOT_FOUND',error:`草稿 ${draft_id} 不存在`};
	const change_hash=contentHash({action:'draft.save',draft_id,scene});
	const r=receipt(p,opts.key,'draft.save',{draft_id,base_revision:baseRevisionId},'applied','草稿版本已保存',{sessionId:opts.sessionId,change_hash});
	if(!r.ok)return r;if(r.reused)return r;
	const v=validateScene(scene);if(!v.ok){r.receipt.status='rejected';r.receipt.detail='校验失败：'+v.error;return{ok:false,code:'E_VALIDATE',error:v.error,receipt_id:r.receipt.idempotency_key?null:r.receipt.receipt_id};}
	if(draft.head!==baseRevisionId){ // CAS 只检查真实写目标；冲突保留缓冲，由调用方合并或分支（UX01/UX06）
		r.receipt.status='conflict';r.receipt.detail=`版本冲突：请求基线 ${baseRevisionId}，当前 head ${draft.head}`;
		return{ok:false,code:'E_CONFLICT',base:baseRevisionId,head:draft.head,
		 base_scene:draft.revisions[baseRevisionId]?.scene||null,local_scene:clone(scene),current_scene:draft.revisions[draft.head].scene,
		 receipt:r.receipt,error:`保存冲突：草稿已在其他会话前进到 ${label(draft.head)}；本地编辑基于 ${label(baseRevisionId)}`};}
	const n=++COUNTERS.rev;const revision_id=`${draft_id}-r${draft.head_revision+1}`;
	const parent=draft.revisions[draft.head];
	draft.revisions[revision_id]={revision_id,draft_id,revision:draft.head_revision+1,content_hash:contentHash(scene),parent_revision_id:parent.revision_id,source_revision_id:null,scene:clone(scene),label:opts.label||null};
	draft.head=revision_id;draft.head_revision++;draft.name=scene.name||draft.name;
	r.receipt.detail=`已保存 ${label(revision_id)}（基线 ${label(baseRevisionId)}）`;
	r.receipt.revision_id=revision_id;r.receipt.content_hash=contentHash(scene);
	return{ok:true,revision_id,receipt:r.receipt};
}
export const label=rid=>rid?rid.replace(/^[a-z]\d+-/,''):'—';

// ---------- draft.fork：从精确不可变来源创建新草稿 ----------
export function forkDraft(p,sourceRevisionId,opts={}){
	const[dao,rev]=splitRev(sourceRevisionId);const src=p.drafts[dao]?.revisions[sourceRevisionId];
	if(!src)return{ok:false,code:'E_NOT_FOUND',error:`来源版本 ${sourceRevisionId} 不存在`};
	const r=receipt(p,opts.key,'draft.fork',{source_revision:sourceRevisionId},'applied',`从 ${label(sourceRevisionId)} 创建分支`,{sessionId:opts.sessionId,change_hash:contentHash({action:'draft.fork',sourceRevisionId})});
	if(!r.ok)return r;
	if(r.reused)return{ok:true,reused:true,draft_id:r.receipt.draft_id,revision_id:r.receipt.revision_id,receipt:r.receipt};
	const made=createDraft(p,src.scene,{name:(src.scene.name||'场景')+'（分支）',parent_revision_id:sourceRevisionId,source_revision_id:sourceRevisionId,label:`fork 自 ${label(sourceRevisionId)}`});
	if(!made.ok)return made;r.receipt.draft_id=made.draft_id;r.receipt.revision_id=made.revision_id;
	return{ok:true,draft_id:made.draft_id,revision_id:made.revision_id,receipt:r.receipt};
}
const splitRev=rid=>{const m=/^(d\d+)-r\d+$/.exec(rid||'');return m?[m[1]]:[rid];};

// ---------- 三方合并：按对象 ID 的结构化字段级合并 ----------
export function threeWayMerge(base,local,current){
	const conflicts=[];
	const scalar=(path,b,l,c)=>{const lc=l!==b,cc=c!==b;if(lc&&cc&&l!==c){conflicts.push(path);return b;}return lc?l:c;};
	function mergeItem(b,l,c,path){
		if(!b){ // 双侧新增：内容一致取其一，不一致按冲突处理
			if(l&&c&&stableStringify(l)!==stableStringify(c)){conflicts.push(`${path}（双侧新增且内容不同）`);return clone(l);}
			return clone(l||c);
		}
		const out=clone(b);
		for(const k of Object.keys({...b,...l,...c})){
			if(k==='payloads'){out[k]=mergeList(b[k]||[],l?l[k]||[]:[],c?c[k]||[]:[],path+'.'+k);continue;}
			if(k==='id')continue;
			out[k]=scalar(path+'.'+k,b[k],l?l[k]:b[k],c?c[k]:b[k]);
		}
		return out;
	}
	function mergeList(bArr,lArr,cArr,path){
		const ids=[...new Set([...bArr,...lArr,...cArr].map(x=>x.id))];const out=[];
		for(const id of ids){
			const b=bArr.find(x=>x.id===id),l=lArr.find(x=>x.id===id),c=cArr.find(x=>x.id===id);
			const lb=l&&b&&stableStringify(stable(b))!==stableStringify(stable(l)),cb=c&&b&&stableStringify(stable(b))!==stableStringify(stable(c));
			if(b&&l&&!c){if(lb){conflicts.push(`${path}[${id}]（本地修改，另一方删除）`);out.push(l);}continue;}
			if(b&&!l&&c){if(cb){conflicts.push(`${path}[${id}]（另一方修改，本地删除）`);out.push(c);}continue;}
			out.push(mergeItem(b,l,c,`${path}[${id}]`));
		}
		return out;
	}
	const stable=x=>{const{...rest}=x;return rest;};
	const merged={...clone(base),
	 name:scalar('name',base.name,local.name,current.name),
	 duration:scalar('duration',base.duration,local.duration,current.duration),
	 seed:scalar('seed',base.seed,local.seed,current.seed),
	 assets:mergeList(base.assets,local.assets,current.assets,'assets'),
	 events:mergeList(base.events,local.events,current.events,'events')};
	if(!conflicts.length){const v=validateScene(merged);if(!v.ok){conflicts.push(v.error);}}
	return{scene:merged,conflicts,ok:conflicts.length===0};
}

// ---------- experiment.preflight：只读，不产生锁（UX36） ----------
export function preflight(p,revisionId){
	const[dao]=splitRev(revisionId);const rev=p.drafts[dao]?.revisions[revisionId];
	if(!rev)return{ok:false,code:'E_NOT_FOUND',error:`版本 ${revisionId} 不存在`};
	const s=rev.scene,blocking=[],warnings=[];
	if(s.assets.length<2)blocking.push('通信几何采样需要至少两个对象');
	for(const e of s.events){if(!s.assets.some(a=>a.id===e.target))blocking.push(`事件 ${e.id} 目标 ${e.target} 不存在`);if(eventTime(e)+e.duration>s.duration)blocking.push(`事件 ${e.id} 超出场景时长`);}
	if(s.events.length)warnings.push(`${s.events.length} 个可用性事件将进入指标；事件只改载荷可用性，不改变轨道`);
	if(s.duration>14400)warnings.push('时长超过 4 小时，采样样本较多');
	const cases=Math.max(0,s.assets.length-1),samples=Math.floor(s.duration/20)+1;
	return{ok:blocking.length===0,blocking,warnings,source_revision:revisionId,content_hash:rev.content_hash,
	 factors:{model:'circular-two-body@0.1',cadence_s:20,rule:'球形地球遮挡 LOS',duration_s:s.duration,seed:s.seed,reference:s.assets[0]?.id||null,assets:s.assets.map(a=>a.id),events:s.events.map(e=>e.id)},
	 not_consumed:['显示预测假设（分析显示，不进入运行指纹）','感知交付模式（演示视角，不改变采样指标）','地面测站与过境分析（显示层只读叠加）','太阳光照与地影事件时刻（显示层只读标记）'],
	 budget:{runs:cases,samples_per_run:samples,total_samples:cases*samples,worst_case_ms:cases*samples*0.01},
	 created_locks:0};
}

// ---------- experiment.freeze：从精确来源生成不可变锁（UX34/UX37） ----------
export function freezeExperiment(p,revisionId,opts={}){
	const[dao]=splitRev(revisionId);const rev=p.drafts[dao]?.revisions[revisionId];
	if(!rev)return{ok:false,code:'E_NOT_FOUND',error:`版本 ${revisionId} 不存在`};
	const pf=preflight(p,revisionId);if(!pf.ok)return{ok:false,code:'E_BLOCKING',error:'预检存在阻塞项：'+pf.blocking.join('；'),preflight:pf};
	for(const l of Object.values(p.locks)) // 相同来源版本+相同内容 → 复用同一把锁，来源不漂移（UX37）
	 if(l.source_revision_id===revisionId&&l.content_hash===rev.content_hash)
		return{ok:true,lock:l,reused:true,receipt:receipt(p,opts.key,'experiment.freeze',{source_revision:revisionId},'applied',`复用已有锁 ${l.lock_id}（来源 ${label(revisionId)}）`,{sessionId:opts.sessionId,change_hash:rev.content_hash}).receipt||null};
	const r=receipt(p,opts.key,'experiment.freeze',{source_revision:revisionId},'applied',`已从 ${label(revisionId)} 冻结实验`,{sessionId:opts.sessionId,change_hash:rev.content_hash});
	if(!r.ok)return r;if(r.reused)return{ok:true,lock:p.locks[r.receipt.lock_id],reused:true,receipt:r.receipt};
	const n=++p.seq.lock,lock_id=nextId('L',n);
	p.locks[lock_id]={lock_id,content_hash:rev.content_hash,source_revision_id:revisionId,scene:clone(rev.scene),created_label:'prototype',factors:pf.factors};
	r.receipt.lock_id=lock_id;r.receipt.detail=`已从 ${label(revisionId)} 冻结锁 ${lock_id}（head 可能已前移，来源保持精确）`;
	return{ok:true,lock:p.locks[lock_id],receipt:r.receipt};
}

// ---------- batch.submit / run 状态机：control_revision 与物理进度分离（UX09/UX31） ----------
export function runCase(scene,caseId){
	const ref=scene.assets[0],cadence=20;
	let samples=0,visible=0,min=Infinity,unavail=0;
	for(let t=0;t<=scene.duration;t+=cadence){samples++;
	 const a=stateAt(ref,t),b=stateAt(scene.assets.find(x=>x.id===caseId),t);
	 if(lineOfSight(a.position,b.position))visible++;
	 min=Math.min(min,norm(sub(a.position,b.position)));
	 if(scene.events.some(e=>e.target===caseId&&t>=eventTime(e)&&t<eventTime(e)+e.duration))unavail++;
	}
	return{case_id:caseId,samples,visible,visible_fraction:+(visible/samples).toFixed(4),
	 min_distance_km:+min.toFixed(1),unavailable_samples:unavail,availability_fraction:+((samples-unavail)/samples).toFixed(4),
	 reference:ref.id,cadence_s:cadence,duration_s:scene.duration};
}
export function submitBatch(p,lockId,opts={}){
	const lock=p.locks[lockId];
	if(!lock)return{ok:false,code:'E_NOT_FOUND',error:`锁 ${lockId} 不存在`};
	const change_hash=contentHash({action:'batch.submit',lockId});
	const r=receipt(p,opts.key,'batch.submit',{lock_id:lockId},'accepted','作业已受理',{sessionId:opts.sessionId,change_hash});
	if(!r.ok)return r;
	if(r.reused){const j=p.jobs[r.receipt.job_id];return{ok:true,job:j,reused:true,receipt:r.receipt};}
	const n=++p.seq.job,job_id=nextId('J',n);
	// 首个资产固定为参考体；每个其余资产是一个 RunPlan 样本槽位（与预检预算一致）
	const plans=lock.scene.assets.slice(1).map((a,i)=>({run_plan_id:`${job_id}-p${i+1}`,case_id:a.id,replicate_index:0,state:'pending'}));
	if(!plans.length)return{ok:false,code:'E_BLOCKING',error:'锁内可用研究样本不足（需要至少两个对象）'};
	p.jobs[job_id]={job_id,lock_id:lockId,state:'queued',plans,control_revision:0,commit_seq:0,results:{},created_label:'prototype',requested_pause:false};
	r.receipt.job_id=job_id;r.receipt.detail=`作业 ${job_id} 已受理：${plans.length} 个运行计划（锁 ${lockId}，来源 ${label(lock.source_revision_id)}）`;
	return{ok:true,job:p.jobs[job_id],receipt:r.receipt};
}
const TERMINAL=['completed','cancelled','failed'];
export function jobTick(p,job_id){ // 每次推进一个确定边界：pausing→paused 先于继续计算（UX09）
	const j=p.jobs[job_id];if(!j||TERMINAL.includes(j.state)||j.state==='paused')return j;
	if(j.state==='pausing'){j.state='paused';return j;}
	if(j.state==='queued')j.state='running';
	const next=j.plans.find(x=>x.state==='pending');
	if(!next){j.state='completed';j.finished_label='prototype';return j;}
	next.state='running';j.commit_seq++;
	j.results[next.case_id]=runCase(p.locks[j.lock_id].scene,next.case_id);
	next.state='done';j.commit_seq++;
	if(j.plans.every(x=>x.state==='done'))j.state='completed';
	return j;
}
export function pauseJob(p,job_id,opts={}){
	const j=p.jobs[job_id];if(!j)return{ok:false,code:'E_NOT_FOUND',error:`作业 ${job_id} 不存在`};
	if(TERMINAL.includes(j.state))return{ok:false,code:'E_ALREADY_TERMINAL',state:j.state,error:`作业已是终态 ${j.state}`};
	if(j.state==='paused')return{ok:true,state:j.state};
	j.state='pausing';j.control_revision++; // 控制意图递增 control_revision，不影响物理 commit_seq（UX31）
	return{ok:true,state:'pausing',control_revision:j.control_revision};
}
export function resumeJob(p,job_id,opts={}){
	const j=p.jobs[job_id];if(!j)return{ok:false,code:'E_NOT_FOUND',error:`作业 ${job_id} 不存在`};
	if(TERMINAL.includes(j.state))return{ok:false,code:'E_ALREADY_TERMINAL',state:j.state,error:`作业已是终态 ${j.state}`};
	if(j.state!=='paused'&&j.state!=='pausing')return{ok:false,code:'E_INVALID_STATE',state:j.state,error:'只有已暂停的作业可以继续'};
	j.state='running';j.control_revision++;
	return{ok:true,state:'running',control_revision:j.control_revision};
}
export function cancelJob(p,job_id,opts={}){ // CAS 决定唯一终态（UX10）
	const j=p.jobs[job_id];if(!j)return{ok:false,code:'E_NOT_FOUND',error:`作业 ${job_id} 不存在`};
	if(TERMINAL.includes(j.state))return{ok:true,status:'already-terminal',state:j.state};
	const r=receipt(p,opts.key,'job.cancel',{job_id},'applied',`作业 ${job_id} 已请求取消`,{sessionId:opts.sessionId});
	j.state='cancelled';j.control_revision++;
	for(const plan of j.plans)if(plan.state!=='done')plan.state='cancelled';
	return{ok:true,status:'requested',state:'cancelled',receipt:r.receipt};
}
export function jobSummary(j){
	const c=k=>j.plans.filter(x=>x.state===k).length;
	return{planned:j.plans.length,done:c('done'),cancelled:c('cancelled'),running:c('running'),pending:c('pending'),state:j.state,commit_seq:j.commit_seq,control_revision:j.control_revision};
}

// ---------- evaluation：完成时冻结 source snapshot（UX11/UX22/UX25） ----------
export function buildEvaluation(p,job_id){
	const j=p.jobs[job_id];if(!j)return{ok:false,code:'E_NOT_FOUND',error:`作业 ${job_id} 不存在`};
	if(j.state!=='completed')return{ok:false,code:'E_INVALID_STATE',state:j.state,error:'只有完成的作业可以固定评价'};
	if(j.evaluation_id&&p.evaluations[j.evaluation_id])return{ok:true,evaluation:p.evaluations[j.evaluation_id],reused:true};
	const n=++p.seq.eval,evaluation_id=nextId('E',n),lock=p.locks[j.lock_id];
	const missing=j.plans.filter(x=>x.state!=='done').map(x=>x.case_id);
	p.evaluations[evaluation_id]={evaluation_id,job_id,lock_id:j.lock_id,
	 source_snapshot:{lock_id:j.lock_id,content_hash:lock.content_hash,source_revision_id:lock.source_revision_id,scene_digest:contentHash(lock.scene)},
	 metrics:Object.values(j.results),denominator:jobSummary(j),missing_values:missing,created_label:'prototype'};
	j.evaluation_id=evaluation_id;
	return{ok:true,evaluation:p.evaluations[evaluation_id]};
}
export function listEvaluations(p){return Object.values(p.evaluations);}
export function listJobs(p){return Object.values(p.jobs);}
export function listLocks(p){return Object.values(p.locks);}
export function draftHead(p,draft_id){const d=p.drafts[draft_id];return d?{head:d.head,head_revision:d.head_revision,scene:d.revisions[d.head].scene,name:d.name}:null;}
export function getRevision(p,revisionId){const[d]=splitRev(revisionId);return p.drafts[d]?.revisions[revisionId]||null;}

// ---------- draft.restore_revision：把历史版本内容恢复为新的 head 修订（不倒退历史） ----------
export function restoreRevision(p,draft_id,sourceRevisionId,opts={}){
	const draft=p.drafts[draft_id];
	if(!draft)return{ok:false,code:'E_NOT_FOUND',error:`草稿 ${draft_id} 不存在`};
	const src=draft.revisions[sourceRevisionId];
	if(!src)return{ok:false,code:'E_NOT_FOUND',error:`版本 ${sourceRevisionId} 不存在`};
	if(src.revision_id===draft.head)return{ok:false,code:'E_INVALID',error:`${label(sourceRevisionId)} 已是当前 head；恢复操作只对历史版本有意义`};
	const r=saveDraft(p,draft_id,src.scene,draft.head,{...opts,label:`恢复自 ${label(sourceRevisionId)}`});
	if(r.ok&&r.receipt)r.receipt.detail=`已从 ${label(sourceRevisionId)} 恢复为 ${label(r.revision_id)}（历史保留，不倒退）`;
	return r;
}

// ---------- comparison.create：显式比较计划（§40.3），固定双方来源与差异声明 ----------
const upId=x=>typeof x==='string'?x.toUpperCase():x;
export function createComparison(p,evalAId,evalBId,opts={}){
	const a=p.evaluations[upId(evalAId)]||p.evaluations[evalAId],b=p.evaluations[upId(evalBId)]||p.evaluations[evalBId];
	if(!a||!b)return{ok:false,code:'E_NOT_FOUND',error:'评价不存在；先对完成的作业固定评价'};
	const change_hash=contentHash({action:'comparison.create',a:a.evaluation_id,b:b.evaluation_id,source_hashes:[a.source_snapshot.content_hash,b.source_snapshot.content_hash]});
	const r=receipt(p,opts.key,'comparison.create',{evaluations:[a.evaluation_id,b.evaluation_id]},'applied',`已创建比较（${a.evaluation_id} ↔ ${b.evaluation_id}）`,{sessionId:opts.sessionId,change_hash});
	if(!r.ok)return r;
	if(r.reused){const c=p.comparisons[r.receipt.comparison_id];return{ok:true,comparison:c,reused:true,receipt:r.receipt};}
	const fa=p.locks[a.lock_id]?.factors,fb=p.locks[b.lock_id]?.factors;
	const comparable=!!fa&&!!fb&&fa.model===fb.model&&fa.cadence_s===fb.cadence_s&&fa.rule===fb.rule;
	const caseIds=[...new Set([...a.metrics.map(m=>m.case_id),...b.metrics.map(m=>m.case_id)])];
	const rows=caseIds.map(c=>({case_id:c,a:a.metrics.find(m=>m.case_id===c)||null,b:b.metrics.find(m=>m.case_id===c)||null}));
	const differences=[];
	if(a.source_snapshot.source_revision_id!==b.source_snapshot.source_revision_id)differences.push(`来源修订不同：${label(a.source_snapshot.source_revision_id)} vs ${label(b.source_snapshot.source_revision_id)}`);
	if(a.source_snapshot.content_hash!==b.source_snapshot.content_hash)differences.push('输入内容摘要不同');
	if(fa?.duration_s!==fb?.duration_s)differences.push(`时长不同：${fa?.duration_s}s vs ${fb?.duration_s}s`);
	const n=++p.seq.comparison,comparison_id=nextId('C',n);
	p.comparisons[comparison_id]={comparison_id,refs:[a.evaluation_id,b.evaluation_id],comparable,differences,rows,
	 shared:comparable?{model:fa.model,cadence_s:fa.cadence_s,rule:fa.rule}:{model:'不一致'},
	 denominators:{[a.evaluation_id]:a.denominator,[b.evaluation_id]:b.denominator},created_label:'prototype'};
	r.receipt.comparison_id=comparison_id;
	return{ok:true,comparison:p.comparisons[comparison_id],receipt:r.receipt};
}

// ---------- 回执查询（§41.4 queryReceipt）：按 ID 只读检索 ----------
export function queryReceipt(p,receiptId){return p.receipts[receiptId]||null;}
export function listReceipts(p,limit=12){return Object.values(p.receipts).slice(-limit).reverse();}
export function listComparisons(p){return Object.values(p.comparisons);}

// ---------- WorkspaceSnapshot（§37.4 原型）：序列化、校验与恢复规范化 ----------
// 只保存合成数据与对象引用；不保存凭据、权限令牌或可访问未来事件的缓存。
// 恢复次序：校验快照 → 解析对象 → 规范化作业状态；旧回执只可查询，不自动重新执行任何动作。
export const SNAPSHOT_VERSION='orbit-workbench-2';
export function snapshotProject(p){
	return {version:SNAPSHOT_VERSION,saved_at_epoch:Date.now(),project:clone(p)};
}
export function restoreProject(snap){
	if(!snap||snap.version!==SNAPSHOT_VERSION||!snap.project||typeof snap.project!=='object')return{ok:false,error:'快照缺失、版本不匹配或已损坏'};
	const p=snap.project;
	if(!p.drafts||!p.sessions||!p.receipts)return{ok:false,error:'快照缺少项目对象'};
	// 排队/运行中/暂停中的计算无法跨页面刷新继续：规范化为 paused，等待用户显式继续；不自动重跑
	const normalized_jobs=[];
	for(const j of Object.values(p.jobs||{})){
		if(['queued','running','pausing'].includes(j.state)){j.state='paused';j.control_revision=(j.control_revision||0)+1;j.resumed_from_snapshot=true;normalized_jobs.push(j.job_id);}
	}
	return{ok:true,project:p,normalized_jobs};
}

// ---------- 默认项目装配：模板 → 草稿 r1（会话只持引用，不克隆场景） ----------
export function bootstrapProject(defaultScene){
	const p=createProject();
	const made=createDraft(p,defaultScene,{name:defaultScene.name,label:'模板 初始版本'});
	if(!made.ok)throw new Error('模板场景校验失败：'+made.error);
	p.default_draft_id=made.draft_id;
	return p;
}
