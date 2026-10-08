import test from 'node:test';import assert from 'node:assert/strict';
import {DEFAULT_SCENE,clone,validateScene} from '../src/domain.js';
import {bootstrapProject,createSession,saveDraft,forkDraft,preflight,freezeExperiment,submitBatch,jobTick,pauseJob,resumeJob,cancelJob,jobSummary,buildEvaluation,threeWayMerge,contentHash,listEvaluations,getRevision,label} from '../src/app.js';

function freshProject(){const p=bootstrapProject(DEFAULT_SCENE);createSession(p,'会话 A',p.default_draft_id);createSession(p,'会话 B',p.default_draft_id);return p;}
const editAltitude=(scene,id,alt)=>({...scene,assets:scene.assets.map(a=>a.id===id?{...a,altitude:alt}:a)});
const headScene=p=>p.drafts[p.default_draft_id].revisions[p.default_draft_id+'-r'+p.drafts[p.default_draft_id].head_revision].scene;

test('content hash is deterministic and input-sensitive',()=>{
 assert.equal(contentHash(DEFAULT_SCENE),contentHash(clone(DEFAULT_SCENE)));
 assert.notEqual(contentHash(DEFAULT_SCENE),contentHash(editAltitude(DEFAULT_SCENE,'terra-01',601)));
 assert.equal(contentHash({a:1,b:2}),contentHash({b:2,a:1})); // 键序规范化，不改变摘要
});

test('UX01 two sessions save same draft: second gets CAS conflict, content preserved',()=>{
 const p=freshProject(),d=p.default_draft_id,r1=p.drafts[d].head;
 const localB=clone(headScene(p));
 const a=saveDraft(p,d,editAltitude(headScene(p),'terra-01',700),r1,{sessionId:'s1',key:'k-a'});
 assert.equal(a.ok,true);assert.equal(p.drafts[d].head,'d1-r2');
 const b=saveDraft(p,d,editAltitude(localB,'echo-02',640),r1,{sessionId:'s2',key:'k-b'});
 assert.equal(b.ok,false);assert.equal(b.code,'E_CONFLICT');
 assert.equal(p.drafts[d].head,'d1-r2'); // B 未写入
 assert.equal(headScene(p).assets.find(x=>x.id==='terra-01').altitude,700); // A 内容保留
 assert.equal(b.local_scene.assets.find(x=>x.id==='echo-02').altitude,640); // B 缓冲未丢
 assert.equal(b.current_scene.assets.find(x=>x.id==='terra-01').altitude,700);
 const m=threeWayMerge(b.base_scene,b.local_scene,b.current_scene);
 assert.equal(m.ok,true);assert.equal(validateScene(m.scene).ok,true);
 assert.equal(m.scene.assets.find(x=>x.id==='terra-01').altitude,700);
 assert.equal(m.scene.assets.find(x=>x.id==='echo-02').altitude,640);
 const s=saveDraft(p,d,m.scene,'d1-r2',{sessionId:'s2',key:'k-b2'});
 assert.equal(s.ok,true);assert.equal(p.drafts[d].head,'d1-r3');
});

test('UX01b conflicting edit of same field cannot auto-merge',()=>{
 const p=freshProject(),d=p.default_draft_id,r1=p.drafts[d].head;
 saveDraft(p,d,editAltitude(headScene(p),'terra-01',700),r1,{key:'a'});
 const base=p.drafts[d].revisions['d1-r1'].scene;
 const conflict=saveDraft(p,d,editAltitude(base,'terra-01',800),'d1-r1',{key:'b'});
 assert.equal(conflict.ok,false);
 const m=threeWayMerge(base,editAltitude(base,'terra-01',800),headScene(p));
 assert.equal(m.ok,false); // 同一字段双方都改 → 冲突，不静默选择
});

test('UX04/UX05 idempotency: same key same payload reuses receipt; same key new payload rejected',()=>{
 const p=freshProject(),d=p.default_draft_id,head=p.drafts[d].head;
 const scene=editAltitude(headScene(p),'terra-01',650);
 const first=saveDraft(p,d,clone(scene),head,{key:'op-1',sessionId:'s1'});
 assert.equal(first.ok,true);
 const retry=saveDraft(p,d,clone(scene),head,{key:'op-1',sessionId:'s1'});
 assert.equal(retry.ok,true);assert.equal(retry.reused,true);
 assert.equal(retry.receipt.receipt_id,first.receipt.receipt_id); // 同一回执
 assert.equal(p.drafts[d].head_revision,2); // 没有第二次写入
 const other=saveDraft(p,d,editAltitude(headScene(p),'terra-01',660),head,{key:'op-1'});
 assert.equal(other.ok,false);assert.equal(other.code,'E_IDEMPOTENCY_CONFLICT');
 assert.equal(p.drafts[d].head_revision,2);
});

