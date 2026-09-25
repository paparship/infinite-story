export type PromptChannel = "text" | "image";

export interface PromptContract {
  id: string;
  version: string;
  channel: PromptChannel;
  templatePath: string;
  requiredVariables: string[];
  allowedVariables: string[];
  strictNoUnknownVariables: boolean;
  ruleHints?: string[];
}

export type PromptContractRegistry = Record<string, PromptContract>;

export const PROMPT_CONTRACT_VERSION = "v2.0.0";

const TEXT_COMMON_VARIABLES = [
  "PREFERRED_EFFECT",
  "EFFECT_NAME",
  "EFFECT_DESCRIPTION",
  "SEASON",
  "CHARACTER_TYPE",
  "MOOD",
  "CHAPTER1_SCRIPT",
  "SCRIPT_CONTENT",
  "TARGET_REGION",
  "CONTENT",
  "CHARACTER_A",
  "CHARACTER_B",
  "CHARACTER_C",
  "CHARACTER_A_PROFILE",
  "CHARACTER_B_PROFILE",
  "CHARACTER_C_PROFILE",
  "CHARACTER_NAME",
  "CHARACTER_PROFILE",
  "CHARACTER_PROFILE_SECTION",
  "BRANCH_CONTEXT",
  "ROUTE_ID",
];

const IMAGE_COMMON_VARIABLES = [
  "WORLD_SETTING",
  "CHARACTER_APPEARANCE",
  "CHARACTER_OUTFIT",
  "SCENE_DESCRIPTION",
  "CHARACTER_DESCRIPTION",
];

function createTextContract(
  id: string,
  templatePath: string,
  requiredVariables: string[]
): PromptContract {
  return {
    id,
    version: PROMPT_CONTRACT_VERSION,
    channel: "text",
    templatePath,
    requiredVariables,
    allowedVariables: Array.from(new Set([...TEXT_COMMON_VARIABLES, ...requiredVariables])),
    strictNoUnknownVariables: true,
    ruleHints: [
      "text_script_contract_v2",
      "prefer_route_markers:@route_start/@route_end",
      "no_unresolved_placeholders",
    ],
  };
}

function createImageContract(
  id: string,
  templatePath: string,
  requiredVariables: string[]
): PromptContract {
  return {
    id,
    version: PROMPT_CONTRACT_VERSION,
    channel: "image",
    templatePath,
    requiredVariables,
    allowedVariables: Array.from(new Set([...IMAGE_COMMON_VARIABLES, ...requiredVariables])),
    strictNoUnknownVariables: true,
    ruleHints: [
      "image_prompt_contract_v2",
      "no_unresolved_placeholders",
    ],
  };
}

export const PROMPT_CONTRACTS: PromptContractRegistry = {
  "text/chapter1_generation_v2": createTextContract(
    "text/chapter1_generation_v2",
    "prompts/text/chapter1_generation_v2.txt",
    ["PREFERRED_EFFECT"]
  ),
  "text/chapter2_branches": createTextContract(
    "text/chapter2_branches",
    "prompts/text/chapter2_branches.txt",
    [
      "PREFERRED_EFFECT",
      "CHARACTER_A",
      "CHARACTER_B",
      "CHARACTER_C",
      "CHARACTER_A_PROFILE",
      "CHARACTER_B_PROFILE",
      "CHARACTER_C_PROFILE",
      "CHAPTER1_SCRIPT",
    ]
  ),
  "text/chapter3_ending": createTextContract(
    "text/chapter3_ending",
    "prompts/text/chapter3_ending.txt",
    [
      "PREFERRED_EFFECT",
      "CHARACTER_NAME",
      "CHARACTER_PROFILE",
      "BRANCH_CONTEXT",
      "ROUTE_ID",
    ]
  ),
  "text/extract_characters": createTextContract(
    "text/extract_characters",
    "prompts/text/extract_characters.txt",
    ["CHAPTER1_SCRIPT"]
  ),
  "text/extract_settings": createTextContract(
    "text/extract_settings",
    "prompts/text/extract_settings.txt",
    ["CHAPTER1_SCRIPT"]
  ),
  "text/translate": createTextContract(
    "text/translate",
    "prompts/text/translate.txt",
    ["TARGET_REGION", "CONTENT"]
  ),
  "text/script_format": createTextContract(
    "text/script_format",
    "prompts/text/script_format.txt",
    []
  ),
  "text_v2/script_format": createTextContract(
    "text_v2/script_format",
    "prompts_v2/text/script_format_v2.txt",
    []
  ),
  "text_v2/chapter1_generation": createTextContract(
    "text_v2/chapter1_generation",
    "prompts_v2/text/chapter1_generation_v2.txt",
    ["PREFERRED_EFFECT"]
  ),
  "text_v2/chapter2_branches": createTextContract(
    "text_v2/chapter2_branches",
    "prompts_v2/text/chapter2_branches_v2.txt",
    [
      "PREFERRED_EFFECT",
      "CHARACTER_A",
      "CHARACTER_B",
      "CHARACTER_C",
      "CHAPTER1_SCRIPT",
    ]
  ),
  "text_v2/chapter3_ending": createTextContract(
    "text_v2/chapter3_ending",
    "prompts_v2/text/chapter3_ending_v2.txt",
    [
      "PREFERRED_EFFECT",
      "CHARACTER_NAME",
      "CHARACTER_PROFILE",
      "BRANCH_CONTEXT",
      "ROUTE_ID",
    ]
  ),
  "text_v2/extract_characters": createTextContract(
    "text_v2/extract_characters",
    "prompts_v2/text/extract_characters_v2.txt",
    ["SCRIPT_CONTENT"]
  ),
  "text_v2/extract_settings": createTextContract(
    "text_v2/extract_settings",
    "prompts_v2/text/extract_settings_v2.txt",
    ["SCRIPT_CONTENT"]
  ),
  "text_v2/translate": createTextContract(
    "text_v2/translate",
    "prompts_v2/text/translate_v2.txt",
    ["TARGET_REGION", "CONTENT"]
  ),
  "image/midjourney_character_sprite": createImageContract(
    "image/midjourney_character_sprite",
    "prompts/image/midjourney_character_sprite.txt",
    ["CHARACTER_APPEARANCE", "CHARACTER_OUTFIT"]
  ),
  "image/nanobanana_cg": createImageContract(
    "image/nanobanana_cg",
    "prompts/image/nanobanana_cg.txt",
    ["SCENE_DESCRIPTION", "CHARACTER_DESCRIPTION"]
  ),
  "image_v2/midjourney_character_sprite": createImageContract(
    "image_v2/midjourney_character_sprite",
    "prompts_v2/image/midjourney_character_sprite_v2.txt",
    ["CHARACTER_APPEARANCE", "CHARACTER_OUTFIT"]
  ),
  "image_v2/nanobanana_cg": createImageContract(
    "image_v2/nanobanana_cg",
    "prompts_v2/image/nanobanana_cg_v2.txt",
    ["SCENE_DESCRIPTION", "CHARACTER_DESCRIPTION"]
  ),
};

export function getPromptContract(id: string): PromptContract {
  const contract = PROMPT_CONTRACTS[id];
  if (!contract) {
    throw new Error(`未知提示词契约: ${id}`);
  }
  return contract;
}

