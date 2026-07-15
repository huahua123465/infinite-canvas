import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { localForageStorage } from "@/lib/localforage-storage";
import type { ModelCapability } from "@/stores/use-config-store";

type ModelScriptStore = {
    scripts: Record<string, string>;
    setScript: (capability: ModelCapability, model: string, script: string) => void;
};

const MODEL_SCRIPT_STORE_KEY = "infinite-canvas:model_script_store";

export const useModelScriptStore = create<ModelScriptStore>()(
    persist(
        (set) => ({
            scripts: {},
            setScript: (capability, model, script) =>
                set((state) => {
                    const key = modelScriptKey(capability, model);
                    const scripts = { ...state.scripts };
                    const value = script.trim();
                    if (value) scripts[key] = value;
                    else delete scripts[key];
                    return { scripts };
                }),
        }),
        {
            name: MODEL_SCRIPT_STORE_KEY,
            storage: createJSONStorage(() => localForageStorage),
            partialize: (state) => ({ scripts: state.scripts }),
        },
    ),
);

export function readModelScript(scripts: Record<string, string>, capability: ModelCapability, model: string) {
    return scripts[modelScriptKey(capability, model)]?.trim() || "";
}

export async function resolveModelScript(capability: ModelCapability, model: string) {
    if (!useModelScriptStore.persist.hasHydrated()) await useModelScriptStore.persist.rehydrate();
    return readModelScript(useModelScriptStore.getState().scripts, capability, model);
}

function modelScriptKey(capability: ModelCapability, model: string) {
    return `${capability}:${model.trim()}`;
}