test('UX36 preflight creates zero locks and changes nothing',()=>{
 const p=freshProject(),d=p.default_draft_id,before=JSON.stringify([p.locks,p.drafts[d].head,p.seq]);
 const pf=preflight(p,p.drafts[d].head);
 assert.equal(pf.ok,true);assert.equal(pf.created_locks,0);
 assert.equal(Object.keys(p.locks).length,0);
 assert.equal(JSON.stringify([p.locks,p.drafts[d].head,p.seq]),before);
 assert.equal(pf.budget.runs,DEFAULT_SCENE.assets.length-1); // 参考体之外的每个资产一个 RunPlan
 assert.ok(pf.factors.not_consumed||pf.not_consumed.length>=2); // 显示控件不进入运行指纹
});

test('UX34 freeze older revision while head advanced; source stays precise',()=>{
 const p=freshProject(),d=p.default_draft_id,r1=p.drafts[d].head;
 saveDraft(p,d,editAltitude(headScene(p),'terra-01',700),r1,{key:'a'}); // head → r2
 const f=freezeExperiment(p,r1,{key:'f1'}); // 冻结 r1
 assert.equal(f.ok,true);
 assert.equal(f.lock.source_revision_id,r1);
 assert.equal(f.lock.scene.assets.find(x=>x.id==='terra-01').altitude,600); // r1 的内容
 assert.equal(contentHash(f.lock.scene),getRevision(p,r1).content_hash);
});

test('UX37 freeze retry with original key and revision reuses same lock, no drift',()=>{
 const p=freshProject(),d=p.default_draft_id,r1=p.drafts[d].head;
 saveDraft(p,d,editAltitude(headScene(p),'terra-01',700),r1,{key:'a'});
 const f1=freezeExperiment(p,r1,{key:'freeze-1'});
 const f2=freezeExperiment(p,r1,{key:'freeze-1'}); // 回执丢失后原键重试
 assert.equal(f2.ok,true);assert.equal(f2.reused||f2.lock.lock_id===f1.lock.lock_id,true);
 assert.equal(f2.lock.lock_id,f1.lock.lock_id);
 const f3=freezeExperiment(p,r1,{key:'freeze-1b'}); // 不同键、相同来源
 assert.equal(f3.lock.lock_id,f1.lock.lock_id); // 相同版本+相同内容 → 同一把锁
 saveDraft(p,d,editAltitude(headScene(p),'terra-01',750),'d1-r2',{key:'a2'});
 const f4=freezeExperiment(p,p.drafts[d].head,{key:'freeze-2'});
 assert.notEqual(f4.lock.lock_id,f1.lock.lock_id); // 新内容 → 新锁
 assert.equal(f4.lock.source_revision_id,p.drafts[d].head);
});

test('UX11/UX22 queued job and evaluation stay frozen when draft moves on',()=>{
 const p=freshProject(),d=p.default_draft_id,head=p.drafts[d].head;
 const lock=freezeExperiment(p,head,{key:'f'}).lock;
 const job=submitBatch(p,lock.lock_id,{key:'j'}).job;
 assert.equal(job.state,'queued');
 jobTick(p,job.job_id); // 第一个 case 完成
 saveDraft(p,d,editAltitude(headScene(p),'terra-01',900),head,{key:'edit-after-submit'});
 assert.equal(p.drafts[d].head,'d1-r2'); // 编辑不影响队列中的作业
 while(!['completed','cancelled','paused'].includes(p.jobs[job.job_id].state))jobTick(p,job.job_id);
 assert.equal(p.jobs[job.job_id].state,'completed');
 assert.equal(p.jobs[job.job_id].lock_id,lock.lock_id);
 const ev=buildEvaluation(p,job.job_id).evaluation;
 assert.equal(ev.source_snapshot.source_revision_id,head);
 assert.equal(ev.source_snapshot.content_hash,getRevision(p,head).content_hash);
 const sceneBefore=JSON.stringify(ev.metrics);
 saveDraft(p,d,editAltitude(headScene(p),'terra-01',950),'d1-r2',{key:'edit-again'});
 assert.equal(JSON.stringify(ev.metrics),sceneBefore); // 历史结果字节不变
 assert.equal(ev.metrics.length,DEFAULT_SCENE.assets.length-1); // 每个非参考体资产一个 RunPlan
});

