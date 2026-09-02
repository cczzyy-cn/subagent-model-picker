/**
 * @dsh-external/dsh-subagent-model-picker — 让主会话模型从已配置模型里自主选择子代理模型。
 *
 * 提供两个工具：
 *   1. list_subagent_models  — 枚举当前部署“已配置”的 LLM provider 及其广告模型目录，
 *                              供主模型从中挑选（可被 modelPool 白名单收窄）。
 *   2. subagent_model        — 用一个由主模型选定的 provider/model（可选 reasoning_effort）
 *                              派生子代理，通过 ctx.subagents 的 request.agentOptions 生效。
 *
 * 模型解析语义（无覆盖时直接继承父会话 provider/model；本插件把“选中的模型”显式写进
 * agentOptions.provider/model，从而覆盖父子代理模型路由）。已配置模型目录通过
 * ctx.llm.listProviders() + listModels()（advisory）取得；若配置了 modelPool 白名单，
 * 则目录收窄到白名单，并在 subagent_model 中硬性校验。
 */
import type { Context } from 'cordis';
import z from 'schemastery';
export declare const name = "@dsh-external/dsh-subagent-model-picker";
export declare const inject: string[];
export interface Config {
    /** 默认 LLM provider 路由 id；缺省取父会话 agent 的 provider。 */
    defaultProvider?: string;
    /** 子代理“传输 provider”名（ctx.subagents.start 的第一参数）。缺省 'spawn'。 */
    subagentProvider?: string;
    /** 目录成员为 advisory；true 时 subagent_model 拒绝不在广告目录中的 model。 */
    strictCatalog?: boolean;
    /** 派生子代理的绝对深度上限。 */
    maxDepth?: number;
    /** 可选白名单：仅允许这些 provider/model 路由可选。 */
    modelPool?: Array<{
        provider: string;
        model: string;
    }>;
}
export declare const Config: z<Schemastery.ObjectS<{
    defaultProvider: z<string, string>;
    subagentProvider: z<string, string>;
    strictCatalog: z<boolean, boolean>;
    maxDepth: z<number, number>;
    modelPool: z<({
        provider?: string | null | undefined;
        model?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<{
        provider: z<string, string>;
        model: z<string, string>;
    }>[]>;
}>, Schemastery.ObjectT<{
    defaultProvider: z<string, string>;
    subagentProvider: z<string, string>;
    strictCatalog: z<boolean, boolean>;
    maxDepth: z<number, number>;
    modelPool: z<({
        provider?: string | null | undefined;
        model?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<{
        provider: z<string, string>;
        model: z<string, string>;
    }>[]>;
}>>;
export declare function apply(ctx: Context, config: Config): void;
