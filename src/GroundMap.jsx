// 2D 地面轨迹图（等距圆柱投影）：吸纳 CesiumJS Columbus 双视图与 satvis 地面轨迹图惯例，
// 与三维视口并列的第二种呈现。全部为显示层：底图（earth.png，等距圆柱）+ 经纬网 + 晨昏线
// （夜半球遮罩，按太阳高度角逐像素判定）+ 全对象星下点轨迹（过去实线/未来虚线，跨 180° 断线）
// + 当前星下点（可点击选中）+ 事件标记 + 测站 + 太阳直下点。几何与 domain.groundPoint /
// domain.subsolarPoint 同源，不引入第二套坐标约定。仍是低精度太阳解析式（±0.5°）。
import React,{useEffect,useRef,useState} from 'react';
import earthTextureUrl from '../public/earth.png';
import {stateAt,groundPoint,subsolarPoint,eventTime} from './domain.js';

export default function GroundMap({scene,time,selected,stations,stationArm,onAddStation,onSelect}){
 const wrapRef=useRef(null),canvasRef=useRef(null),imgRef=useRef(null),stateRef=useRef(null),scheduleRef=useRef(null),readoutRef=useRef(null);
 const[imgOk,setImgOk]=useState(false);
 stateRef.current={scene,time,selected,stations,stationArm,onAddStation,onSelect};
 useEffect(()=>{const img=new Image();img.onload=()=>{imgRef.current=img;setImgOk(true)};img.src=earthTextureUrl;},[]);
 useEffect(()=>{ // 每次属性变化（播放时 time 以 10Hz 前进）都合并到下一帧重绘，不排队积压
  scheduleRef.current&&scheduleRef.current();
 });
 useEffect(()=>{
  const canvas=canvasRef.current,wrap=wrapRef.current;if(!canvas||!wrap)return;
  const ctx=canvas.getContext('2d');
  const night=document.createElement('canvas');night.width=240;night.height=120; // 低分辨率夜半球遮罩，放大绘制得到柔和晨昏过渡
  const nctx=night.getContext('2d');
  const hits=[];let W=0,H=0,dpr=1,raf=0;
  function draw(){
   raf=0;const{scene,time,selected}=stateRef.current;
   if(!scene||!canvas.width||!canvas.height)return;
   ctx.setTransform(dpr,0,0,dpr,0,0);
   W=canvas.width/dpr;H=canvas.height/dpr;
   const x=lon=>(lon+180)/360*W,y=lat=>(90-lat)/180*H;
   ctx.clearRect(0,0,W,H);ctx.fillStyle='#0a1420';ctx.fillRect(0,0,W,H);
   if(imgRef.current){ctx.globalAlpha=.92;ctx.drawImage(imgRef.current,0,0,W,H);ctx.globalAlpha=1;}
   ctx.lineWidth=1;ctx.strokeStyle='rgba(190,220,240,.13)'; // 经纬网（30° 间隔，赤道加重）
   for(let lon=-150;lon<=150;lon+=30){ctx.beginPath();ctx.moveTo(x(lon),0);ctx.lineTo(x(lon),H);ctx.stroke();}
   for(let lat=-60;lat<=60;lat+=30){ctx.beginPath();ctx.moveTo(0,y(lat));ctx.lineTo(W,y(lat));ctx.stroke();}
   ctx.strokeStyle='rgba(190,220,240,.26)';ctx.beginPath();ctx.moveTo(0,y(0));ctx.lineTo(W,y(0));ctx.stroke();
   const su=subsolarPoint(Date.parse(scene.epoch),time),sLat=su.lat*Math.PI/180; // 夜半球：太阳高度角 < 0
   const im=nctx.createImageData(night.width,night.height);
   for(let j=0;j<night.height;j++){const lat=(90-(j+.5)/night.height*180)*Math.PI/180;
    for(let i=0;i<night.width;i++){const lon=((i+.5)/night.width*360-180-su.lon)*Math.PI/180;
     const lit=Math.sin(lat)*Math.sin(sLat)+Math.cos(lat)*Math.cos(sLat)*Math.cos(lon);
     if(lit<0){const k=(j*night.width+i)*4;im.data[k]=4;im.data[k+1]=9;im.data[k+2]=16;im.data[k+3]=Math.min(215,Math.round(115-lit*180));}}}
   nctx.putImageData(im,0,0);ctx.imageSmoothingEnabled=true;ctx.drawImage(night,0,0,W,H);
   hits.length=0;
   const step=Math.max(10,scene.duration/900);
   for(const a of scene.assets){ // 星下点轨迹：过去实线/未来虚线，与三维视口时间语义一致；跨 180° 经线断线
    const pts=[];for(let t=0;t<=scene.duration+step;t+=step){const tt=Math.min(t,scene.duration);const g=groundPoint(stateAt(a,tt).position,tt);pts.push({t,lon:g.lon,lat:g.lat});}
    const sel=a.id===selected;
    for(const mode of['past','future']){
     ctx.setLineDash(mode==='future'?[5,4]:[]);ctx.beginPath();
     let prev=null;
     for(const p of pts){const want=mode==='past'?p.t<=time:p.t>=time;
      if(!want){prev=null;continue;}
      const px=x(p.lon),py=y(p.lat);
      if(!prev||Math.abs(px-prev)>W/2)ctx.moveTo(px,py);else ctx.lineTo(px,py);
      prev=px;}
     ctx.strokeStyle=a.color;ctx.globalAlpha=sel?(mode==='future'?.8:.95):.38;ctx.lineWidth=sel?1.6:1;ctx.stroke();ctx.globalAlpha=1;}
    ctx.setLineDash([]);
    const now=groundPoint(stateAt(a,time).position,time),nx=x(now.lon),ny=y(now.lat); // 当前星下点（点击选中）
    hits.push({id:a.id,x:nx,y:ny});
    ctx.fillStyle=a.color;ctx.beginPath();ctx.arc(nx,ny,sel?4:2.6,0,Math.PI*2);ctx.fill();
    if(sel){ctx.strokeStyle='rgba(255,255,255,.85)';ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(nx,ny,7,0,Math.PI*2);ctx.stroke();
     ctx.font='11px Inter,-apple-system,"Segoe UI",sans-serif';ctx.fillStyle='#eaf3fb';ctx.shadowColor='#000';ctx.shadowBlur=3;ctx.fillText(a.name,nx+10,ny-8);ctx.shadowBlur=0;}}
   for(const e of scene.events){ // 事件标记：事件起点时刻的星下点（琥珀色，与三维事件弧段同色系）
    const t0=eventTime(e),ta=scene.assets.find(z=>z.id===e.target);if(!ta)continue;
    const g=groundPoint(stateAt(ta,t0).position,t0);
    ctx.fillStyle='#e8b45a';ctx.beginPath();ctx.arc(x(g.lon),y(g.lat),3.2,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='rgba(232,180,90,.4)';ctx.lineWidth=1.4;ctx.beginPath();ctx.arc(x(g.lon),y(g.lat),6.5,0,Math.PI*2);ctx.stroke();}
   for(const st of stations||[]){ // 测站：绿色三角（随地球固连系，位置即经纬度）
    const sx=x(st.lon),sy=y(st.lat);
    ctx.beginPath();ctx.moveTo(sx,sy-5);ctx.lineTo(sx+4.5,sy+3.5);ctx.lineTo(sx-4.5,sy+3.5);ctx.closePath();
    ctx.fillStyle='rgba(127,216,160,.3)';ctx.fill();ctx.strokeStyle='#7fd8a0';ctx.lineWidth=1.5;ctx.stroke();
    ctx.font='10px Inter,-apple-system,"Segoe UI",sans-serif';ctx.fillStyle='#b7e3c8';ctx.fillText(st.name,sx+7,sy+4);}
   const ssx=x(su.lon),ssy=y(su.lat); // 太阳直下点：黄色日轮
   ctx.strokeStyle='#ffd76a';ctx.lineWidth=1.4;
   for(let k=0;k<8;k++){const a2=k/8*Math.PI*2;ctx.beginPath();ctx.moveTo(ssx+Math.cos(a2)*4.5,ssy+Math.sin(a2)*4.5);ctx.lineTo(ssx+Math.cos(a2)*7.5,ssy+Math.sin(a2)*7.5);ctx.stroke();}
   ctx.fillStyle='#ffd76a';ctx.beginPath();ctx.arc(ssx,ssy,2.8,0,Math.PI*2);ctx.fill();
  }
  const schedule=()=>{if(!raf)raf=requestAnimationFrame(draw);};scheduleRef.current=schedule;
  const resize=()=>{dpr=Math.min(window.devicePixelRatio||1,2);
   const w=Math.max(60,Math.min(4000,wrap.clientWidth)),h=Math.max(40,Math.min(1200,wrap.clientHeight)); // 钳制：样式失效时也不允许画布失控增长
   canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.width=w+'px';canvas.style.height=h+'px';schedule();};
  const posOf=e=>{const r=canvas.getBoundingClientRect();return{lon:(e.clientX-r.left)/r.width*360-180,lat:90-(e.clientY-r.top)/r.height*180,px:e.clientX-r.left,py:e.clientY-r.top};};
  const move=e=>{const p=posOf(e);if(readoutRef.current)readoutRef.current.textContent=`${Math.abs(p.lat).toFixed(1)}°${p.lat>=0?'N':'S'}  ${Math.abs(p.lon).toFixed(1)}°${p.lon>=0?'E':'W'}`;};
  const click=e=>{const p=posOf(e),s=stateRef.current;
   if(s.stationArm){s.onAddStation&&s.onAddStation(+p.lat.toFixed(2),+p.lon.toFixed(2));return;} // 测站添加模式：点击放置（与点击三维地球一致）
   let best=null,bd=169;for(const h of hits){const d=(h.x-p.px)**2+(h.y-p.py)**2;if(d<bd){bd=d;best=h;}}
   if(best)s.onSelect&&s.onSelect(best.id);};
  canvas.addEventListener('pointermove',move);canvas.addEventListener('click',click);
  const ro=new ResizeObserver(resize);ro.observe(wrap);resize();
  return()=>{if(raf)cancelAnimationFrame(raf);ro.disconnect();canvas.removeEventListener('pointermove',move);canvas.removeEventListener('click',click);scheduleRef.current=null;};
 },[]);
 return <div className={'ground-map'+(stationArm?' armed':'')} ref={wrapRef}>
  <canvas ref={canvasRef} aria-label="2D 地面轨迹图（等距圆柱投影）"/>
  <div className="map-hud"><strong>2D 地面轨迹 · 等距圆柱</strong><span>实线=过去 · 虚线=未来 · ▲测站 · ☀直下点 · 遮罩=夜半球</span></div>
  {stationArm&&<div className="map-arm-tip">测站添加模式：点击地图放置测站</div>}
  <span className="map-readout" ref={readoutRef}/></div>;
}