test('run metrics are deterministic and match frozen scene geometry',()=>{
 const p=freshProject(),d=p.default_draft_id;
 const lock=freezeExperiment(p,p.drafts[d].head,{key:'f'}).lock;
 const job=submitBatch(p,lock.lock_id,{key:'j'}).job;
 while(job.state!=='completed')jobTick(p,job.job_id);
 const ev=buildEvaluation(p,job.job_id).evaluation;
 assert.equal(lock.scene.assets.length-1,ev.metrics.length); // 分母=RunPlan 数，不受筛选影响
 for(const m of ev.metrics){assert.ok(m.samples>=Math.floor(lock.scene.duration/20));assert.ok(m.visible_fraction>=0&&m.visible_fraction<=1);assert.ok(m.min_distance_km>0);}
 const ev2=buildEvaluation(p,job.job_id);assert.equal(ev2.reused,true);
});

test('UX09/UX31 pause reaches PAUSED at boundary; control_revision separate from commit_seq',()=>{
 const p=freshProject(),d=p.default_draft_id;
 const lock=freezeExperiment(p,p.drafts[d].head,{key:'f'}).lock;
 const job=submitBatch(p,lock.lock_id,{key:'j'}).job;
 jobTick(p,job.job_id);
 const commitsAtPause=p.jobs[job.job_id].commit_seq;
 const pause=pauseJob(p,job.job_id,{key:'p'});
 assert.equal(pause.state,'pausing');assert.equal(pause.control_revision,1);
 assert.equal(job.commit_seq,commitsAtPause); // 控制意图不推进物理提交
 jobTick(p,job.job_id);
 assert.equal(job.state,'paused'); // 边界后才 PAUSED
 assert.equal(job.commit_seq,commitsAtPause);
 const r=resumeJob(p,job.job_id,{key:'r'});
 assert.equal(r.state,'running');assert.equal(r.control_revision,2);
 while(job.state!=='completed')jobTick(p,job.job_id);
});

test('UX10 cancel CAS: terminal job reports already-terminal, no double state change',()=>{
 const p=freshProject(),d=p.default_draft_id;
 const lock=freezeExperiment(p,p.drafts[d].head,{key:'f'}).lock;
 const job=submitBatch(p,lock.lock_id,{key:'j'}).job;
 const c1=cancelJob(p,job.job_id,{key:'c'});
 assert.equal(c1.status,'requested');assert.equal(job.state,'cancelled');
 const c2=cancelJob(p,job.job_id,{key:'c2'});
 assert.equal(c2.status,'already-terminal');assert.equal(job.state,'cancelled');
 assert.ok(job.plans.some(x=>x.state==='cancelled')); // 未完成槽位仍在总体中
 const s=jobSummary(job);assert.equal(s.planned,DEFAULT_SCENE.assets.length-1);
 assert.equal(s.done+s.cancelled,s.planned);
 const ev=buildEvaluation(p,job.job_id);assert.equal(ev.ok,false); // 取消的作业不产生评价
});

test('UX02 receipts record originating session; late retry keeps original context',()=>{
 const p=freshProject(),d=p.default_draft_id,head=p.drafts[d].head;
 const r=saveDraft(p,d,editAltitude(headScene(p),'terra-01',680),head,{key:'late-1',sessionId:'s1'});
 assert.equal(r.receipt.session_id,'s1');
 const retry=saveDraft(p,d,editAltitude(headScene(p),'terra-01',680),head,{key:'late-1',sessionId:'s2'}); // B 会话迟到重试
 assert.equal(retry.ok,true);assert.equal(retry.reused,true);
 assert.equal(retry.receipt.session_id,'s1'); // 回执仍归属原上下文
});

test('UX29-style binding dedup helper and fork from result source',()=>{
 const p=freshProject(),d=p.default_draft_id,head=p.drafts[d].head;
 saveDraft(p,d,editAltitude(headScene(p),'terra-01',700),head,{key:'a'});
 const f=forkDraft(p,'d1-r1',{key:'fork-1'});
 assert.equal(f.ok,true);assert.notEqual(f.draft_id,d);
 assert.equal(p.drafts[f.draft_id].revisions[f.revision_id].source_revision_id,'d1-r1');
 assert.equal(p.drafts[f.draft_id].revisions[f.revision_id].scene.assets.find(x=>x.id==='terra-01').altitude,600);
 assert.equal(p.drafts[d].head,'d1-r2'); // 原草稿不受影响
 const nf=forkDraft(p,'d1-r1',{key:'fork-1'});
 assert.equal(nf.reused,true);assert.equal(nf.draft_id,f.draft_id);
 assert.equal(label('d1-r3'),'r3');
});

