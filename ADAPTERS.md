# 运行时扩展契约

当前所有工具在浏览器内执行。以下仅是实现边界与未来接线契约，不是已启动的后端。

## 应用服务边界（0.2）

`src/app.js` 是浏览器内的应用核心：Project / WorkSession / DraftRevision / ExperimentLock / BatchJob / Evaluation / Receipt 与统一提交链（内容摘要 → CAS → 幂等键 → 回执）。它是纯同步内存实现，标注 `prototype-in-memory`；正式部署应把它替换为服务端 ApplicationService / DraftService / JobService，保持函数签名与回执结构不变：

- `saveDraft(project, draftId, scene, baseRevision, {key, sessionId})` → `{ok, revision_id, receipt}` 或 `{ok:false, code:'E_CONFLICT'|'E_VALIDATE'|'E_IDEMPOTENCY_CONFLICT', ...}`；CAS 与幂等语义由服务端持久事务承担
- `preflight(project, revisionId)` → 只读报告；服务端版本应补充依赖闭包 handle 与授权检查，不在此暴露隐藏依赖
- `freezeExperiment(project, revisionId, {key})` → 相同来源版本与内容复用同一把锁；来源精确，不漂移到 head
- `submitBatch / jobTick / pauseJob / resumeJob / cancelJob / buildEvaluation` → 服务端映射为持久 Job、worker fencing 与授权投影；`control_revision` 与物理 `commit_seq` 分离的约定保持不变
- `snapshotProject / restoreProject`（§37.4 原型）→ 浏览器 localStorage 实现；服务端版本应替换为经授权的 WorkspaceSnapshot：恢复次序为“认证与项目授权 → 解析引用 → 查询 job 状态 → 恢复呈现状态”，旧工具调用只查回执、不自动重新执行；不得保存长期凭据、权限令牌或可访问未来事件的缓存

前端不构造身份、权限或审批字段；真实后端接入时，ContextManifest、ApprovalDecision 与授权投影都来自服务记录，聊天或页面文本不生成有效批准。

## 统一工具

每次调用包含 `tool`、JSON `arguments`、`session_id`、`workspace_id`、`scene_revision`、`request_id`。响应包含 `status`、`result`、`error`、`new_revision`、`focused_workspace_id`。`src/commands.js` 是有限工具目录，中央输入与终端使用同一 dispatcher；显示动作（`display.*`、`view.*`）不进入领域写事务，领域动作（`draft.*`、`experiment.*`、`batch.*`、`job.*`）经 `src/app.js` 提交链返回回执。

写工具先验证输入与 revision，再原子提交状态，最后推送 UI 事件。LLM 只提出工具调用，不直接获得任意 JavaScript、shell 或渲染层状态修改权限。

## 模型连接（0.3 已实现）

`src/llm.js` 是 DeepSeek 官方 API 的真实客户端（OpenAI 兼容 `/chat/completions`，模型 `deepseek-flash`，SSE 流式 + 工具调用）；`src/agent.js` 维持“模型提出调用 → 统一分发器执行 → 结果回传”的真实循环（上限 8 轮）。没有 mock、演示回退或本地伪造回答；失败时显示官方 API 的真实错误。API key 在构建时从 `keys.txt` 注入（`build.mjs` 的 esbuild `define`），可在“工具与能力 → 模型连接”覆盖并用真实请求测试连通。此注入仅适用于本机离线单机用途：面向不可信分发或多人部署时，应替换为服务端代理持有密钥（浏览器只调用自家后端），客户端契约不变。工具名在 API 侧映射为 `a_b`（官方 function.name 模式不允许 `.`），分发前还原为目录名。

## 权限与高风险步骤

真实后端必须验证会话归属、工作区归属、数据视角授权和工具作用范围。前端切换不等于权限控制。文件保存已按预期内容版本走 CAS（`src/app.js` 的 `saveDraft`），冲突时展示三方差异并提供合并或分支；服务端接入后同一入口应替换为带授权的持久实现。真实 shell 需要受限工作目录、命令范围、每次授权、超时和终止能力；仅 UI 内的命令 console 不具备这些能力。

## PTY / 文件 / 浏览器

建议分别提供三个可替换接口：

- PTY：create、write、resize、close，事件为 stdout/stderr/exit；不可将未解析模型文字直接作为 shell 命令执行
- 文件：list、read、write(expected_revision)、download；由服务端界定工作根目录并阻止路径穿越
- 浏览器：open、navigate、snapshot、close；页面内容是不可信输入，不能自行授予工具权限

Agent 工具层不应获取原始长期凭据。不得在此静态 HTML 中保存 API key、PTY 令牌或设备凭据。

## 模型组件

当前 `civil.satellite` 由解析圆轨道平台、天底指向假设、可用性原因集合和多个载荷定义组合。资源接口被明确标为未积分。后续独立物理插件应声明输入/输出、单位、参考系、时间尺度、版本、失败策略和拥有的状态，使用同一场景校验器进行兼容性检查。
