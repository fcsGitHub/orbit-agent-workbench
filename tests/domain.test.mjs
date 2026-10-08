import test from 'node:test';import assert from 'node:assert/strict';import {DEFAULT_SCENE,validateScene,stateAt,norm,EARTH_R,MU,OMEGA,lineOfSight,rtn,sub,eventTime,activeEvents,observedTime,observationAvailable,clone,footprintRadius,sunDirectionECI,inEarthShadow,stationEcef,ecefToEci,lookAngles,passWindows,jointVisibility,eclipseIntervals,sunlitAt,refineSunBoundary,sunEvents,subsolarPoint,solarElevation,EPOCH} from '../src/domain.js';
test('default schema, duplicate and invalid target',()=>{assert.equal(validateScene(DEFAULT_SCENE).ok,true);let s=clone(DEFAULT_SCENE);s.assets.push(s.assets[0]);assert.equal(validateScene(s).ok,false);s=clone(DEFAULT_SCENE);s.events[0].target='bad';assert.equal(validateScene(s).ok,false);});
test('circular two-body energy and one orbit periodicity',()=>{for(const a of DEFAULT_SCENE.assets){const s=stateAt(a,0),e=stateAt(a,s.period);assert.ok(norm(sub(s.position,e.position))<1e-8);assert.ok(Math.abs(norm(s.position)-(EARTH_R+a.altitude))<1e-9);assert.ok(Math.abs(norm(s.velocity)**2-MU/norm(s.position))<1e-10)}});
test('LOS blocked through Earth, clear nearby',()=>{assert.equal(lineOfSight([7000,0,0],[-7000,0,0]),false);assert.equal(lineOfSight([7000,0,0],[7000,400,0]),true)});
test('RTN origin and radial projection',()=>{const s=stateAt(DEFAULT_SCENE.assets[0],10);assert.deepEqual(rtn([0,0,0],s),[0,0,0]);assert.ok(Math.abs(rtn(s.position,s)[0]-norm(s.position))<1e-9)});
test('deterministic events, interval boundary, delayed delivery',()=>{const e=DEFAULT_SCENE.events[1];assert.equal(eventTime(e),eventTime(clone(e)));assert.equal(activeEvents(DEFAULT_SCENE,900,'terra-01').length,1);assert.equal(activeEvents(DEFAULT_SCENE,1080,'terra-01').length,0);assert.equal(observedTime(79,'delayed'),0);assert.equal(observationAvailable(59,'delayed'),false);assert.equal(observationAvailable(60,'delayed'),true)});
test('nadir spherical field of view is finite and bounded',()=>{assert.ok(footprintRadius(600,26)>100);assert.ok(footprintRadius(600,26)<160);});
import {parseCommand} from '../src/commands.js';
test('bounded commands parse and reject shell',()=>{assert.equal(parseCommand('显示相对轨迹').args.view,'relative');assert.equal(parseCommand('时间设为 900 秒').args.seconds,900);assert.equal(parseCommand('打开终端').args.kind,'terminal');assert.equal(parseCommand('rm -rf /').name,'unsupported');assert.equal(parseCommand('跟随').name,'view.follow');assert.equal(parseCommand('follow off').name,'view.follow');assert.equal(parseCommand('follow off').args.enabled,false);assert.equal(parseCommand('取消跟随').args.enabled,false);assert.equal(parseCommand('事件列表').name,'events.list');assert.equal(parseCommand('测站列表').name,'stations.list');assert.equal(parseCommand('过境 Terra-01').args.asset_id,'Terra-01');assert.equal(parseCommand('光照事件').name,'eclipse.list');assert.equal(parseCommand('光照 Echo-02').args.asset_id,'Echo-02');});
test('sun direction is unit and tracks seasonal declination',()=>{
 const dec=ms=>Math.asin(sunDirectionECI(ms)[2])*180/Math.PI;
 // 2026-10-04 历元：太阳赤纬约 -3.8°；冬至/夏至应接近 ±23.4°
 const oct=dec(Date.UTC(2026,9,4)),jun=dec(Date.UTC(2026,5,21)),decem=dec(Date.UTC(2026,11,21));
 assert.ok(Math.abs(norm(sunDirectionECI(Date.UTC(2026,9,4)))-1)<1e-12);
 assert.ok(oct>-5&&oct<-2.8,`10 月赤纬 ${oct}`);
 assert.ok(jun>22.5&&jun<24.3,`6 月赤纬 ${jun}`);
 assert.ok(decem<-22.5&&decem>-24.3,`12 月赤纬 ${decem}`);
 assert.ok(Math.abs(dec(Date.UTC(2026,2,20)))<1.5,'春分赤纬接近 0');
});
test('cylindrical earth shadow: sunlit on day side, eclipsed in anti-sun cylinder',()=>{
 const sun=[1,0,0];
 assert.equal(inEarthShadow([8000,0,0],sun),false,'向阳侧必被照亮');
 assert.equal(inEarthShadow([-8000,0,0],sun),true,'背阳侧轴线上在地影内');
 assert.equal(inEarthShadow([-8000,EARTH_R+300,0],sun),false,'垂距超出地球半径则在影外');
 assert.equal(inEarthShadow([-8000,EARTH_R-300,0],sun),true,'垂距小于地球半径在影内');
 assert.equal(inEarthShadow([0,0,0],sun),false,'地心不在阴影内');
});
const overhead={id:'x',altitude:600,inclination:0,raan:0,phase:0};
test('station geometry: ECEF/ECI rotation and look angles at zenith and below horizon',()=>{
 const e=stationEcef(0,0);
 assert.deepEqual(e.map(x=>+x.toFixed(6)),[EARTH_R,0,0]);
 const th=Math.PI/2/OMEGA; // 地球自转 90° 后 ECEF→ECI
 const r=ecefToEci(e,th);
 assert.ok(Math.abs(r[0]-0)<1e-6&&Math.abs(r[1]-EARTH_R)<1e-6&&Math.abs(r[2]-0)<1e-6);
 const st={ecef:e,name:'eq'};
 const zen=lookAngles(overhead,0,st);
 assert.ok(Math.abs(zen.elevation-90)<0.01,'正上方仰角 90°');
 assert.ok(Math.abs(zen.range-600)<1e-6,'天顶距离等于轨道高度');
 const side=lookAngles({...overhead,phase:90},0,st);
 assert.ok(side.elevation<0,'轨道 90° 相位处已落到地平线下');
 assert.ok(side.azimuth>=0&&side.azimuth<360);
});
test('pass windows: equatorial pass over equator station gives two windows in 7200s',()=>{
 const st={ecef:stationEcef(0,0),name:'eq'};
 const wins=passWindows(overhead,st,7200,10,10);
 assert.equal(wins.length,2,`应有两个过境窗口（实际 ${wins.length}）`);
 assert.equal(wins[0].rise,0,'初始即过境顶点附近，起点截断为 0');
 assert.ok(wins[0].maxElevation>85,'赤道轨道经过赤道测站天顶');
 for(const w of wins){assert.ok(w.set>w.rise&&w.duration_s>100&&w.duration_s<700,`窗口时长合理 ${w.duration_s}s`);assert.ok(w.maxElevation>=10);}
 assert.ok(wins[1].rise>5600&&wins[1].rise<6400,`第二圈过境起点 ${wins[1].rise}`);
 assert.ok(passWindows(overhead,{ecef:stationEcef(60,0),name:'north'},7200,10,10).length===0,'纬度 60° 测站在赤道轨道 10° 掩蔽角下永不过境');
 assert.ok(passWindows(overhead,st,7200,10,10).length>=passWindows(overhead,st,7200,40,10).length,'提高掩蔽角不会增加窗口数');
 for(const w of passWindows(overhead,st,7200,40,10))assert.ok(w.maxElevation>=40,'40° 掩蔽角下每个窗口最大仰角达标');
});
test('joint visibility: relay handover across two equatorial stations',()=>{
 const stA={id:'a',name:'A',ecef:stationEcef(0,10)},stB={id:'b',name:'B',ecef:stationEcef(0,40)};
 const wins=jointVisibility(overhead,[stA,stB],7200,10,10);
 assert.equal(wins.length,2,`应有整段+末段两个联合窗口（实际 ${wins.length}）`);
 const w=wins[0];
 assert.ok(w.rise<=10,`联合窗口起点 ${w.rise}（A 站起始即可见）`);
 assert.ok(w.set>940&&w.set<1000,`联合窗口终点 ${w.set}`);
 assert.equal(w.coverage.length,2,'两站均有可见子区间（接力重叠）');
 const A=w.coverage.find(c=>c.id==='a'),B=w.coverage.find(c=>c.id==='b');
 assert.ok(A.rise<=10&&Math.abs(A.set-w.set)<1e-9,'A 站覆盖到窗口结束');
 assert.ok(B.rise>400&&B.rise<440,`B 站升起 ${B.rise}（理论 ≈420s，接力加入）`);
 assert.ok(w.maxElevation>89,'联合最大仰角过天顶');
 assert.ok(jointVisibility(overhead,[stA],7200,10,10).every(x=>x.set<=x.coverage[0].set+1),'单站退化时联合窗口与该站一致');
});
test('eclipse intervals: anti-sun aligned orbit starts in shadow, one arc per orbit',()=>{
 // 太阳方位≈赤经 189.6°：轨道面沿反日向（raan≈9.5°）时 t=0 在地影内
 const asset={id:'x',altitude:600,inclination:0.5,raan:9.5,phase:0};
 const wins=eclipseIntervals(asset,Date.parse(EPOCH),7200,30);
 assert.ok(wins.length>=2,`应至少两个地影区间（实际 ${wins.length}）`);
 assert.equal(wins[0].enter,0,'扫描起点已在影内');
 assert.ok(wins[0].exit>900&&wins[0].exit<1250,`首段出影 ${wins[0].exit}s（理论 ≈1063s：影弧半宽 asin(R/r)≈66°）`);
 for(let i=1;i<wins.length;i++){assert.ok(wins[i].enter>wins[i-1].exit,'区间有序不重叠');assert.ok(wins[i].duration_s>100);}
 assert.ok(wins[1].enter>4300&&wins[1].enter<5300,`第二圈入影 ${wins[1].enter}s`);
});
test('sun events: bisection-refined sunrise/sunset match two-body shadow geometry',()=>{
 const asset={id:'x',altitude:600,inclination:0.5,raan:9.5,phase:0},epoch=Date.parse(EPOCH);
 // 解析近似：n=sqrt(μ/r³)≈1.0847e-3 rad/s，影弧半宽 asin(R/r)≈66.0° → 首次出影 ≈1062s，圈周期 ≈5790s
 const evs=sunEvents(asset,epoch,7200,30);
 assert.ok(evs.length>=3,`应至少 3 个光照事件（实际 ${evs.length}；7200s≈1.24 圈，第三个地影区间在场景外）`);
 assert.equal(evs[0].kind,'sunrise','t=0 已在影内：首个事件是出影（日出）');
 assert.ok(evs[0].t>1040&&evs[0].t<1085,`首次日出 ${evs[0].t}s（理论 ≈1062s）`);
 const firstSunset=evs.find(e=>e.kind==='sunset');
 assert.ok(firstSunset&&firstSunset.t>4690&&firstSunset.t<4770,`首次日落 ${firstSunset&&firstSunset.t}s（理论 ≈4728s = 周期−出影时刻）`);
 assert.ok(evs[2].t>6800&&evs[2].t<6900,`第二次日出 ${evs[2].t}s（理论 ≈6852s = 周期+首次日出）`);
 for(const e of evs){ // 二分精度：边界 ±1 秒内明暗状态翻转
  const out=e.kind==='sunrise'?1:-1;
  assert.notEqual(sunlitAt(asset,e.t-out,epoch),sunlitAt(asset,e.t+out,epoch),`${e.kind}@${e.t}s ±1s 应跨越明暗边界`);
 }
 for(let i=1;i<evs.length;i++)assert.ok(evs[i].t>=evs[i-1].t,'事件按时间排序');
 // 端点退化：起点在影内时不产生“日落”；无翻转的区间返回 null
 assert.equal(refineSunBoundary(asset,2000,3000,epoch),null,'全亮区间无边界');
 assert.equal(sunEvents(overhead,epoch,7200,30).length>=2,true,'赤道轨道同样产生成对事件');
});
// ---------- 0.9：太阳直下点 / 晨昏线几何（2D 地面轨迹图数据源） ----------
test('subsolar point: ECEF 单位向量与 ECI 太阳方向一致，纬度等于太阳赤纬',()=>{
 const epoch=Date.parse(EPOCH),t=1234;
 const su=subsolarPoint(epoch,t),dir=sunDirectionECI(epoch+t*1000);
 assert.ok(su.lat>=-90&&su.lat<=90&&su.lon>=-180&&su.lon<=180,'经纬度在范围内');
 const back=ecefToEci(stationEcef(su.lat,su.lon),t); // 直下点单位位置向量转回 ECI 应与太阳方向同向
 assert.ok(norm(back)>0);
 const cos=(back[0]*dir[0]+back[1]*dir[1]+back[2]*dir[2])/norm(back);
 assert.ok(cos>1-1e-9,`直下点回投影夹角余弦 ${cos}`);
 assert.ok(Math.abs(su.lat-Math.asin(dir[2])*180/Math.PI)<1e-9,'直下点纬度 = 太阳赤纬');
});
test('solar elevation: 直下点处接近天顶，对跖点为负，经度差 90° 处接近晨昏线',()=>{
 const epoch=Date.parse(EPOCH),t=600;
 const su=subsolarPoint(epoch,t);
 assert.ok(solarElevation(su.lat,su.lon,epoch,t)>85,'直下点太阳高度接近天顶');
 const antiLon=su.lon>=0?su.lon-180:su.lon+180;
 assert.ok(solarElevation(-su.lat,antiLon,epoch,t)<-85,'对跖点在夜半球中心');
 const quad=solarElevation(su.lat,su.lon+90,epoch,t);
 assert.ok(Math.abs(quad)<3,`经度差 90° 处高度接近 0（晨昏线），实测 ${quad}`);
 const poleDay=su.lat>=0?89.9:-89.9; // 直下点所在半球的极区为极昼，对侧为极夜（历元赤纬 -4.3° → 南极极昼）
 assert.ok(solarElevation(poleDay,su.lon,epoch,t)>0,'朝向太阳的极区为极昼');
 assert.ok(solarElevation(-poleDay,antiLon,epoch,t)<0,'背向太阳的极区为极夜');
});
test('0.9 新增终端命令：对象列表 / 星下点 / 倍速',()=>{
 assert.equal(parseCommand('对象列表').name,'assets.list');
 assert.equal(parseCommand('assets').name,'assets.list');
 assert.deepEqual(parseCommand('星下点'),{name:'subpoint.query',args:{}});
 assert.deepEqual(parseCommand('星下点 Echo-02'),{name:'subpoint.query',args:{asset_id:'Echo-02'}});
 assert.deepEqual(parseCommand('星下点 Echo-02 900'),{name:'subpoint.query',args:{asset_id:'Echo-02',seconds:900}});
 assert.deepEqual(parseCommand('星下点 900'),{name:'subpoint.query',args:{seconds:900}},'纯数字参数视为时间');
 assert.deepEqual(parseCommand('倍速 30'),{name:'display.rate',args:{speed:30}});
 assert.deepEqual(parseCommand('speed 120'),{name:'display.rate',args:{speed:120}});
});
