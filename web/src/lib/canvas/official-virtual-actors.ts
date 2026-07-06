import type { OfficialVirtualActorBinding, StoryboardAsset } from "@/types/canvas";

export type OfficialVirtualActor = {
    id: string;
    name: string;
    description: string;
    traits: string[];
    keywords: string[];
    assetUri?: string;
};

export const OFFICIAL_VIRTUAL_ACTORS: OfficialVirtualActor[] = [
    {
        id: "cn-rural-father",
        name: "官方男演员 A｜中年父亲",
        description: "40-55 岁，东亚男性，沉默、沧桑、乡土感强，适合父亲、工人、村民、压抑型男性角色。",
        traits: ["男", "中年", "父亲", "农村", "沧桑"],
        keywords: ["男", "父亲", "爸爸", "中年", "40", "50", "农村", "村民", "工人", "沉默", "沧桑", "粗糙", "压抑"],
    },
    {
        id: "cn-young-son",
        name: "官方男演员 B｜青年儿子",
        description: "16-28 岁，东亚男性，清瘦、倔强、少年感，适合儿子、学生、青年打工者。",
        traits: ["男", "青年", "儿子", "少年", "倔强"],
        keywords: ["男", "儿子", "我", "少年", "青年", "学生", "年轻", "16", "18", "20", "清瘦", "倔强", "打工"],
    },
    {
        id: "cn-rural-mother",
        name: "官方女演员 C｜中年母亲",
        description: "45-65 岁，东亚女性，朴素、疲惫、温和克制，适合母亲、婶婶、乡村女性。",
        traits: ["女", "中年", "母亲", "朴素", "疲惫"],
        keywords: ["女", "母亲", "妈妈", "中年", "45", "50", "60", "农村", "朴素", "疲惫", "操劳", "温和"],
    },
    {
        id: "cn-young-woman",
        name: "官方女演员 D｜青年女主",
        description: "18-30 岁，东亚女性，清爽、柔和、自然，适合女主、护士、学生、职场新人。",
        traits: ["女", "青年", "女主", "清爽", "自然"],
        keywords: ["女", "女主", "女孩", "少女", "青年", "年轻", "学生", "护士", "职场", "清爽", "温柔", "自然"],
    },
    {
        id: "global-young-woman",
        name: "官方女演员 E｜国际化女性",
        description: "20-35 岁，国际化气质，镜头表现力强，适合主播、职场精英、都市角色。",
        traits: ["女", "青年", "都市", "职场", "国际化"],
        keywords: ["女", "主播", "都市", "职场", "精英", "模特", "国际", "自信", "时尚", "商务"],
    },
    {
        id: "period-warrior",
        name: "官方男演员 F｜硬朗古装",
        description: "30-45 岁，硬朗、武人气质，适合古装、将军、护卫、武侠和历史题材。",
        traits: ["男", "中年", "古装", "硬朗", "武人"],
        keywords: ["男", "古装", "将军", "武士", "护卫", "硬朗", "历史", "铠甲", "侠客", "军人"],
    },
];

export function matchOfficialVirtualActor(asset: Pick<StoryboardAsset, "name" | "description" | "prompt">): OfficialVirtualActorBinding {
    const text = `${asset.name} ${asset.description} ${asset.prompt}`.toLowerCase();
    const scored = OFFICIAL_VIRTUAL_ACTORS.map((actor) => {
        const keywordScore = actor.keywords.reduce((score, keyword) => score + (text.includes(keyword.toLowerCase()) ? 1 : 0), 0);
        const genderScore = genderHint(text, actor) ? 2 : 0;
        const ageScore = ageHint(text, actor) ? 2 : 0;
        return { actor, score: keywordScore + genderScore + ageScore };
    }).sort((a, b) => b.score - a.score);
    const best = scored[0]?.actor || OFFICIAL_VIRTUAL_ACTORS[0];
    const score = Math.max(scored[0]?.score || 0, 1);
    return officialActorBinding(best, {
        confidence: Math.min(96, 54 + score * 7),
        matchReason: buildMatchReason(asset, best),
    });
}

export function officialActorBinding(actor: OfficialVirtualActor, patch?: Partial<OfficialVirtualActorBinding>): OfficialVirtualActorBinding {
    return {
        id: actor.id,
        name: actor.name,
        description: actor.description,
        traits: actor.traits,
        assetUri: actor.assetUri || "",
        ...patch,
    };
}

export function officialActorById(id?: string) {
    return OFFICIAL_VIRTUAL_ACTORS.find((actor) => actor.id === id) || null;
}

export function isValidOfficialActorAssetUri(value?: string) {
    return /^asset:\/\/asset-[\w-]+$/i.test(normalizeOfficialActorAssetUri(value));
}

export function normalizeOfficialActorAssetUri(value?: string) {
    const trimmed = (value || "").trim();
    if (!trimmed) return "";
    if (/^asset:\/\/asset-[\w-]+$/i.test(trimmed)) return trimmed;
    if (/^asset-[\w-]+$/i.test(trimmed)) return `asset://${trimmed}`;
    return trimmed;
}

export function storyboardAssetReadyWithOfficialActor(asset: Pick<StoryboardAsset, "imageUrl" | "storageKey" | "officialActor">) {
    return Boolean(asset.imageUrl || asset.storageKey || isValidOfficialActorAssetUri(asset.officialActor?.assetUri));
}

function genderHint(text: string, actor: OfficialVirtualActor) {
    if (actor.traits.includes("男")) return /男|父|爸|儿子|少年|青年|丈夫|哥哥|弟弟|叔|伯|爷/.test(text);
    if (actor.traits.includes("女")) return /女|母|妈|女孩|少女|妻|姐姐|妹妹|婶|姨|奶/.test(text);
    return false;
}

function ageHint(text: string, actor: OfficialVirtualActor) {
    if (actor.traits.includes("中年")) return /中年|父|母|爸|妈|40|45|50|55|60|年迈|沧桑|操劳/.test(text);
    if (actor.traits.includes("青年")) return /青年|少年|少女|年轻|学生|18|20|24|28|儿子|女主/.test(text);
    return false;
}

function buildMatchReason(asset: Pick<StoryboardAsset, "name" | "description" | "prompt">, actor: OfficialVirtualActor) {
    const source = `${asset.name} ${asset.description} ${asset.prompt}`;
    const matched = actor.keywords.filter((keyword) => source.includes(keyword)).slice(0, 4);
    return matched.length ? `命中 ${matched.join("、")}，先用该官方脸作为 ${asset.name} 的演员底座。` : `按角色气质先匹配 ${actor.name}，可在右侧面板手动更换。`;
}
