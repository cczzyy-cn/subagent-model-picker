# @dsh-external/dsh-subagent-model-picker

让主会话模型从「已配置模型」里**自主选择**子代理运行模型，并把选定路由通过 `ctx.subagents` 的
`request.agentOptions.provider/model` **显式覆盖**到子代理上。同时提供一张**插件配置卡片**，
让你为每个 `provider/model` 维护**能力描述**，作为主模型自主选型的依据。

这是一个**双面插件**，由两个包共同完成：

| 包 | 面 | 作用 |
|---|---|---|
| `@dsh-external/dsh-subagent-model-picker` | 宿主 | 注册设置命名空间 + `list_subagent_models` / `subagent_model` 工具 |
| `@dsh-external/dsh-client-ui-subagent-model-picker` | 浏览器 | 「设置 → 插件 → 插件配置」里的 **能力描述配置卡片** |

---

## 整体流程（主模型自主选型号）

1. **你维护能力描述**：在配置卡片里为每个 `provider/model` 填 `capabilities`
   （如 qwen 的 `27B·xxs量化·视觉·本地Ollama，新增描述：32K上下文，每秒50token`）。保存后写入
   `settings.yaml` 的 `subagent-model-picker.descriptions`。
2. **宿主插件**生成 `capabilityMap()`，并在 `list_subagent_models` 里给每个路由贴上 `[capabilities]`。
3. **主模型调 `list_subagent_models()`** 看到带能力标签的「菜单」（无参 = 列出**所有**已配置 provider）。
4. **主模型依据任务 + 能力标签做选型**（看视频→挑带“视觉”的；要低延迟/便宜→挑对应标签的）。
5. **主模型调 `subagent_model(provider, model, …)`** 点单。
6. **插件 `execute`** 解析 provider、做 `modelPool` 白名单校验与目录匹配度，
   组装 `agentOptions = { provider, model, reasoningEffort? }`，经 `ctx.subagents` 把子代理**绑定到所选模型**。
7. 子代理在该模型上跑任务，返回结果 / 可续接 id。

> 关键：把 `provider/model` 写进 `agentOptions` 从而**覆盖父子代理的默认继承路由**——子代理不会
> 沿袭父会话模型，而是运行在你显式指定的模型上。

---

## 配置卡片（浏览器）

`@dsh-external/dsh-client-ui-subagent-model-picker` 在「设置 → 插件 → 插件配置」注册一张
**可收起**的「子代理模型能力描述」卡：

- 从 `remote.session.modelCatalog()` 拉取可选模型，**下拉选择**具体 `provider/model`；
- 下方**能力描述输入框**（多行）+ **保存**按钮；
- 保存把该模型的能力描述写回 `subagent-model-picker` 命名空间；
- 采用 `@deepseek-ai/dsh-client-ui-primitives` 与 `--dsw-*` 设计 token，外观与其它插件卡一致；
- `settingsScope` 与 `remote.session` 为**嵌套注入（可选）**，且带 `missingPrimitives` 守卫：
  宿主缺少所需 primitive 或服务时，卡片优雅降级，不崩溃。

对应 `settings.yaml`：

```yaml
subagent-model-picker:
  descriptions:
    - provider: deepseek-official
      model: deepseek-v4-flash
      capabilities: 文本·快速·低延迟
    - provider: qwen
      model: qwen3.8-27b-iq3xxs-vision:latest
      capabilities: 27B·xxs量化·视觉·本地Ollama
```

---

## 工具

### `list_subagent_models`
枚举当前部署「已配置」的 LLM provider 及其模型目录（带能力标签）。

- **无参**：列出**每一个**已配置 provider（`deepseek-official`、`qwen` 等）。
- 带 `provider`：仅列出该 provider。
- 目录构成：`ctx.llm.listProviders()` + `listConfigurableProviders()` → `listModels(pid)`；
  **当 `listModels` 为空时**，回退读取该 provider 在设置段声明的模型（`declaredModels`，
  从 `settingsNs/settingsPath` 取），因此 `qwen` 这类「仅配置声明的本地 Ollama 路由」也会出现。