test('merge keeps event additions from both sides and drops clean removals',()=>{
 const base=clone(DEFAULT_SCENE);
 const local=clone(base);local.events.push({id:'event-9',kind:'temporary-unavailable',target:'relay-03',trigger:'scheduled',at:2500,duration:120,seed:1,note:'本地新增'});
 const current=clone(base);current.events=current.events.filter(e=>e.id!=='event-2'); // 另一方删除 event-2（本地未改）
 const m=threeWayMerge(base,local,current);
 assert.equal(m.ok,true);
 assert.ok(m.scene.events.some(e=>e.id==='event-9'));
 assert.ok(!m.scene.events.some(e=>e.id==='event-2'));
 assert.ok(m.scene.events.some(e=>e.id==='event-1'));
});

// ---------- 0.2 迭代二：恢复 / 比较 / 回执查询 / 会话归档 ----------
import {restoreRevision,createComparison,queryReceipt,listReceipts,archiveSession,submitBatch as sb2} from '../src/app.js';

test('draft.restore_revision creates new head with old content; history intact',()=>{
 const p=freshProject(),d=p.default_draft_id,r1=p.drafts[d].head;
 saveDraft(p,d,editAltitude(headScene(p),'terra-01',700),r1,{key:'a'}); // r2
 saveDraft(p,d,editAltitude(headScene(p),'terra-01',750),'d1-r2',{key:'b'}); // r3
 const r=restoreRevision(p,d,'d1-r1',{key:'restore-1'});
 assert.equal(r.ok,true);
 assert.equal(p.drafts[d].head,'d1-r4');
 assert.equal(headScene(p).assets.find(x=>x.id==='terra-01').altitude,600); // r1 内容
 assert.equal(p.drafts[d].revisions['d1-r4'].parent_revision_id,'d1-r3'); // 接在 r3 之后
 assert.equal(Object.keys(p.drafts[d].revisions).length,4); // 历史全部保留
 assert.ok(p.drafts[d].revisions['d1-r2']); // r2/r3 未被删除或改写
 assert.equal(p.drafts[d].revisions['d1-r3'].content_hash,getRevision(p,'d1-r3').content_hash);
 const again=restoreRevision(p,d,'d1-r4',{key:'restore-2'}); // 对 head 恢复无意义
 assert.equal(again.ok,false);assert.equal(again.code,'E_INVALID');
});

test('comparison.create aligns cases per id, declares differences, is receipted and idempotent',()=>{
 const p=freshProject(),d=p.default_draft_id;
 const runToEval=(lock)=>{const j=submitBatch(p,lock.lock_id,{key:'j:'+lock.lock_id}).job;while(j.state!=='completed')jobTick(p,j.job_id);return buildEvaluation(p,j.job_id).evaluation;};
 const r1=p.drafts[d].head;
 const lockA=freezeExperiment(p,r1,{key:'fa'}).lock;
 saveDraft(p,d,editAltitude(headScene(p),'terra-01',700),r1,{key:'e1'}); // r2
 const lockB=freezeExperiment(p,p.drafts[d].head,{key:'fb'}).lock;
 const ea=runToEval(lockA),eb=runToEval(lockB);
 const c=createComparison(p,ea.evaluation_id,eb.evaluation_id,{key:'cmp-1'});
 assert.equal(c.ok,true);
 assert.equal(c.comparison.rows.length,DEFAULT_SCENE.assets.length-1); // 案例按 id 对齐
 for(const row of c.comparison.rows){assert.ok(row.a);assert.ok(row.b);assert.equal(row.case_id,row.a.case_id);assert.equal(row.case_id,row.b.case_id);}
 assert.equal(c.comparison.comparable,true); // 同模型、同采样、同规则
 assert.ok(c.comparison.differences.some(x=>x.includes('来源修订不同')));
 assert.ok(c.comparison.differences.some(x=>x.includes('内容摘要不同')));
 const retry=createComparison(p,ea.evaluation_id,eb.evaluation_id,{key:'cmp-1'});
 assert.equal(retry.reused,true);assert.equal(retry.comparison.comparison_id,c.comparison.comparison_id);
 const bad=createComparison(p,'E-nope',eb.evaluation_id,{key:'cmp-2'});
 assert.equal(bad.ok,false);assert.equal(bad.code,'E_NOT_FOUND');
});

