import Ajv from 'ajv';
export const EARTH_R=6371, MU=398600.4418, OMEGA=7.2921159e-5;
export const EPOCH='2026-10-04T00:00:00.000Z';
export const DURATION=7200;
export const DEFAULT_SCENE={version:'0.1',name:'近地轨道协同观测',epoch:EPOCH,seed:42,duration:DURATION,assets:[
 {id:'terra-01',name:'Terra-01',type:'civil.satellite',color:'#d4f07e',altitude:600,inclination:51.6,raan:15,phase:12,payloads:[{id:'optical',name:'光学相机',kind:'camera',enabled:true,fov:26},{id:'radiometer',name:'科学辐射计',kind:'radiometer',enabled:true,fov:18}]},
 {id:'echo-02',name:'Echo-02',type:'civil.satellite',color:'#8ec5ff',altitude:630,inclination:52,raan:16,phase:16,payloads:[{id:'optical',name:'光学相机',kind:'camera',enabled:true,fov:22},{id:'radiometer',name:'科学辐射计',kind:'radiometer',enabled:true,fov:14}]},
 {id:'relay-03',name:'Relay-03',type:'civil.satellite',color:'#e6b794',altitude:1200,inclination:65,raan:85,phase:155,payloads:[{id:'comm',name:'通信转发器',kind:'comm',enabled:true,fov:30}]}
],events:[{id:'event-1',kind:'temporary-unavailable',target:'terra-01',trigger:'scheduled',at:900,duration:180,seed:42,note:'载荷例行校验'},{id:'event-2',kind:'temporary-unavailable',target:'echo-02',trigger:'seeded',at:1800,window:600,duration:120,seed:83,note:'可复现实验事件'}]};
export const clone=x=>JSON.parse(JSON.stringify(x));
export const sceneSchema={type:'object',additionalProperties:false,required:['version','name','epoch','seed','duration','assets','events'],properties:{version:{const:'0.1'},name:{type:'string',minLength:1,maxLength:80},epoch:{const:EPOCH},seed:{type:'integer',minimum:0,maximum:4294967295},duration:{type:'number',minimum:60,maximum:86400},assets:{type:'array',minItems:1,maxItems:12,items:{type:'object',additionalProperties:false,required:['id','name','type','color','altitude','inclination','raan','phase','payloads'],properties:{id:{type:'string',pattern:'^[a-z][a-z0-9-]{0,39}$'},name:{type:'string',minLength:1,maxLength:40},type:{const:'civil.satellite'},color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},altitude:{type:'number',minimum:160,maximum:36000},inclination:{type:'number',minimum:0,maximum:180},raan:{type:'number',minimum:0,maximum:360},phase:{type:'number',minimum:0,maximum:360},payloads:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,required:['id','name','kind','enabled','fov'],properties:{id:{type:'string',pattern:'^[a-z][a-z0-9-]{0,39}$'},name:{type:'string',maxLength:50},kind:{enum:['camera','radiometer','comm']},enabled:{type:'boolean'},fov:{type:'number',minimum:1,maximum:60}}}}}}},events:{type:'array',maxItems:50,items:{type:'object',additionalProperties:false,required:['id','kind','target','trigger','at','duration','seed','note'],properties:{id:{type:'string',maxLength:50},kind:{const:'temporary-unavailable'},target:{type:'string'},trigger:{enum:['scheduled','seeded']},at:{type:'number',minimum:0,maximum:86400},window:{type:'number',minimum:0,maximum:3600},duration:{type:'number',minimum:1,maximum:3600},seed:{type:'integer',minimum:0,maximum:4294967295},note:{type:'string',maxLength:140}}}}}};
const validate=new Ajv({allErrors:true}).compile(sceneSchema);
export function validateScene(s){if(!validate(s))return {ok:false,error:validate.errors.map(e=>`${e.instancePath||'/'} ${e.message}`).join('; ')};if(new Set(s.assets.map(a=>a.id)).size!==s.assets.length)return{ok:false,error:'对象 ID 不能重复'};if(new Set(s.events.map(e=>e.id)).size!==s.events.length)return{ok:false,error:'事件 ID 不能重复'};for(const a of s.assets){if(new Set(a.payloads.map(p=>p.id)).size!==a.payloads.length)return{ok:false,error:'载荷 ID 不能重复'};}for(const e of s.events){if(!s.assets.some(a=>a.id===e.target))return{ok:false,error:`未知目标 ${e.target}`};if(eventTime(e)+e.duration>s.duration)return{ok:false,error:'事件超出场景时长'};}return{ok:true};}
export const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),add=(a,b)=>a.map((x,i)=>x+b[i]),sub=(a,b)=>a.map((x,i)=>x-b[i]),mul=(a,s)=>a.map(x=>x*s),norm=a=>Math.hypot(...a),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=a=>mul(a,1/norm(a));
export function stateAt(a,t){const r=EARTH_R+a.altitude,n=Math.sqrt(MU/(r*r*r)),q=a.phase*Math.PI/180+n*t,i=a.inclination*Math.PI/180,o=a.raan*Math.PI/180;const basis1=[Math.cos(o),Math.sin(o),0],basis2=[-Math.sin(o)*Math.cos(i),Math.cos(o)*Math.cos(i),Math.sin(i)];return{position:add(mul(basis1,r*Math.cos(q)),mul(basis2,r*Math.sin(q))),velocity:add(mul(basis1,-r*n*Math.sin(q)),mul(basis2,r*n*Math.cos(q))),period:2*Math.PI/n};}
export function observedTime(t,delivery='instant',cadence=20){return Math.max(0,Math.floor(Math.max(0,t-(delivery==='delayed'?60:0))/cadence)*cadence);}
export function observationAvailable(t,delivery){return delivery!=='delayed'||t>=60;}
export function predict(a,sourceT,dt,model='circular'){const s=stateAt(a,sourceT);return model==='linear'?{...s,position:add(s.position,mul(s.velocity,dt))}:stateAt(a,sourceT+dt);}
export function rtn(relative,reference){const R=unit(reference.position),N=unit(cross(reference.position,reference.velocity)),T=cross(N,R);return[dot(relative,R),dot(relative,T),dot(relative,N)];}
export function lineOfSight(a,b){const d=sub(b,a);let f=-dot(a,d)/dot(d,d);f=Math.max(0,Math.min(1,Number.isFinite(f)?f:0));return norm(add(a,mul(d,f)))>EARTH_R;}
export function groundPoint(p,t){const theta=OMEGA*t,c=Math.cos(theta),s=Math.sin(theta);const q=[c*p[0]+s*p[1],-s*p[0]+c*p[1],p[2]],r=norm(q);return{lat:Math.asin(q[2]/r)*180/Math.PI,lon:Math.atan2(q[1],q[0])*180/Math.PI};}
export function footprintRadius(altitude,fullAngle){const r=EARTH_R+altitude,b=fullAngle*Math.PI/360,k=r*Math.sin(b)/EARTH_R;if(k>=1)return null;return EARTH_R*(Math.asin(k)-b);}
export function seeded(seed){let x=seed>>>0;x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;}
export function eventTime(e){return e.at+(e.trigger==='seeded'?Math.round(seeded(e.seed)*(e.window??600)):0);}
export function activeEvents(scene,t,id){return scene.events.filter(e=>e.target===id&&t>=eventTime(e)&&t<eventTime(e)+e.duration);}
export function deliveryEvents(scene,t,delivery){const lag=delivery==='delayed'?60:0;return scene.events.filter(e=>eventTime(e)+lag<=t).map(e=>({...e,occurredAt:eventTime(e),learnedAt:eventTime(e)+lag,active:t<eventTime(e)+e.duration+lag}));}
export const formatTime=t=>new Date(Date.parse(EPOCH)+t*1000).toISOString().slice(11,19);
export const fmt=(n,d=1)=>Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'未知';
// ---------- 太阳几何（低精度解析式，约 ±0.5°，只用于显示光照与地影标记，不进入实验指标） ----------
// 太阳黄经/赤纬按历元日期计算（Astronomical Almanac 低精度式），返回 ECI 单位方向（地球→太阳）。
export function sunDirectionECI(epochMs){
 const d=epochMs/86400000-10957.5; // J2000（2000-01-01T12:00Z）起算的日数
 const M=(357.529+0.98560028*d)*Math.PI/180;
 const lam=(280.459+0.98564736*d+1.915*Math.sin(M)+0.020*Math.sin(2*M))*Math.PI/180;
 const eps=(23.439-0.00000036*d)*Math.PI/180;
 const dec=Math.asin(Math.sin(eps)*Math.sin(lam)),ra=Math.atan2(Math.cos(eps)*Math.sin(lam),Math.cos(lam));
 return[Math.cos(dec)*Math.cos(ra),Math.cos(dec)*Math.sin(ra),Math.sin(dec)];
}
// 太阳直下点（subsolar point）：ECI 太阳方向转到地球固连系取经纬度（与 groundPoint 同一旋转约定）。
// 供 2D 地面轨迹图绘制晨昏线与直下点标记；仍是低精度解析式（±0.5°），只服务显示层。
export function subsolarPoint(epochMs,t){return groundPoint(sunDirectionECI(epochMs+t*1000),t);}
// 地表 (lat,lon) 在 t 时刻的太阳高度角（度）：正=向阳、负=背阳。晨昏线即高度角为 0 的等值线。
export function solarElevation(latDeg,lonDeg,epochMs,t){
 const la=latDeg*Math.PI/180,su=subsolarPoint(epochMs,t),sa=su.lat*Math.PI/180,dLon=(lonDeg-su.lon)*Math.PI/180;
 return Math.asin(Math.max(-1,Math.min(1,Math.sin(la)*Math.sin(sa)+Math.cos(la)*Math.cos(sa)*Math.cos(dLon))))*180/Math.PI;
}
// 圆柱本影近似（不含半影）：卫星在背阳侧且到阴影轴的垂距小于地球半径即判定在地影内。
export function inEarthShadow(position,sunDir){
 const proj=dot(position,sunDir);
 if(proj>=0)return false;
 const perp2=dot(position,position)-proj*proj;
 return perp2<EARTH_R*EARTH_R;
}
// ---------- 地面站与过境（球形地球，显示层分析；不进入实验运行指纹） ----------
export function stationEcef(latDeg,lonDeg){
 const la=latDeg*Math.PI/180,lo=lonDeg*Math.PI/180;
 return[EARTH_R*Math.cos(la)*Math.cos(lo),EARTH_R*Math.cos(la)*Math.sin(lo),EARTH_R*Math.sin(la)];
}
export function ecefToEci(e,t){const th=OMEGA*t,c=Math.cos(th),s=Math.sin(th);return[c*e[0]-s*e[1],s*e[0]+c*e[1],e[2]];}
// 站心视角：仰角/方位角/距离。球面地球下仰角>0 即几何可见（与 LOS 判定一致）。
export function lookAngles(asset,t,station){
 const st=stateAt(asset,t),se=ecefToEci(station.ecef,t),d=sub(st.position,se),up=unit(se),r=norm(d);
 const el=Math.asin(Math.max(-1,Math.min(1,dot(d,up)/r)))*180/Math.PI;
 let east=cross([0,0,1],up);
 if(norm(east)<1e-9)east=[1,0,0];else east=unit(east); // 极点退化兜底
 const north=cross(up,east);
 const az=(Math.atan2(dot(d,east),dot(d,north))*180/Math.PI+360)%360;
 return{elevation:el,azimuth:az,range:r};
}
// 过境窗口扫描：固定步进近似（结果如实标注 step）；相邻可见样本合并为一个窗口。
export function passWindows(asset,station,duration,maskDeg=10,step=10){
 const wins=[];let cur=null;
 for(let t=0;t<=duration+step;t+=step){
  const tt=Math.min(t,duration),{elevation:el}=lookAngles(asset,tt,station),vis=el>=maskDeg;
  if(vis&&!cur)cur={rise:tt,maxElevation:el,maxElevationAt:tt};
  else if(vis&&cur&&el>cur.maxElevation){cur.maxElevation=el;cur.maxElevationAt=tt;}
  if((!vis||tt===duration)&&cur){cur.set=tt;cur.duration_s=+(cur.set-cur.rise).toFixed(1);
   if(cur.duration_s>0){cur.rise=+cur.rise.toFixed(1);cur.set=+cur.set.toFixed(1);cur.maxElevation=+cur.maxElevation.toFixed(1);cur.maxElevationAt=+cur.maxElevationAt.toFixed(1);
    wins.push(cur);}
   cur=null;}
 }
 return wins;
}
// 多站联合可见（接力观测）：任一测站以≥maskDeg 仰角可见即算覆盖；
// coverage 列出每个测站在该联合窗口内的可见子区间（交接一目了然）。步进近似，同 passWindows。
export function jointVisibility(asset,stations,duration,maskDeg=10,step=10){
 if(!stations.length)return[];
 const rows=[];let cur=null;
 for(let t=0;t<=duration+step;t+=step){
  const tt=Math.min(t,duration),els=stations.map(st=>lookAngles(asset,tt,st).elevation),any=els.some(el=>el>=maskDeg);
  if(any&&!cur)cur={rise:tt,set:null,maxElevation:-Infinity,coverage:stations.map(st=>({id:st.id,name:st.name,rise:null,set:null}))};
  if(cur){
   for(let i=0;i<stations.length;i++){const c=cur.coverage[i],on=els[i]>=maskDeg;
    if(on){c.rise=c.rise??tt;if(els[i]>cur.maxElevation)cur.maxElevation=els[i];}
    if((!on||tt===duration)&&c.rise!==null)c.set=tt;}
   if(!any||tt===duration){cur.set=tt;
    cur.coverage=cur.coverage.filter(c=>c.rise!==null&&c.set>c.rise).map(c=>({...c,rise:+c.rise.toFixed(1),set:+c.set.toFixed(1)}));
    cur.rise=+cur.rise.toFixed(1);cur.set=+cur.set.toFixed(1);cur.maxElevation=+cur.maxElevation.toFixed(1);
    if(cur.set>cur.rise&&cur.coverage.length)rows.push(cur);
    cur=null;}}
 }
 return rows;
}
// 地影进出区间扫描：按固定步进检测（显示层近似，不含半影渐变）。
export function eclipseIntervals(asset,epochMs,duration,step=30){
 const wins=[];let cur=null;
 for(let t=0;t<=duration+step;t+=step){
  const tt=Math.min(t,duration),shadow=inEarthShadow(stateAt(asset,tt).position,sunDirectionECI(epochMs+tt*1000));
  if(shadow&&!cur)cur={enter:tt};
  if((!shadow||tt===duration)&&cur){cur.exit=tt;if(cur.exit>cur.enter)wins.push({enter:+cur.enter.toFixed(1),exit:+cur.exit.toFixed(1),duration_s:+(cur.exit-cur.enter).toFixed(1)});cur=null;}
 }
 return wins;
}
// ---------- 日出/日落（进出地影）精确时刻：步进扫描定位后二分精化 ----------
// t 秒（场景相对时）卫星是否被太阳照亮（圆柱本影近似）。
export function sunlitAt(asset,t,epochMs){return !inEarthShadow(stateAt(asset,t).position,sunDirectionECI(epochMs+t*1000));}
// 在 [tLo,tHi] 内找明暗翻转时刻；两端同明或同暗返回 null（区间内无边界）。
export function refineSunBoundary(asset,tLo,tHi,epochMs){
 let lo=tLo,hi=tHi;
 if(sunlitAt(asset,lo,epochMs)===sunlitAt(asset,hi,epochMs))return null;
 for(let i=0;i<24;i++){const mid=(lo+hi)/2;if(sunlitAt(asset,mid,epochMs)===sunlitAt(asset,lo,epochMs))lo=mid;else hi=mid;}
 return(lo+hi)/2;
}
// 卫星日出/日落事件表：入影=日落，出影=日出。步进扫描给出 ±step 的候选窗口，
// 二分把边界精化到亚秒级；场景起点已在影内/终点仍在影内时对应边界不在场景内，不输出。
export function sunEvents(asset,epochMs,duration,step=30){
 const out=[];
 for(const w of eclipseIntervals(asset,epochMs,duration,step)){
  if(w.enter>0){const t=refineSunBoundary(asset,Math.max(0,w.enter-step),w.enter,epochMs);if(t!=null)out.push({kind:'sunset',t:+t.toFixed(1)});}
  if(w.exit<duration){const t=refineSunBoundary(asset,w.exit-step,w.exit,epochMs);if(t!=null)out.push({kind:'sunrise',t:+t.toFixed(1)});}
 }
 return out.sort((a,b)=>a.t-b.t);
}
