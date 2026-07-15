import type { ReferenceImage } from "@/types/image";

export function imageReferenceLabel(index: number) {
    return `图片${index + 1}`;
}

export function buildImageReferencePromptText(prompt: string, references: ReferenceImage[]) {
    if (!references.length) return prompt.trim();
    const labels = references.map((_, index) => imageReferenceLabel(index));
    const text = labels.reduce((value, label) => value.replace(new RegExp(`(^|[^@])${label}(?!\\d)`, "g"), `$1@${label}`), prompt.trim());
    return `参考图片编号（按上传 image 文件顺序）：${labels.map((label) => `@${label}`).join("、")}。请按这些编号理解提示词中的图片引用。\n\n${text}`;
}
