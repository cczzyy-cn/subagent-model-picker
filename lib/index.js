import { defineTool } from '@deepseek-ai/dsh-tools';
import z from 'schemastery';
export const name = "@dsh-external/dsh-subagent-model-picker";
export const inject = ['tools', 'subagents', 'llm', 'systemPrompt', 'settings'];
/** Settings namespace carrying user-authored per-model capability descriptions. */
export const SETTINGS_NS = 'subagent-model-picker';
/** One user-authored capability annotation for a given provider/model route. */
export const ModelDescription = z.object({
    provider: z.string(),
    model: z.string(),
    capabilities: z.string().default(''),
});
/** Settings namespace schema: a list of per-model capability descriptions. */
export const SettingsSchema = z.object({
    descriptions: z.array(ModelDescription).default([]),
});
export const Config = z.object({
    // Note: schemastery object fields are optional unless `.required()` is set,
    // so omitting defaultProvider at runtime is valid and falls back to the
    // parent Agent provider (see parentRoute).
    defaultProvider: z.string(),
    subagentProvider: z.string().default('spawn'),
    strictCatalog: z.boolean().default(false),
    maxDepth: z.natural().default(3),
    modelPool: z.array(z.object({
        provider: z.string(),
        model: z.string(),
    })).default([]),
});
/** 从 exec.agent 的 AgentOptions 读取 LLM provider/model 路由。 */
function parentRoute(agent) {
    const options = agent?.options ?? {};
    return {
        provider: options.provider,
        model: options.model,
    };
}
export function apply(ctx, config) {
    // 运行时服务（宿主注入），这里用 loose access 避免引入 subagent/llm 的编译期类型耦合。
    const getSubagents = () => ctx.get('subagents');
    const getLlm = () => ctx.get('llm');
    // 每个模型的能力描述：取自本插件注册的设置命名空间，供主会话挑选时参考。
    const getSettings = () => ctx.get('settings');
    const settingsScope = getSettings()?.register?.(SETTINGS_NS, SettingsSchema);
    const capabilityMap = () => {
        const map = new Map();
        const value = settingsScope?.get?.();
        for (const d of value?.descriptions ?? []) {
            if (d && typeof d.provider === 'string' && typeof d.model === 'string') {
                map.set(`${d.provider}/${d.model}`, d.capabilities || '');
            }
        }
        return map;
    };
    /**
     * The models a configurable provider declares in its settings section.
     * Used as a fallback when the live adapter's `listModels` is empty in the
     * agent context, so `list_subagent_models` stays consistent with the card
     * dropdown (which surfaces declared/config-only routes like a local Ollama).
     * Reads via the settings service's `get(ns)` (no registration, no conflict).
     */
    async function declaredModels(pid, llm) {
        const configured = (llm.listConfigurableProviders?.() ?? []);
        const entry = configured.find((c) => (c?.provider ?? c?.id) === pid);
        if (!entry)
            return [];
        const ns = entry.settingsNs;
        if (typeof ns !== 'string' || ns.length === 0)
            return [];
        try {
            const value = getSettings()?.get?.(ns) ?? {};
            let section = value;
            for (const seg of entry.settingsPath ?? [])
                section = section?.[seg];
            const models = section?.models;
            return Array.isArray(models) ? models : [];
        }
        catch {
            return [];
        }
    }
    /** 计算“已配置模型”目录：一或多个 provider 的广告模型，可按 modelPool 收窄。 */
    async function catalog(providerId) {
        const llm = getLlm();
        const descMap = capabilityMap();
        let providerIds;
        if (providerId) {
            providerIds = [providerId];
        }
        else {
            const providers = (llm.listProviders?.() ?? []);
            const configured = (llm.listConfigurableProviders?.() ?? []);
            const ids = [
                ...providers.map((p) => p?.id ?? p?.provider ?? p?.name),
                ...configured.map((c) => c?.provider ?? c?.id),
            ];
            providerIds = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
        }
        const pool = config.modelPool ?? [];
        const out = [];
        for (const pid of providerIds) {
            let models = [];
            try {
                models = (await llm.listModels?.(pid)) ?? [];
            }
            catch {
                models = [];
            }
            // A declared/config provider (e.g. a gateway or local Ollama route) may
            // not answer listModels in the agent context while still being selectable
            // through the catalog card. Fall back to the models it declares in its
            // settings section so the tool stays consistent with the card dropdown.
            if (models.length === 0) {
                models = (await declaredModels(pid, llm)) ?? [];
            }
            for (const model of models) {
                const id = model?.id;
                const name = model?.name ?? id;
                if (typeof id !== 'string' || id.length === 0)
                    continue;
                if (pool.length > 0 && !pool.some((r) => r.provider === pid && r.model === id))
                    continue;
                const cap = descMap.get(`${pid}/${id}`);
                out.push(cap ? { provider: pid, id, name, capabilities: cap } : { provider: pid, id, name });
            }
        }
        return out;
    }
    // ── 工具 1：list_subagent_models ───────────────────────────────────────────
    ctx.effect(() => ctx.tools.register(defineTool({
        name: 'list_subagent_models',
        description: "List the LLM routes (provider + model) that are currently configured for subagents, so you can pick one to delegate with. Call with no arguments to list models across every registered provider, or with `provider` to list only that provider's advertised models. Catalog membership is advisory: an adapter may accept an unlisted model id. Use a returned `provider` and `id` with the `subagent_model` tool's `provider` and `model` fields.",
        parameters: {
            provider: {
                type: 'string',
                description: 'Optional provider route id to restrict the listing to; omit to list every registered provider.',
            },
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: String(value) }],
        },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            // No `provider` arg -> enumerate every configured provider (matches the
            // tool description). Only restrict to one route when the caller asks.
            const provider = args.provider;
            const models = await catalog(provider);
            if (models.length === 0) {
                return provider
                    ? `No configured models found for provider "${provider}".`
                    : 'No configured LLM models are currently advertised (listProviders/listModels returned empty).';
            }
            const lines = models.map((m) => {
                const cap = m.capabilities ? ` [${m.capabilities}]` : '';
                return `${m.provider}/${m.id} — ${m.name}${cap}`;
            });
            const heading = provider
                ? `Configured models for provider "${provider}":`
                : 'Configured LLM models available for subagents:';
            return [heading, ...lines.map((line) => `- ${line}`)].join('\n');
        },
    })), '@dsh-external/dsh-subagent-model-picker: list_subagent_models');
    // ── 工具 2：subagent_model ────────────────────────────────────────────────
    ctx.effect(() => ctx.tools.register(defineTool({
        name: 'subagent_model',
        description: "Delegate a self-contained task to a subagent that runs on a model you explicitly choose from the configured routes (see `list_subagent_models`). Supply `provider` and `model` together (after listing them). If you omit them, the child inherits the parent Agent's route. Omit `run_in_background` to default to a background continuable child; set it false to wait for the result.",
        parameters: {
            description: {
                type: 'string',
                required: true,
                description: 'A short (3-5 word) description of the delegated task, for display.',
            },
            prompt: {
                type: 'string',
                required: true,
                description: 'The complete, self-contained task for the subagent. It does not share this conversation, so include everything it needs.',
            },
            model: {
                type: 'string',
                required: true,
                description: 'The model id to run the subagent on, chosen from `list_subagent_models` (e.g. qwen3.8-27b-iq3xxs-vision:latest).',
            },
            provider: {
                type: 'string',
                description: 'The provider route id that owns `model`. Defaults to the parent Agent provider.',
            },
            reasoning_effort: {
                type: 'string',
                description: 'Optional reasoning effort for the selected model route.',
            },
            run_in_background: {
                type: 'boolean',
                description: 'Whether to return a durable continuable subagent id immediately. Defaults to true. Set false to wait for the result.',
            },
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: String(value) }],
        },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            const parent = exec.agent;
            if (!parent)
                throw new Error('subagent_model requires a calling agent (exec.agent was undefined)');
            const provider = args.provider ?? config.defaultProvider ?? parentRoute(parent).provider;
            if (!provider)
                throw new Error('subagent_model: could not resolve an LLM provider — pass `provider` or set config.defaultProvider');
            // 白名单校验（modelPool 非空时硬性限制）。
            const pool = config.modelPool ?? [];
            if (pool.length > 0 && !pool.some((r) => r.provider === provider && r.model === args.model)) {
                throw new Error(`subagent_model: route "${provider}/${args.model}" is not in the configured modelPool allow-list`);
            }
            // advisory 目录匹配度（仅标记，不拒绝；除非 strictCatalog）。
            const advertised = await catalog(provider);
            const known = advertised.some((m) => m.provider === provider && m.id === args.model);
            if (config.strictCatalog && !known) {
                throw new Error(`subagent_model: model "${provider}/${args.model}" is not in the advertised catalog for provider "${provider}"`);
            }
            const agentOptions = { provider, model: args.model };
            if (args.reasoning_effort)
                agentOptions.reasoningEffort = args.reasoning_effort;
            const subagents = getSubagents();
            const transport = config.subagentProvider ?? 'spawn';
            const registeredNames = subagents.list?.() ?? [];
            const transportName = registeredNames.includes(transport)
                ? transport
                : registeredNames[0];
            if (!transportName)
                throw new Error('subagent_model: no ctx.subagents provider is registered');
            const maxDepth = config.maxDepth;
            const request = {
                label: args.description,
                parent,
                prompt: [{ type: 'text', text: args.prompt }],
                ...(maxDepth !== undefined ? { maxDepth } : {}),
                agentOptions,
            };
            const runInBackground = args.run_in_background ?? true;
            if (runInBackground) {
                const { childId } = await subagents.startContinuable({
                    provider: transportName,
                    label: args.description,
                    request: {
                        parent,
                        prompt: request.prompt,
                        ...(maxDepth !== undefined ? { maxDepth } : {}),
                        agentOptions,
                    },
                    signal: exec.signal,
                });
                const note = known ? '' : ' (model not currently in the advertised catalog; requested anyway)';
                return `started subagent ${childId} on ${provider}/${args.model}${note}`;
            }
            // 前台：等待结果并收集文本。
            const run = await subagents.start(transportName, { ...request, signal: exec.signal });
            const result = await run.result;
            await run.dispose();
            const output = (result.output ?? [])
                .filter((b) => b?.type === 'text')
                .map((b) => b?.text ?? '')
                .join('');
            const note = known ? '' : ' (model not currently in the advertised catalog; requested anyway)';
            return `subagent ${run.id} finished on ${provider}/${args.model}${note}${output ? `\n\n${output}` : ''}`;
        },
    })), '@dsh-external/dsh-subagent-model-picker: subagent_model');
    // 引导主模型：可先用 list_subagent_models 挑选模型再委派。
    ctx.systemPrompt.section({
        name: 'tool:subagent-model-picker',
        order: 116.6,
        text: 'You may choose the model a subagent runs on. Use `list_subagent_models` to see the configured LLM routes, then call `subagent_model` with the selected `provider` and `model`. Omit them to inherit the parent route.',
    });
}
//# sourceMappingURL=index.js.map