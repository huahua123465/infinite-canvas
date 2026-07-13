import type { StoryboardAsset } from "@/types/canvas";

export function storyboardAssetImagePrompt(asset?: StoryboardAsset, options?: { hasReferenceImage?: boolean }) {
    if (!asset) return "";
    const prompt = neutralizeSensitiveVisualTerms(asset.prompt.trim() || asset.description.trim());
    if (!prompt) return "";
    if (asset.kind === "scene") return `${prompt}\n\n资产类型：纯场景空镜。画面中禁止出现人物、角色、人脸、身体、手部、背影、剪影、路人或任何活人；只呈现场景空间、环境陈设、道具位置、光线、材质和地域时代质感。`;
    if (asset.kind === "prop") return `${prompt}\n\n资产类型：纯道具静物。画面中禁止出现人物、角色、人脸、身体、手部、背影、剪影或任何人持握；只呈现道具本身及其材质、磨损、摆放环境和光影。若道具是遗照、照片、证件或奖状，可以呈现道具内部的照片或证件内容，但现场画面不能出现真实人物。`;
    if (asset.kind !== "character") return prompt;
    const stage = asset.lifeStage?.trim() || inferStoryboardCharacterLifeStage(asset);
    const baseName = asset.baseName?.trim() || asset.name.split(/[·・]/)[0] || asset.name || "角色";
    return [
        "生成一张横向 16:9、高分辨率的单一角色设定图，用于后续 AI 图像与视频生成时锁定同一人物身份，不是人物简介、简历或海报。",
        options?.hasReferenceImage
            ? "已连接参考素材：输入图是最高优先级身份与画风参考。必须忠实保留输入人物的面部骨相、眼睛、眉毛、鼻子、嘴巴、脸部轮廓、发型、发色、肤质、体型、气质和服装印象，所有面板都应能明确看出是输入图中的同一人物；禁止换脸、重塑面部、改变画风或过度美化。"
            : "当前没有人物参考图，请严格依据以下角色原始设定建立唯一、明确、可复用的面部身份；同一设定图的所有面板必须共享完全一致的脸、年龄、发型、体型和服装。",
        `角色：${asset.name || baseName}${stage ? `；年龄/时期状态：${stage}` : ""}。`,
        `角色原始设定：${prompt}`,
        characterStyleLock(prompt),
        "画面形式：白色至浅灰色纯净背景，细线分区、整齐留白、清晰易读的专业角色制作资料布局。正面全身主视图和正面脸部特写必须最大、最清晰，其他面板作为辅助，不得平均缩小成密集缩略图。",
        "全身设定：同一角色的正面、侧面、背面完整站姿，头顶到鞋底全部可见；三视图必须使用同一年龄状态、同一张脸、同一发型、同一体型、同一套服装、同一配色、同一材质与同一画风。",
        "脸部角度：清晰呈现正面、侧脸、斜侧 45 度，并补充斜左、斜右、俯视、仰视和后脑部；各角度保持五官比例、面部轮廓、发际线和年龄特征稳定。",
        "表情参考：平常、微笑、开怀笑、认真、惊讶、害羞、思考、苦恼；表情只能改变肌肉状态，不能改变脸型、五官比例、年龄或妆容。",
        "细节参考：独立展示眼睛、眉毛、鼻子、嘴巴、耳朵、脸部轮廓、皮肤质感，以及刘海、侧发、后发和发丝走向；细节必须来自同一角色，不得生成重复脸或陌生五官。",
        "服装要求：原始设定或参考图中服装明确时保持不变；看不清全身时，只补全与原始年代、身份和生活环境一致的自然服装。所有视图服装结构统一，避免暴露、性感、内衣或泳装。",
        "文字规则：优先不生成任何文字；如模型必须添加面板标签，只能使用简短、清晰、可读的中文，不得使用英文、其他语言、长篇说明或乱码。",
        "严格禁止：其他人物、不同年龄版本、成长时间线、多人合照、剧情场景、杂乱背景、面部改变、发型发色改变、服装不统一、体型改变、过度美化、过度简化、杂志简介、简历、海报、姓名年龄性格爱好说明、随机物件、低分辨率、面部扭曲、奇怪眼睛、崩坏手指、重复的脸、Logo、水印、UI。",
        "敏感经历只通过行动状态、朴素衣着和克制表情呈现，不展示暴力痕迹、血迹、裸露或刺激性伤害细节。",
    ].join("\n");
}

export function inferStoryboardCharacterLifeStage(asset: Pick<StoryboardAsset, "name" | "description" | "prompt">) {
    const source = [asset.name, asset.description, asset.prompt].filter(Boolean).join(" ");
    if (/童年|儿童|小孩|小时候|年少|少年|少女|年轻|青年|年轻女性角色|年轻角色/.test(source)) return "年少/年轻时期";
    if (/老年|老人|年迈|白发|晚年/.test(source)) return "老年时期";
    if (/中年|父亲|母亲|爸爸|妈妈/.test(source)) return "中年时期";
    if (/成年|成人/.test(source)) return "成年时期";
    return "";
}

function characterStyleLock(prompt: string) {
    const photoreal = /写实|纪实|真人|真实摄影|实拍|电影感|真实皮肤|生活颗粒/.test(prompt) && !/非写实|不要写实|避免写实/.test(prompt);
    if (photoreal) return "风格锁定：真人纪实摄影与电影定妆资料质感，真实中国人物面部骨相、自然皮肤纹理、真实发丝、真实旧布料和自然光，低饱和生活影像；保持普通人的真实体态与年代感，不使用动漫、漫画、插画、2.5D、3D 建模、游戏角色、手办、塑料皮肤或夸张美化。";
    if (/动画|漫画|插画|2\.5D|3D|水墨|黏土|定格|皮克斯|二次元/.test(prompt)) return "风格锁定：严格继承角色原始设定中的动画、漫画、插画、3D、水墨或其他指定风格，不擅自改成真人摄影。";
    return "风格锁定：严格继承角色原始设定和全片项目设定中的画风，不擅自写实化、动画化、漫画化或改变媒介质感。";
}

function neutralizeSensitiveVisualTerms(text: string) {
    return text
        .replace(/十[几来]岁|未成年(?:人)?/g, "年轻")
        .replace(/小女孩|幼女/g, "年少时期女性角色")
        .replace(/左腿残疾|左腿明显不便|腿部残疾|残疾|残废|瘸(?:腿)?|跛脚|断腿/g, "行动不便")
        .replace(/瘦小|瘦弱|营养不良/g, "身形单薄")
        .replace(/破旧|破烂|衣衫褴褛/g, "朴素旧衣")
        .replace(/草鞋/g, "旧布鞋")
        .replace(/受虐|虐待|伤痕|血迹|流血|伤口/g, "生活艰难")
        .replace(/痛苦|苦难|可怜/g, "克制坚韧")
        .replace(/\s+/g, " ")
        .trim();
}
