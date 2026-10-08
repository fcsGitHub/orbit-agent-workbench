import React,{useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import earthTextureUrl from '../public/earth.png';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {EARTH_R,OMEGA,dot,stateAt,sub,rtn,norm,lineOfSight,predict,observedTime,observationAvailable,activeEvents,eventTime,footprintRadius,sunDirectionECI,inEarthShadow,sunEvents,stationEcef,ecefToEci,lookAngles,groundPoint} from './domain.js';
const S=1/1000; const vec=a=>new THREE.Vector3(a[0]*S,a[2]*S,-a[1]*S);
// ECEF（地球固连系，km）→ three 坐标；与 domain.groundPoint 的 +θ 旋转约定一致
const ecefVec=e=>new THREE.Vector3(e[0]*S,e[2]*S,-e[1]*S);
function line(points,color,opacity=1,dashed=false){const g=new THREE.BufferGeometry().setFromPoints(points);const m=dashed?new THREE.LineDashedMaterial({color,transparent:true,opacity,dashSize:.13,gapSize:.09}):new THREE.LineBasicMaterial({color,transparent:true,opacity});const l=new THREE.Line(g,m);if(dashed)l.computeLineDistances();return l;}
function satellite(color){const g=new THREE.Group();const body=new THREE.Mesh(new THREE.BoxGeometry(.09,.09,.13),new THREE.MeshStandardMaterial({color:'#e2ded0',metalness:.65,roughness:.25}));g.add(body);const panelmat=new THREE.MeshStandardMaterial({color:'#294a6a',metalness:.45,roughness:.35,side:THREE.DoubleSide});for(const x of [-.15,.15]){const p=new THREE.Mesh(new THREE.BoxGeometry(.19,.006,.11),panelmat);p.position.x=x;g.add(p);const wire=new THREE.LineSegments(new THREE.EdgesGeometry(p.geometry),new THREE.LineBasicMaterial({color:'#6483a8'}));p.add(wire);}const glow=new THREE.Mesh(new THREE.SphereGeometry(.05,16,12),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.95}));glow.position.y=.09;g.add(glow);g.userData.glow=glow;return g;}
function disposeTree(n){n.traverse(c=>{c.geometry?.dispose();if(Array.isArray(c.material))c.material.forEach(m=>m.dispose());else c.material?.dispose();});}
function disposeGroup(g){while(g.children.length){const c=g.children[0];g.remove(c);disposeTree(c);}}
// 菲涅尔大气辉光（参考 Cesium/satvis 的 limb glow 观感）：背面半球按视线掠射角渐亮
const atmosphereMaterial=()=>new THREE.ShaderMaterial({uniforms:{uColor:{value:new THREE.Color('#4a9fd8')}},
 vertexShader:'varying vec3 vN;varying vec3 vP;void main(){vN=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.0);vP=mv.xyz;gl_Position=projectionMatrix*mv;}',
 fragmentShader:'uniform vec3 uColor;varying vec3 vN;varying vec3 vP;void main(){float rim=pow(clamp(1.0+dot(normalize(vN),normalize(-vP)),0.0,1.0),4.5);gl_FragColor=vec4(uColor,rim*0.6);}',
 transparent:true,side:THREE.BackSide,depthWrite:false,blending:THREE.AdditiveBlending});
