export interface MidjourneyPromptOptions {
  aspectRatio: string;
  stylize?: number;
  model?: string;
  seed?: string | number;
  characterReferenceUrl?: string;
  negativePrompt?: string;
  negativeLimit?: number;
}

/** Gemini 3 Image Prompt Options */
export interface Gemini3PromptOptions {
  positivePrompt: string;
  negativePrompt?: string;
  seed?: string | number;
  characterReferenceUrl?: string;
}

export function sanitizeMidjourneyPositive(text: string): string {
  return text
    .replace(/胸口/g, "身前")
    .replace(/胸前/g, "身前")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildMidjourneyPrompt(
  positivePrompt: string,
  options: MidjourneyPromptOptions
): string {
  const chunks: string[] = [sanitizeMidjourneyPositive(positivePrompt)];
  chunks.push(`--ar ${options.aspectRatio}`);
  if (options.stylize !== undefined) chunks.push(`--s ${options.stylize}`);
  if (options.model) chunks.push(options.model);
  if (options.seed !== undefined && options.seed !== "") chunks.push(`--seed ${options.seed}`);
  if (options.characterReferenceUrl) chunks.push(`--cref ${options.characterReferenceUrl}`);

  if (options.negativePrompt) {
    const limit = options.negativeLimit ?? 10;
    const negativeShort = options.negativePrompt
      .split(",")
      .map(t => t.trim())
      .filter(Boolean)
      .slice(0, limit)
      .join(", ");
    if (negativeShort) chunks.push(`--no ${negativeShort}`);
  }

  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * 仅截断内容段，保留 MJ 参数段。
 */
export function truncateMidjourneyPromptPreserveParams(prompt: string, maxPromptLength: number): string {
  if (prompt.length <= maxPromptLength) return prompt;

  const paramMatch = prompt.match(/\s+(--ar\s+\S+.*)$/);
  const mjParams = paramMatch ? paramMatch[1] : "";
  const content = paramMatch ? prompt.substring(0, paramMatch.index) : prompt;
  const maxContentLength = maxPromptLength - mjParams.length - 1;
  if (maxContentLength <= 0) {
    return prompt.substring(0, maxPromptLength);
  }

  if (content.length <= maxContentLength) return prompt;
  const truncated = content.substring(0, maxContentLength);
  const lastComma = truncated.lastIndexOf(",");
  const truncatedContent = lastComma > 0 ? truncated.substring(0, lastComma) : truncated;
  return mjParams ? `${truncatedContent} ${mjParams}` : truncatedContent;
}

/**
 * 为 Gemini 3 Image 构建文本提示词
 * Gemini 3 Image API 不需要 --ar, --s, --cref 等参数
 * 参考图通过 image_url 参数传递，文本 prompt 纯描述
 * 宽高比通过 prompt 描述指定
 */
export function buildGemini3Prompt(options: Gemini3PromptOptions): string {
  let prompt = "anime style, horizontal wide angle view, 16:9 aspect ratio, cinematic composition, ";

  prompt += sanitizeMidjourneyPositive(options.positivePrompt);

  // 添加 seed 提示
  if (options.seed !== undefined && options.seed !== "") {
    prompt += `\n[RandomSeed] ${options.seed}`;
  }

  return prompt;
}

