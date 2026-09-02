# @dsh-external/dsh-subagent-model-picker

让主会话模型从「已配置模型」里**自主选择**子代理运行模型，并把选定路由通过 `ctx.subagents` 的 `request.agentOptions.provider/model` 显式覆盖到子代理上。

## 能力

注册两个工具（均可在子代理模型面直接调用）：

- `list_subagent_models`
  枚举当前部署「已配置」的 LLM provider 及其广告模型目录，供主模型挑选。
  - 无参：枚举执行作用域内可见的 provider 及其模型。
  - 带 `provider`：枚举指定 provider 的广告模型（可显式列出 `qwen` 等非默认 provider）。
  - 目录成员是 advisory（`ctx.llm.listModels` 语义）：adapter 可能接受未列出的 model id。

- `subagent_model`
  用一个由主模型选定的 `provider` + `model`（可选 `reasoning_effort`）派生子代理。
  - 默认后台可续接（返回 durable `subagentId`）；`run_in_background:false` 前台等待结果。
  - 通过 `agentOptions: { provider, model }` 覆盖子代理模型路由；省略时继承父会话路由。
  - 可选 `modelPool` 白名单：非空时只允许这些 provider/model 路由（并在列表与校验中收窄）。
  - ⚠️ `model` 传**裸 model id**（provider 单独经 `provider` 传）。`list_subagent_models` 显示的
    `provider/model`（如 `qwen/qwen3.8-27b-iq3xxs-vision:latest`）仅作展示，勿整串填入 `model`，
    否则会触发 `provider "qwen" has no configured model "qwen/qwen3.8-...` 报错。

## 模型解析语义

子代理模型默认继承父会话的 `provider/model/maxTokens`。本插件在委派请求里写入
`agentOptions.provider/model`，从而**显式覆盖**父子代理模型路由；续接时这些值由
`dsh-subagent` 的持久化描述符（`agentProvider`/`agentModel`）还原，保持同一模型。

「已配置模型」由 `ctx.llm.listProviders()` + `listConfigurableProviders()` + `listModels()` 提供。

## 构建与注入

```bash
DSH_CHECKOUT=<dsh-monorepo> bash scripts/build.sh   # 编译 src → lib
# 注入器环境内：
dev_inject_plugin <本目录>
```

## 配置

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `defaultProvider` | string | 父会话 provider | 缺省 LLM provider 路由 |
| `subagentProvider` | string | `spawn` | 子代理传输 provider（`ctx.subagents.start` 第一参数） |
| `strictCatalog` | boolean | `false` | true 时拒绝不在广告目录中的 model |
| `maxDepth` | number | `3` | 派生子代理的绝对深度上限 |
| `modelPool` | array | `[]` | 可选 provider/model 白名单 |

## 已验证

- 构建通过（`DSH_CHECKOUT=deepseek-harness`），`dev_inject_plugin` 注入成功，loader 为 `[active]`。
- `list_subagent_models(provider="qwen")` → 列出 `qwen/qwen3.8-27b-iq3xxs-vision:latest`。
- `list_subagent_models()` → 列出 `deepseek-official` 的 3 个模型。
- `subagent_model` 前台派生子代理于 `deepseek-official/deepseek-v4-flash`（非默认模型），返回结果。
- `subagent_model` 后台派生子代理于 `deepseek-official/deepseek-v4-flash`，返回 durable id 并出现于 `list_agents`（`ready`），子代理确认“已按选定模型运行”。

## 已知限制

- 工具运行在 **agent 作用域**下，`ctx.llm.listProviders()`/`listConfigurableProviders()` 只枚举当前 agent
  活跃的 provider（此处为 `deepseek-official`），因此无参列表默认不含 `qwen` 等非默认 provider；
  需用 `list_subagent_models(provider="qwen")` 显式枚举，或用 `subagent_model` 直接指定
  `provider` + `model`。部署侧可通过 `modelPool` 显式声明允许路由以覆盖此作用域差异。
