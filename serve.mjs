// 本地静态服务：只托管 dist/，便于浏览器（http://localhost）直接使用离线产物。
// 不做任何代理或服务端逻辑；LLM 请求由浏览器直连 DeepSeek 官方 API。
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve('dist'),port=Number(process.env.PORT||8080);
const MIME={'.html':'text/html; charset=utf-8','.png':'image/png','.js':'text/javascript','.css':'text/css','.json':'application/json'};
http.createServer((req,res)=>{
 const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const rel=p==='/'?'/index.html':p;
 const file=path.normalize(path.join(root,rel));
 if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404,{'Content-Type':'text/plain'});res.end('not found');return;}
 res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
 fs.createReadStream(file).pipe(res);
}).listen(port,()=>console.log(`轨道 Agent 工作台: http://localhost:${port}`));
