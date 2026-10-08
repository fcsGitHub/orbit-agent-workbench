// 统一工具目录与有限命令解析。命名遵循设计 §41.3 动作目录：
// 显示动作（display.*／view.*）只改呈现游标，不进入领域写事务；
// 领域动作（draft.*／experiment.*／batch.*／job.*）经由应用核心的 CAS+幂等+回执提交链。
export const TOOL_CATALOG=[
 {name:'workspace.open',description:'打开或聚焦右侧工作区标签',input:{kind:'orbit | scenario | models | experiments | replay | terminal | browser | files'},notes:'同一 binding 默认聚焦已有标签；显式新建才创建第二份'},
 {name:'view.set',description:'切换三维分析视图（显示预设，不改仿真 frame）',input:{view:'global | relative | comm | observation'}},
 {name:'view.select',description:'选择场景对象（呈现状态）',input:{id:'asset ID'}},
 {name:'view.follow',description:'开启或关闭镜头跟随选中对象的已交付样本位置（显示动作）',input:{enabled:'boolean',id:'可选：跟随目标对象 ID'}},
 {name:'station.add',description:'按纬度/经度添加地面测站（显示层分析；也可直接点击地球）',input:{lat:'纬度 -90..90 度',lon:'经度 -180..180 度',name:'可选名称'}},
 {name:'station.remove',description:'按 ID 或名称移除地面测站',input:{id:'测站 ID 或名称'}},
 {name:'stations.list',description:'列出已添加的地面测站',input:{}},
 {name:'passes.list',description:'列出当前时刻之后的过境窗口（掩蔽角可调，步进 10 秒近似）',input:{station_id:'可选：限定测站',asset_id:'可选：限定对象',mask_deg:'可选：掩蔽角度数，默认用面板设置'}},
 {name:'passes.joint',description:'列出多站联合覆盖（接力观测）窗口：任一站可见即算覆盖，coverage 按站交接排列',input:{asset_id:'可选：限定对象',mask_deg:'可选：掩蔽角度数'}},
 {name:'events.list',description:'列出场景事件与当前进行状态（只读；事件只改载荷可用性）',input:{}},
 {name:'eclipse.list',description:'列出场景全程的卫星日出/日落（出影/进影）时刻：步进扫描定位候选边界，二分精化到亚秒（显示层分析）',input:{asset_id:'可选：限定对象'}},
 {name:'assets.list',description:'列出场景全部对象：轨道参数（高度/倾角/升交点赤经/相位/周期）与载荷清单（只读）',input:{}},
 {name:'subpoint.query',description:'查询对象星下点（纬度/经度）与当前光照状态（光照中/地影内）；可指定场景秒，默认当前显示时刻（显示层分析）',input:{asset_id:'可选：对象 ID 或名称，默认选中对象',seconds:'可选：场景秒 0..duration，默认当前显示游标'}},
 {name:'display.rate',description:'设置本地显示播放倍速（显示动作：只改呈现速度，不推进计算）',input:{speed:'倍速：1 / 10 / 30 / 60 / 120'}},
 {name:'view.capture',description:'导出当前三维视角为 PNG 下载（显示动作）',input:{}},
 {name:'display.seek',description:'设置显示游标；不推进任何计算',input:{seconds:'0..duration'}},
 {name:'display.play',description:'播放或暂停本地显示',input:{playing:'boolean'}},
 {name:'knowledge.set',description:'切换演示感知交付投影',input:{delivery:'instant | delayed'}},
 {name:'model.update',description:'编辑本地草稿缓冲的轨道参数；保存草稿后才成为版本',input:{altitude:'160..36000 km'}},
 {name:'draft.save',description:'将本地草稿缓冲保存为新 DraftRevision（CAS + 幂等）',input:{key:'可选幂等键'}},
 {name:'draft.restore',description:'把历史版本内容恢复为新的 head 修订；历史保留，不倒退',input:{source_revision:'draft revision'}},
 {name:'draft.fork',description:'从精确来源版本创建分支草稿',input:{source_revision:'draft revision，默认当前 head'}},
 {name:'experiment.preflight',description:'只读预检：因素、预算、阻塞项；不创建锁',input:{source_revision:'draft revision，默认当前 head'}},
 {name:'experiment.freeze',description:'从精确来源版本冻结 ExperimentLock',input:{source_revision:'draft revision，默认当前 head'}},
 {name:'batch.submit',description:'从锁提交批量作业（固定 RunPlan 槽位）',input:{lock_id:'ExperimentLock ID，默认最新锁'}},
 {name:'job.pause',description:'请求暂停作业；计算边界后 PAUSED',input:{job_id:'BatchJob ID'}},
 {name:'job.resume',description:'继续已暂停作业',input:{job_id:'BatchJob ID'}},
 {name:'job.cancel',description:'取消作业；已终态返回 already-terminal',input:{job_id:'BatchJob ID'}},
 {name:'jobs.list',description:'列出作业与 RunPlan 槽位状态',input:{}},
 {name:'evaluation.create',description:'为已完成作业固定评价（冻结 source snapshot）',input:{job_id:'BatchJob ID'}},
 {name:'results.list',description:'列出已固定的评价',input:{}},
 {name:'comparison.create',description:'创建显式比较：按 RunPlan 案例对齐两个评价并声明差异',input:{a:'Evaluation ID',b:'Evaluation ID'}},
 {name:'receipt.query',description:'按 ID 查询回执（只读）',input:{receipt_id:'Receipt ID'}},
 {name:'receipts.list',description:'列出最近回执',input:{}},
 {name:'artifact.export',description:'导出评价 JSON 产物',input:{evaluation_id:'Evaluation ID'}},
 {name:'scene.validate',description:'校验当前显示场景',input:{}},
 {name:'scene.export',description:'导出当前显示场景 JSON',input:{}},
 {name:'replay.open',description:'打开绑定固定结果的回放标签',input:{job_id:'BatchJob ID'}},
];
export function parseCommand(input){const q=input.trim(),s=q.toLowerCase();if(!q)return null;
 if(/^(帮助|help|\/help|\?)$/.test(s))return{name:'help',args:{}};
 if(/^(状态|status)$/.test(s))return{name:'status',args:{}};
 if(/^(校验|校验场景|validate)$/.test(s))return{name:'scene.validate',args:{}};
 if(/^(导出|导出场景|export)$/.test(s))return{name:'scene.export',args:{}};
 if(/^(播放|开始播放|play)$/.test(s))return{name:'display.play',args:{playing:true}};
 if(/^(暂停|停止播放|pause)$/.test(s))return{name:'display.play',args:{playing:false}};
 if(/^(清屏|clear)$/.test(s))return{name:'clear',args:{}};
 if(/^(ls|文件列表)$/.test(s))return{name:'files.list',args:{}};
 if(/^cat\s+(scene\.json|tools\.json|README\.md)$/i.test(q))return{name:'files.read',args:{path:q.split(/\s+/)[1].toLowerCase()==='readme.md'?'README.md':q.split(/\s+/)[1].toLowerCase()}};
 const seek=s.match(/^(?:seek\s*|(?:将)?时间(?:设为|设置为|到)?\s*)(\d+(?:\.\d+)?)\s*(?:秒|s)?$/);if(seek)return{name:'display.seek',args:{seconds:+seek[1]}};
 const alt=s.match(/^(?:set\s+altitude\s+|高度(?:设为|到)?\s*)(\d+(?:\.\d+)?)\s*(?:km|公里)?$/);if(alt)return{name:'model.update',args:{altitude:+alt[1]}};
 if(/^(?:显示|打开|切换)?(?:相对轨迹|相对视图)$|^view\s+relative$/.test(s))return{name:'view.set',args:{view:'relative'}};
 if(/^(?:测站列表|测站|stations)$/.test(s))return{name:'stations.list',args:{}};
 if(/^(?:事件列表|事件|events)$/.test(s))return{name:'events.list',args:{}};
 if(/^(?:对象列表|对象|assets)$/.test(s))return{name:'assets.list',args:{}};
 const sub=q.match(/^(?:星下点|subpoint)(?:\s+(\S+?))?(?:\s+(\d+(?:\.\d+)?))?\s*$/);
 if(sub){const a1=sub[1],a2=sub[2],onlyNum=a1&&!a2&&/^\d+(?:\.\d+)?$/.test(a1); // “星下点 900”把纯数字视为时间而非对象名
  return{name:'subpoint.query',args:onlyNum?{seconds:+a1}:{...(a1?{asset_id:a1}:{}),...(a2?{seconds:+a2}:{})}};}
 const rate=q.match(/^(?:倍速|speed)\s+(\d+(?:\.\d+)?)$/);if(rate)return{name:'display.rate',args:{speed:+rate[1]}};
 const lig=q.match(/^(?:光照事件|光照|日照|eclipse)(?:\s+(\S+))?$/);if(lig)return{name:'eclipse.list',args:lig[1]?{asset_id:lig[1]}:{}};
 const jnt=q.match(/^(?:接力观测|接力|joint)(?:\s+(\S+))?$/);if(jnt)return{name:'passes.joint',args:jnt[1]?{asset_id:jnt[1]}:{}};
 const pas=q.match(/^(?:过境|过境窗口|passes)(?:\s+(\S+))?$/);if(pas)return{name:'passes.list',args:pas[1]?{asset_id:pas[1]}:{}};
 if(/^(?:跟随|follow)\s*(?:on|开启)?$/.test(s))return{name:'view.follow',args:{enabled:true}};
 if(/^(?:取消跟随|停止跟随|follow\s+off)$/.test(s))return{name:'view.follow',args:{enabled:false}};
 if(/^(?:显示|打开|切换)?(?:全局总览|全局视图)$|^view\s+global$/.test(s))return{name:'view.set',args:{view:'global'}};
 if(/^(?:显示|打开|切换)?通信几何$|^view\s+comm$/.test(s))return{name:'view.set',args:{view:'comm'}};
 if(/^(?:显示|打开|切换)?对地遥感$|^view\s+observation$/.test(s))return{name:'view.set',args:{view:'observation'}};
 if(/^(?:感知)?延迟\s*60\s*秒$|^delivery\s+delayed$/.test(s))return{name:'knowledge.set',args:{delivery:'delayed'}};
 if(/^(?:感知)?即时交付$|^delivery\s+instant$/.test(s))return{name:'knowledge.set',args:{delivery:'instant'}};
 const sel=s.match(/^(?:选择|select)\s*(\S+)$/);if(sel)return{name:'view.select',args:{id:sel[1]}};
 if(/^(保存草稿|保存版本|draft\.save)$/.test(s))return{name:'draft.save',args:{}};
 if(/^(新分支|创建分支|fork)$/.test(s))return{name:'draft.fork',args:{}};
 if(/^(预检|预检实验|preflight)$/.test(s))return{name:'experiment.preflight',args:{}};
 if(/^(冻结实验|冻结|freeze)$/.test(s))return{name:'experiment.freeze',args:{}};
 if(/^(提交运行|运行实验|run)$/.test(s))return{name:'batch.submit',args:{}};
 if(/^(任务|任务列表|jobs)$/.test(s))return{name:'jobs.list',args:{}};
 if(/^(结果|结果列表|results)$/.test(s))return{name:'results.list',args:{}};
 const jid=s.match(/^(?:暂停作业|暂停任务|job\.pause|job\s+pause)\s+(\S+)$/);if(jid)return{name:'job.pause',args:{job_id:jid[1].toUpperCase()}};
 const jres=s.match(/^(?:继续作业|恢复作业|job\.resume|job\s+resume)\s+(\S+)$/);if(jres)return{name:'job.resume',args:{job_id:jres[1].toUpperCase()}};
 const jcan=s.match(/^(?:取消作业|取消任务|job\.cancel|job\s+cancel)\s+(\S+)$/);if(jcan)return{name:'job.cancel',args:{job_id:jcan[1].toUpperCase()}};
 const jrep=s.match(/^(?:回放|replay)\s+(\S+)$/);if(jrep)return{name:'replay.open',args:{job_id:jrep[1].toUpperCase()}};
 const jev=s.match(/^(?:固定评价|评价|evaluation)\s+(\S+)$/);if(jev)return{name:'evaluation.create',args:{job_id:jev[1].toUpperCase()}};
 const jexp=s.match(/^(?:导出评价|导出结果|artifact\.export)\s+(\S+)$/);if(jexp)return{name:'artifact.export',args:{evaluation_id:jexp[1].toUpperCase()}};
 const cmp=s.match(/^(?:比较|比较结果|comparison)\s+(\S+)\s+(\S+)$/);if(cmp)return{name:'comparison.create',args:{a:cmp[1].toUpperCase(),b:cmp[2].toUpperCase()}};
 const rq=s.match(/^(?:回执|receipt)\s+(\S+)$/);if(rq)return{name:'receipt.query',args:{receipt_id:rq[1]}};
 if(/^(?:回执列表|receipts)$/.test(s))return{name:'receipts.list',args:{}};
 const rres=s.match(/^(?:恢复版本|恢复|draft\.restore)\s+(\S+)$/);if(rres)return{name:'draft.restore',args:{source_revision:rres[1]}};
 const names={终端:'terminal',浏览器:'browser',文件:'files',文件区:'files',场景:'scenario',模型:'models',实验:'experiments',回放:'replay',三维:'orbit','3d':'orbit'};const tab=s.match(/^(?:打开|新建|open)\s*(.+?)(?:工作区)?$/);if(tab){const kind=names[tab[1]]||tab[1];if(['terminal','browser','files','scenario','models','experiments','replay','orbit'].includes(kind))return{name:'workspace.open',args:{kind}};}
 return{name:'unsupported',args:{input:q}};
}
