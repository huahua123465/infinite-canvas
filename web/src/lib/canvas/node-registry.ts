import { create } from "zustand";

import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeDefinition } from "@/types/canvas-plugin";

const definitions = new Map<string, CanvasNodeDefinition>();
const ownerByType = new Map<string, string>();

export const useNodeRegistryVersion = create<{ version: number }>(() => ({ version: 0 }));

function bumpRegistryVersion() {
    useNodeRegistryVersion.setState((state) => ({ version: state.version + 1 }));
}

export function isBuiltinNodeType(type: string): type is CanvasNodeType {
    return (Object.values(CanvasNodeType) as string[]).includes(type);
}

export function registerNodeDefinitions(definitionsToRegister: CanvasNodeDefinition[], pluginId: string) {
    const seenTypes = new Set<string>();
    definitionsToRegister.forEach((definition) => {
        if (!definition.type?.trim()) throw new Error(`插件 ${pluginId} 包含无效节点类型`);
        if (seenTypes.has(definition.type)) throw new Error(`插件 ${pluginId} 重复声明节点类型 ${definition.type}`);
        if (isBuiltinNodeType(definition.type)) throw new Error(`插件 ${pluginId} 不能覆盖内置节点 ${definition.type}`);
        const owner = ownerByType.get(definition.type);
        if (owner && owner !== pluginId) throw new Error(`节点类型 ${definition.type} 已由插件 ${owner} 注册`);
        seenTypes.add(definition.type);
    });
    definitionsToRegister.forEach((definition) => {
        definitions.set(definition.type, definition);
        ownerByType.set(definition.type, pluginId);
    });
    bumpRegistryVersion();
}

export function unregisterPluginNodes(pluginId: string) {
    let changed = false;
    for (const [type, owner] of ownerByType) {
        if (owner !== pluginId) continue;
        definitions.delete(type);
        ownerByType.delete(type);
        changed = true;
    }
    if (changed) bumpRegistryVersion();
}

export function getNodeDefinition(type: string) {
    return definitions.get(type);
}

export function getNodePluginId(type: string) {
    return ownerByType.get(type) || type.split(":", 1)[0] || "unknown";
}

export function listNodeDefinitions() {
    return Array.from(definitions.values());
}

export function isRegisteredNodeType(type: string) {
    return isBuiltinNodeType(type) || definitions.has(type);
}

export function getPluginNodeSpec(type: string) {
    const definition = definitions.get(type);
    if (!definition) return null;
    return {
        width: definition.defaultSize.width,
        height: definition.defaultSize.height,
        title: definition.title,
        metadata: definition.defaultMetadata,
    };
}
