import { seedanceModelFixedResolution } from "@/lib/seedance-video";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

export function cangyuanSeedanceFixedResolution(config: AiConfig, selectedModel = config.model || config.videoModel) {
    const model = modelOptionName(selectedModel);
    const fixedResolution = seedanceModelFixedResolution(model);
    if (!fixedResolution) return "";
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    return requestConfig.apiFormat === "cangyuan" || requestConfig.baseUrl.toLowerCase().includes("ai.cangyuansuanli.cn") ? fixedResolution : "";
}