test('queryReceipt returns exact stored receipt; list is read-only',()=>{
 const p=freshProject(),d=p.default_draft_id,head=p.drafts[d].head;
 const saved=saveDraft(p,d,editAltitude(headScene(p),'terra-01',690),head,{key:'q-1',sessionId:'s1'});
 const got=queryReceipt(p,saved.receipt.receipt_id);
 assert.equal(got.receipt_id,saved.receipt.receipt_id);
 assert.equal(got.idempotency_key,'q-1');assert.equal(got.session_id,'s1');
 assert.equal(queryReceipt(p,'rcp-nope'),null);
 const before=JSON.stringify(p.receipts);
 listReceipts(p,5);
 assert.equal(JSON.stringify(p.receipts),before); // 只读
});

test('archiveSession keeps jobs alive; project-level pump unaffected (UX07)',()=>{
 const p=freshProject(),d=p.default_draft_id;
 const lock=freezeExperiment(p,p.drafts[d].head,{key:'f'}).lock;
 const job=submitBatch(p,lock.lock_id,{key:'j'}).job;
 const arch=archiveSession(p,'s1');
 assert.equal(arch.ok,true);assert.equal(p.sessions.s1.archived,true);
 assert.deepEqual(arch.active_jobs,[job.job_id]); // 提示仍有活动作业
 jobTick(p,job.job_id); // 计算不因归档停止
 assert.equal(job.plans[0].state,'done');
 assert.equal(p.jobs[job.job_id].state,'running');
 const missing=archiveSession(p,'s-nope');assert.equal(missing.ok,false);
});

// ---------- 迭代三：WorkspaceSnapshot（§37.4 原型） ----------
import {snapshotProject,restoreProject,SNAPSHOT_VERSION,resumeJob as rj} from '../src/app.js';

test('snapshot round-trips project objects and receipts; retry after restore reuses receipt',()=>{
 const p=freshProject(),d=p.default_draft_id,head=p.drafts[d].head;
 const saved=saveDraft(p,d,editAltitude(headScene(p),'terra-01',705),head,{key:'snap-1',sessionId:'s1'});
 const lock=freezeExperiment(p,p.drafts[d].head,{key:'snap-f'}).lock;
 const snap=snapshotProject(p);
 const r=restoreProject(snap);
 assert.equal(r.ok,true);
 const q=r.project;
 assert.equal(q.drafts[d].head,p.drafts[d].head);
 assert.equal(contentHash(q.drafts[d].revisions[q.drafts[d].head].scene),contentHash(p.drafts[d].revisions[p.drafts[d].head].scene));
 assert.equal(Object.keys(q.receipts).length,Object.keys(p.receipts).length);
 // 恢复后同一幂等键重试 → 复用同一回执，不产生第二次写入
 const retry=saveDraft(q,d,editAltitude(headScene(q),'terra-01',705),q.drafts[d].head,{key:'snap-1',sessionId:'s1'});
 assert.equal(retry.ok,true);assert.equal(retry.reused,true);
 assert.equal(retry.receipt.receipt_id,saved.receipt.receipt_id);
 assert.equal(q.drafts[d].head_revision,p.drafts[d].head_revision);
});

test('restore normalizes interrupted jobs to paused; user resumes explicitly, no auto rerun',()=>{
 const p=freshProject(),d=p.default_draft_id;
 const lock=freezeExperiment(p,p.drafts[d].head,{key:'f'}).lock;
 const job=submitBatch(p,lock.lock_id,{key:'j'}).job;
 jobTick(p,job.job_id); // 1/2 完成，仍在运行
 assert.equal(job.state,'running');
 const r=restoreProject(snapshotProject(p));
 assert.equal(r.ok,true);
 assert.deepEqual(r.normalized_jobs,[job.job_id]);
 const q=r.project,qj=q.jobs[job.job_id];
 assert.equal(qj.state,'paused'); // 不自动重跑，等待显式继续
 assert.equal(qj.plans.filter(x=>x.state==='done').length,1); // 已提交边界保留
 assert.equal(qj.control_revision,1);
 const res=rj(q,job.job_id,{key:'resume-after-restore'});
 assert.equal(res.state,'running');
 while(qj.state!=='completed')jobTick(q,job.job_id);
 const ev=buildEvaluation(q,job.job_id);
 assert.equal(ev.ok,true); // 恢复继续后仍可固定评价
 assert.equal(ev.evaluation.source_snapshot.source_revision_id,lock.source_revision_id);
});

test('restore rejects missing, malformed, or version-mismatched snapshots',()=>{
 assert.equal(restoreProject(null).ok,false);
 assert.equal(restoreProject({}).ok,false);
 assert.equal(restoreProject({version:'orbit-workbench-1',project:{drafts:{},sessions:{},receipts:{}}}).ok,false);
 const bad=restoreProject({version:SNAPSHOT_VERSION,project:{foo:1}});
 assert.equal(bad.ok,false);
});