export default function OrbitViewport({scene,time,selected,reference,view,layers,prediction,horizon,delivery,follow,stations,stationArm,maskDeg,perfVisible,onAddStation,captureRef,onSelect,resetKey}){
 const root=useRef(null),runtime=useRef(null),props=useRef(null);props.current={scene,time,selected,reference,view,layers,prediction,horizon,delivery,follow,stations,stationArm,maskDeg,perfVisible,onAddStation,captureRef,onSelect};const [error,setError]=useState(''),[labels,setLabels]=useState([]);
 useEffect(()=>{const el=root.current;if(!el)return;let renderer;try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});}catch(e){setError('此浏览器无法启动 WebGL。数值表、模型编辑、事件和工具命令仍可使用。');return;}
 renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.setClearColor('#080d13');renderer.outputColorSpace=THREE.SRGBColorSpace;el.appendChild(renderer.domElement);const world=new THREE.Scene();world.fog=new THREE.FogExp2('#080d13',.0012);const camera=new THREE.PerspectiveCamera(38,1,.01,2000);camera.position.set(15,11,18);const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.07;controls.minDistance=2;controls.maxDistance=80;controls.enablePan=true;world.add(new THREE.AmbientLight('#cedbe5',.72));const sun=new THREE.DirectionalLight('#fff6df',2.6);sun.position.set(20,10,12);world.add(sun);
 const earth=new THREE.Group();world.add(earth);const sphere=new THREE.Mesh(new THREE.SphereGeometry(EARTH_R*S,96,64),new THREE.MeshPhongMaterial({color:'#153443',shininess:12,specular:'#123846'}));earth.add(sphere);const earthTexture=new THREE.TextureLoader().load(earthTextureUrl);earthTexture.colorSpace=THREE.SRGBColorSpace;earthTexture.anisotropy=renderer.capabilities.getMaxAnisotropy();sphere.material.map=earthTexture;sphere.material.color.set('#94b6c3');sphere.material.needsUpdate=true;
 const grid=new THREE.Group();for(let lat=-60;lat<=60;lat+=30){const a=lat*Math.PI/180,y=EARTH_R*S*Math.sin(a),r=EARTH_R*S*Math.cos(a);let p=[];for(let i=0;i<=180;i++){let t=i/180*Math.PI*2;p.push(new THREE.Vector3(r*Math.cos(t),y,r*Math.sin(t)))}grid.add(line(p,'#7da9a6',.17));}for(let lon=0;lon<180;lon+=30){let p=[];for(let i=0;i<=180;i++){let t=i/180*Math.PI*2,o=lon*Math.PI/180;p.push(new THREE.Vector3(EARTH_R*S*Math.cos(t)*Math.cos(o),EARTH_R*S*Math.sin(t),EARTH_R*S*Math.cos(t)*Math.sin(o)))}grid.add(line(p,'#7da9a6',.17));}earth.add(grid);
 const atmosphere=new THREE.Mesh(new THREE.SphereGeometry(EARTH_R*S*1.045,64,48),atmosphereMaterial());earth.add(atmosphere);
 const groundLayer=new THREE.Group();earth.add(groundLayer); // 星下点轨迹属于地球固连系，随地球自转
 const stars=new Float32Array(1800);let seed=97;const rand=()=>{seed=(seed*16807)%2147483647;return seed/2147483647};for(let i=0;i<600;i++){const a=rand()*Math.PI*2,b=Math.acos(rand()*2-1),r=100+rand()*160;stars[i*3]=r*Math.sin(b)*Math.cos(a);stars[i*3+1]=r*Math.cos(b);stars[i*3+2]=r*Math.sin(b)*Math.sin(a)}const starG=new THREE.BufferGeometry();starG.setAttribute('position',new THREE.BufferAttribute(stars,3));world.add(new THREE.Points(starG,new THREE.PointsMaterial({color:'#b2c6d4',size:.09,transparent:true,opacity:.6})));
 // 分层：卫星持久缓存（避免每次采样步进重建/销毁），轨道线按需重建，选环/速度矢量逐帧更新
 const dynamic=new THREE.Group();world.add(dynamic);const lineLayer=new THREE.Group(),satLayer=new THREE.Group(),overlay=new THREE.Group();dynamic.add(lineLayer,satLayer,overlay);
 const stationLayer=new THREE.Group();earth.add(stationLayer); // 测站属于地球固连系
 function markerMesh(){const g=new THREE.Group();const m=new THREE.Mesh(new THREE.OctahedronGeometry(.07),new THREE.MeshBasicMaterial({color:'#7fd8a0'}));g.add(m);const stem=new THREE.Mesh(new THREE.CylinderGeometry(.006,.006,.14),new THREE.MeshBasicMaterial({color:'#7fd8a0',transparent:true,opacity:.7}));stem.position.y=.07;g.add(stem);return g;}
 const satCache=new Map();let objects=[];
 function getSat(a){let e=satCache.get(a.id);if(!e||e.color!==a.color){if(e){satLayer.remove(e.g);disposeTree(e.g);}const g=satellite(a.color);g.userData.id=a.id;satLayer.add(g);e={g,color:a.color,glow:g.userData.glow};satCache.set(a.id,e);}return e;}
 function dropSat(except){for(const[id,e]of satCache)if(!except.has(id)){satLayer.remove(e.g);disposeTree(e.g);satCache.delete(id);}}
 const ray=new THREE.Raycaster(),mouse=new THREE.Vector2();let dragStart;const down=e=>{dragStart=[e.clientX,e.clientY]};const click=e=>{if(!dragStart||Math.hypot(e.clientX-dragStart[0],e.clientY-dragStart[1])>5)return;const r=el.getBoundingClientRect();mouse.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(mouse,camera);const earthHit=ray.intersectObject(sphere)[0];
  if(props.current.stationArm&&earthHit){ // 点击地球添加测站：交点转到地球本地系再取经纬度
   const lp=earth.worldToLocal(earthHit.point.clone());const X=lp.x/S,Y=-lp.z/S,Z=lp.y/S,rr2=Math.sqrt(X*X+Y*Y+Z*Z);
   const lat=Math.asin(Math.max(-1,Math.min(1,Z/rr2)))*180/Math.PI,lon=(Math.atan2(Y,X)*180/Math.PI+540)%360-180;
   props.current.onAddStation&&props.current.onAddStation(+lat.toFixed(2),+lon.toFixed(2));return;}
  const hit=ray.intersectObjects(objects,true)[0];if(hit&&(!earth.visible||!earthHit||earthHit.distance>hit.distance)){let o=hit.object;while(o&&!o.userData.id)o=o.parent;if(o)props.current.onSelect(o.userData.id)}};renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointerup',click);
 // 选环：逐帧面向相机（修复旋转后仍朝旧机位的问题）并带呼吸脉冲；速度矢量按选中对象样本更新
 const ring=new THREE.Mesh(new THREE.RingGeometry(.13,.145,48),new THREE.MeshBasicMaterial({color:'#ffffff',side:THREE.DoubleSide,transparent:true,opacity:.9}));ring.visible=false;overlay.add(ring);
 const velArrow=new THREE.ArrowHelper(new THREE.Vector3(1,0,0),new THREE.Vector3(),.85,'#ffffff',.2,.11);velArrow.visible=false;overlay.add(velArrow);
 // 日出/日落标记贴图：暖黄日轮=出影（日出），灰蓝暗盘=进影（日落）；canvas 生成，共享两份
 const riseTex=(()=>{const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');g.strokeStyle='#ffd76a';g.fillStyle='#ffd76a';g.lineWidth=5;for(let i=0;i<8;i++){const a=i/8*Math.PI*2;g.beginPath();g.moveTo(32+Math.cos(a)*15,32+Math.sin(a)*15);g.lineTo(32+Math.cos(a)*26,32+Math.sin(a)*26);g.stroke();}g.beginPath();g.arc(32,32,12,0,Math.PI*2);g.fill();const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;})();
 const setTex=(()=>{const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');g.fillStyle='#24384c';g.strokeStyle='#8fb2c9';g.lineWidth=5;g.beginPath();g.arc(32,32,17,0,Math.PI*2);g.fill();g.stroke();const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;})();
 const sampleInfo={}; // id → {pos,color,lit}（显示语义：已交付样本位置）
 const resize=()=>{const w=el.clientWidth,h=el.clientHeight;if(w&&h){renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix()}};const ro=new ResizeObserver(resize);ro.observe(el);resize();let frame,prevKey='',prevStations='',prevLabels='',lastView='',lastUpdate=0,frames=0,fpsT=0;
 const perfEl=document.createElement('div');perfEl.className='perf-hud';perfEl.style.display='none';el.appendChild(perfEl); // 性能自检 HUD（直写 DOM，避免 60fps 重渲染）
 // 视角导出：同步渲染后立即读取像素（无需 preserveDrawingBuffer 常驻开销）
 if(props.current.captureRef)props.current.captureRef.current=()=>{renderer.render(world,camera);return renderer.domElement.toDataURL('image/png');};
 function update(){const p=props.current,ref=p.scene.assets.find(a=>a.id===p.reference)||p.scene.assets[0],sampleT=observedTime(p.time,p.delivery),available=observationAvailable(p.time,p.delivery),refS=stateAt(ref,sampleT),local=p.view==='relative';earth.visible=!local;earth.rotation.y=7.2921159e-5*sampleT;
  const sunDir=sunDirectionECI(Date.parse(p.scene.epoch));sun.position.copy(vec(sunDir).multiplyScalar(80));
  const rt=(pos,t=sampleT)=>{const rs=t>sampleT?predict(ref,sampleT,t-sampleT,p.prediction):stateAt(ref,t);const v=rtn(sub(pos,rs.position),rs);return new THREE.Vector3(v[1]*.015,v[0]*.015,v[2]*.015)};if(lastView!==p.view){camera.position.set(...(local?[5,4,7]:[15,11,18]));controls.target.set(0,0,0);controls.minDistance=local?.2:7;controls.maxDistance=local?100:80;lastView=p.view;}
  const key=JSON.stringify([p.scene,p.view,p.layers,p.prediction,p.horizon,p.delivery,p.selected,p.reference,available,Math.floor(sampleT)]);if(key!==prevKey){prevKey=key;disposeGroup(lineLayer);disposeGroup(groundLayer);objects=[];for(const id in sampleInfo)delete sampleInfo[id];
  const stKey=JSON.stringify(p.stations||[]);if(stKey!==prevStations){prevStations=stKey;disposeGroup(stationLayer);for(const st of (p.stations||[])){const e=st.ecef||stationEcef(st.lat,st.lon),k=EARTH_R*S*1.004/norm(e),m=markerMesh();m.position.set(e[0]*k,e[2]*k,-e[1]*k);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),m.position.clone().normalize());stationLayer.add(m);}}
  // 卫星网格只换位不重建：同一组被缓存复用，删除已不在场景中的条目
  satLayer.visible=available;dropSat(new Set(available?p.scene.assets.map(a=>a.id):[]));
  if(available)for(const a of p.scene.assets){const s=stateAt(a,sampleT),pos=local?rt(s.position):vec(s.position),e=getSat(a);e.g.position.copy(pos);e.g.scale.setScalar(local?1.5:1);e.g.lookAt(0,0,0);objects.push(e.g);
   const lit=!inEarthShadow(s.position,sunDir);e.glow.material.color.set(lit?a.color:'#26313c');e.glow.material.opacity=lit?.95:.4; // 地影内光点变暗（圆柱本影近似）
   sampleInfo[a.id]={pos,color:a.color,lit};
   if(a.id===p.selected){
    const epochMs=Date.parse(p.scene.epoch);
    if(p.layers.ground&&!local){ // 星下点轨迹：昼夜分段着色（向阳=对象色/背阳=灰蓝）+ 过去实线/未来虚线；当前星下点标记
     const step=Math.max(15,Math.floor(a.period/220)),end=Math.min(p.scene.duration,a.period*1.06);
     let runs=[],cur=null;
     for(let t=0;t<=end;t+=step){
      const st=stateAt(a,t),th=OMEGA*t,c=Math.cos(th),sn=Math.sin(th),r=norm(st.position),f=EARTH_R*S*1.004/r;
      const p3=ecefVec([(c*st.position[0]+sn*st.position[1])*f,(-sn*st.position[0]+c*st.position[1])*f,st.position[2]*f]);
      const flag=(dot(st.position,sunDirectionECI(epochMs+t*1000))>0?'d':'n')+(t>sampleT?'f':'p'); // 星下点向阳 ⇔ 日照段
      if(!cur||cur.flag!==flag){cur={flag,pts:[p3]};runs.push(cur);}else cur.pts.push(p3);
     }
     for(const run of runs)if(run.pts.length>1)groundLayer.add(line(run.pts,run.flag[0]==='d'?a.color:'#4a6b85',run.flag[0]==='d'?.55:.5,run.flag[1]==='f'));
     const cs=stateAt(a,sampleT),thc=OMEGA*sampleT,cc=Math.cos(thc),sc=Math.sin(thc),fc=EARTH_R*S*1.004/norm(cs.position);
     const subDot=new THREE.Mesh(new THREE.SphereGeometry(.035,12,10),new THREE.MeshBasicMaterial({color:a.color}));subDot.position.copy(ecefVec([(cc*cs.position[0]+sc*cs.position[1])*fc,(-sc*cs.position[0]+cc*cs.position[1])*fc,cs.position[2]*fc]));groundLayer.add(subDot);
     if(!local){const n=vec(cs.position).normalize();lineLayer.add(line([pos,n.clone().multiplyScalar(EARTH_R*S*1.002)],a.color,.3));}} // 天底连线（世界系：径向投影）
    if(p.layers.sun&&!local){ // 日出/日落标记：进影=日落、出影=日出，二分精化时刻定位在轨道上；已发生事件半透明
     for(const ev of sunEvents(a,epochMs,p.scene.duration,30)){
      const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:ev.kind==='sunrise'?riseTex:setTex,transparent:true,depthWrite:false,opacity:ev.t<sampleT?.35:.95}));
      sp.position.copy(vec(stateAt(a,ev.t).position));sp.scale.setScalar(.26);sp.renderOrder=2;lineLayer.add(sp);}
    }
   }
   if(p.layers.orbits){let points=[];const period=s.period;for(let j=0;j<=180;j++){const t=sampleT-period+j/180*period,st=stateAt(a,t);points.push(local?rt(st.position,t):vec(st.position));}lineLayer.add(line(points,a.color,a.id===p.selected?.5:.22));}
   if(p.layers.prediction&&(a.id===p.selected||local)){let points=[];for(let j=0;j<=90;j++){let dt=j/90*p.horizon;let st=predict(a,sampleT,dt,p.prediction);points.push(local?rt(st.position,sampleT+dt):vec(st.position));}lineLayer.add(line(points,a.color,.88,true));}
   if(p.layers.fov&&!local&&a.id===p.selected&&!activeEvents(p.scene,sampleT,a.id).length){const payload=a.payloads.find(x=>x.kind==='camera'&&x.enabled);if(payload){const radius=footprintRadius(a.altitude,payload.fov);if(radius){const n=vec(s.position).normalize(),center=n.clone().multiplyScalar(EARTH_R*S*1.0002),u=new THREE.Vector3(0,1,0).cross(n).normalize();if(u.length()<.1)u.set(1,0,0);const v=n.clone().cross(u);let edge=[];for(let j=0;j<=72;j++){const q=j/72*Math.PI*2;edge.push(n.clone().multiplyScalar(Math.cos(radius/EARTH_R)).addScaledVector(u,Math.cos(q)*Math.sin(radius/EARTH_R)).addScaledVector(v,Math.sin(q)*Math.sin(radius/EARTH_R)).multiplyScalar(EARTH_R*S*1.0004));}lineLayer.add(line(edge,a.color,.9));for(let j=0;j<72;j+=12)lineLayer.add(line([pos,edge[j]],a.color,.25));const geom=new THREE.BufferGeometry();let vertices=[];for(let j=0;j<72;j++){vertices.push(...pos.toArray(),...edge[j].toArray(),...edge[j+1].toArray())}geom.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));lineLayer.add(new THREE.Mesh(geom,new THREE.MeshBasicMaterial({color:a.color,transparent:true,opacity:.045,side:THREE.DoubleSide,depthWrite:false})));}}}
  }
  if(!local&&available){ // 事件不可用弧段：事件时间窗对应的轨道段（态势标注；事件只改可用性，不改轨道）
   for(const ev of p.scene.events){const t0=eventTime(ev),t1=Math.min(t0+ev.duration,p.scene.duration),ta=p.scene.assets.find(x=>x.id===ev.target);if(!ta||t1<=t0)continue;const pts=[];for(let j=0;j<=36;j++)pts.push(vec(stateAt(ta,t0+(t1-t0)*j/36).position));lineLayer.add(line(pts,'#e8b45a',.9));}
   const selAsset=p.scene.assets.find(x=>x.id===p.selected); // 选中对象轨道方向箭头（沿速度方向）
   if(selAsset&&p.layers.orbits){const period=stateAt(selAsset,0).period;for(const k of [1,2,3]){const t=Math.max(0,sampleT-period*k/4),st=stateAt(selAsset,t);const cone=new THREE.Mesh(new THREE.ConeGeometry(.035,.1,8),new THREE.MeshBasicMaterial({color:selAsset.color,transparent:true,opacity:.95}));cone.position.copy(vec(st.position));cone.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),vec(st.velocity).normalize());lineLayer.add(cone);}}
  }
  if(p.layers.links&&available){const chosen=p.scene.assets.find(a=>a.id===p.selected)||p.scene.assets[0],sa=stateAt(chosen,sampleT);for(const b of p.scene.assets.filter(a=>a.id!==chosen.id)){const sb=stateAt(b,sampleT),los=lineOfSight(sa.position,sb.position);lineLayer.add(line([local?rt(sa.position):vec(sa.position),local?rt(sb.position):vec(sb.position)],los?'#b7dea0':'#938b83',los?.75:.2,!los));}}
  if((p.stations||[]).length&&available&&!local){ // 站星连线：仰角≥掩蔽角时显示
   const maskDeg=p.maskDeg||10;
   for(const st of p.stations){const e=st.ecef||stationEcef(st.lat,st.lon),se=vec(ecefToEci(e,sampleT));for(const a of p.scene.assets){if(lookAngles(a,sampleT,{ecef:e}).elevation>=maskDeg)lineLayer.add(line([se,vec(stateAt(a,sampleT).position)],'#7fd8a0',.75));}}}}
  // 选中环与速度矢量：按已交付样本位置更新（显示语义不变，不插值造数）
  const sel=sampleInfo[p.selected];ring.visible=!!sel;if(sel){ring.position.copy(sel.pos);ring.material.color.set(sel.color);}
  if(sel&&!local){const st=stateAt(p.scene.assets.find(a=>a.id===p.selected)||p.scene.assets[0],sampleT),v=vec(st.velocity).normalize();velArrow.visible=true;velArrow.position.copy(sel.pos);velArrow.setDirection(v);velArrow.setColor(sel.color);}else velArrow.visible=false;
  const out=available?p.scene.assets.map(a=>{const s=stateAt(a,sampleT),v=local?rt(s.position):vec(s.position);const toCam=camera.position.clone().sub(v);const occluded=!local&&toCam.dot(v)<0&&new THREE.Ray(camera.position,toCam.clone().negate().normalize()).distanceToPoint(new THREE.Vector3())<EARTH_R*S;const q=v.project(camera);return{id:a.id,name:a.name,color:a.color,x:(q.x+1)/2*el.clientWidth,y:(1-q.y)/2*el.clientHeight,visible:q.z<1&&q.z>-1&&!occluded,selected:a.id===p.selected}}):[];const str=JSON.stringify(out.map(l=>({...l,x:Math.round(l.x),y:Math.round(l.y)})));if(str!==prevLabels){setLabels(out);prevLabels=str;}
 }
 const animate=t=>{frame=requestAnimationFrame(animate);if(!el.clientWidth||!el.clientHeight)return;controls.update();
  frames++;if(t-fpsT>=1000){if(perfEl){perfEl.style.display=props.current.perfVisible?'block':'none';if(props.current.perfVisible){const i=renderer.info.render;perfEl.textContent=`${frames} fps · ${i.calls} draws · ${(i.triangles/1000).toFixed(1)}k tris`;}}frames=0;fpsT=t;} // 性能自检 1Hz 刷新，不触发 React 渲染
  const local=props.current.view==='relative';controls.minDistance=local?.2:props.current.follow?1.4:7; // 跟随时允许贴近
  if(props.current.follow&&!local){const e=satCache.get(props.current.selected);if(e){const delta=e.g.position.clone().sub(controls.target).multiplyScalar(.1);controls.target.add(delta);camera.position.add(delta);}} // 平滑追踪已交付样本位置
  const sel=sampleInfo[props.current.selected];if(sel&&ring.visible){ring.quaternion.copy(camera.quaternion);const pulse=1+.07*Math.sin(t*.005);ring.scale.setScalar(pulse);}
  if(t-lastUpdate>100){update();lastUpdate=t;}renderer.render(world,camera)};frame=requestAnimationFrame(animate);runtime.current={camera,controls};return()=>{cancelAnimationFrame(frame);ro.disconnect();renderer.domElement.removeEventListener('pointerdown',down);renderer.domElement.removeEventListener('pointerup',click);controls.dispose();if(props.current.captureRef)props.current.captureRef.current=null;perfEl.remove();world.traverse(n=>{n.geometry?.dispose();if(Array.isArray(n.material))n.material.forEach(m=>m.dispose());else n.material?.dispose()});earthTexture.dispose();riseTex.dispose();setTex.dispose();renderer.dispose();renderer.domElement.remove();runtime.current=null;};},[]);
 useEffect(()=>{if(runtime.current){const {camera,controls}=runtime.current;camera.position.set(...(view==='relative'?[5,4,7]:[15,11,18]));controls.target.set(0,0,0)}},[resetKey]);
 return <div className="viewport" ref={root} aria-label="Three.js 三维轨道视口">{error?<div className="gpu-error">{error}</div>:labels.filter(l=>l.visible).map(l=><button key={l.id} className={'object-label '+(l.selected?'selected':'')} style={{left:l.x+13,top:l.y-13,'--object-color':l.color}} onClick={()=>onSelect(l.id)}>{l.name}</button>)}</div>;
}