- 每条输出带 `[capabilities]`，供主模型选型。
- 目录成员是 advisory：adapter 可能接受未列出的 model id。

### `subagent_model`
用主模型选定的 `provider` + `model`（可选 `reasoning_effort`）派生子代理。

- 默认后台可续接（返回 durable `subagentId`）；`run_in_background:false` 前台等待结果。
- 通过 `agentOptions: { provider, model }` 覆盖子代理路由；省略时继承父会话路由。
- `modelPool`（白名单）非空时硬性校验，不在白名单的路由会被拒绝。
- `strictCatalog` 为 true 时拒绝不在广告目录里的 model。
- ⚠️ `model` 传**裸 model id**（provider 单独经 `provider` 传）；`list_subagent_models` 展示的
  `provider/model` 仅作展示，勿整串填入 `model`。

---

## 模型解析语义

子代理模型默认继承父会话的 `provider/model`；本插件在委派请求里写入 `agentOptions.provider/model`
从而**显式覆盖**。续接时这些值由 `dsh-subagent` 的持久化描述符（`agentProvider`/`agentModel`）还原，
保持同一模型。

---

## 安装

```bash
# 宿主插件（bundle，自动挂载）
dsh plugin --profile web add github:cczzyy-cn/subagent-model-picker#v0.3.2

# 浏览器配置卡片（普通依赖 + 需在 profile cordis.patch.yml 手动加一行 roster）
dsh plugin --profile web add github:cczzyy-cn/dsh-client-ui-subagent-model-picker#v0.1.8
```

profile `cordis.patch.yml` 追加：

```yaml
- insert:
  - id: client-subagent-model-picker
    name: '@dsh-external/dsh-client-ui-subagent-model-picker'
```

重启 `dsh web` 生效。

---

## 配置（宿主插件）

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `defaultProvider` | string | 父会话 provider | 缺省 LLM provider 路由 |
| `subagentProvider` | string | `spawn` | 子代理传输 provider（`ctx.subagents.start` 第一参数） |
| `strictCatalog` | boolean | `false` | true 时拒绝不在广告目录中的 model |
| `maxDepth` | number | `3` | 派生子代理的绝对深度上限 |
| `modelPool` | array | `[]` | 可选 provider/model 白名单 |

---

## 构建

```bash
# 宿主：编译 src → lib（需指向 dsh 源码 checkout）
DSH_CHECKOUT=/path/to/deepseek-harness bash scripts/build.sh
```

（浏览器卡片由 `dsh-client-ui-subagent-model-picker` 仓库用 harness 的 `clientBundle`/`tsdown` 构建。）

---

## 版本要点

- **v0.3.2** — `list_subagent_models` 无参调用**枚举所有** provider（此前被限制为默认 provider）；
  与卡片下拉一致，`qwen` 等非默认 provider 也会列出并可被选择。
- **v0.3.x** — `declaredModels` 兜底：`listModels` 为空时从设置段读取声明的模型，覆盖本地/网关路由。
- **v0.2.x** — 新增设置命名空间（`subagent-model-picker`）与能力描述、`list_subagent_models` 读取能力标签。
- **v0.1.x** — 基础双工具（`list_subagent_models` / `subagent_model`）+ `agentOptions` 覆盖路由。

---

## 已验证

- `list_subagent_models()` 列出 `deepseek-official`（flash / v4-pro / vision-exp）与 `qwen/qwen3.8-27b-iq3xxs-vision:latest`，并带能力标签。
- `subagent_model` 前台/后台均能在指定模型（含非默认 `qwen`）上运行子代理并返回结果/可续接 id。
- 配置卡片可收起、下拉选模型、保存能力描述并写回 `settings.yaml`；`list_subagent_models` 实时带出。
