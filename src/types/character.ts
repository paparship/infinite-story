/**
 * 角色相关类型定义
 * 这些是引擎的数据插槽，AI生成的数据将填充这些结构
 */

/** 角色表情类型 */
export type Expression = 'default' | 'happy' | 'angry' | 'sad' | 'joy';

/** 角色位置 */
export type Position = 'left' | 'center' | 'right';

/** 角色基本信息 */
export interface CharacterInfo {
  /** 角色唯一标识 */
  id: string;
  /** 角色名称 */
  name: string;
  /** 角色主题色（十六进制，如 #FFB7C5） */
  color: string;
  /** 角色简介 */
  description?: string;
  /** 可用表情列表 */
  expressions: Expression[];
}

/** 角色立绘资源路径 */
export interface CharacterSprites {
  /** 角色ID */
  characterId: string;
  /** 各表情对应的图片路径 */
  sprites: Record<Expression, string>;
  /** 头像路径 */
  portrait?: string;
}
