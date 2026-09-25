/**
 * 背景映射配置
 * 将脚本中的背景 ID 映射到实际文件路径
 */

/** 背景映射表 */
export const BACKGROUND_MAP: Record<string, string> = {
  // 学校外观
  school_gate: '/assets/shared/backgrounds/exterior/_school_entrance_1.jpg',
  school_entrance: '/assets/shared/backgrounds/exterior/_school_entrance_2.jpg',
  school_ground: '/assets/shared/backgrounds/exterior/_school_ground_1.jpg',
  
  // 教室
  classroom: '/assets/shared/backgrounds/interior/_back_of_classroom_1.jpg',
  class: '/assets/shared/backgrounds/interior/_back_of_classroom_1.jpg',
  
  // 走廊
  hallway: '/assets/shared/backgrounds/interior/_2nd_floor_hallway_1.jpg',
  corridor: '/assets/shared/backgrounds/interior/_2nd_floor_hallway_2.jpg',
  
  // 天台
  rooftop: '/assets/shared/backgrounds/exterior/_school_rooftop_1.jpg',
  rooftop_sunset: '/assets/shared/backgrounds/exterior/_school_rooftop_2.jpg',
  
  // 图书馆
  library: '/assets/shared/backgrounds/interior/_archive_room_1.jpg',
  
  // 中庭
  courtyard: '/assets/shared/backgrounds/exterior/_school_courtyard_bench_1.jpg',
  
  // 公园
  park: '/assets/shared/backgrounds/exterior/_park_in_spring_1.jpg',
  park_sunset: '/assets/shared/backgrounds/exterior/_park_in_autumn_4.jpg',
  
  // 街道
  street: '/assets/shared/backgrounds/exterior/_shopping_street_3.jpg',
  
  // 咖啡店
  cafe: '/assets/shared/backgrounds/interior/_cafe_1.jpg',
  
  // 默认
  default: '/assets/shared/backgrounds/exterior/_school_in_spring_1.jpg',
};

/**
 * 获取背景图片路径
 */
export function getBackgroundPath(bgId: string): string {
  return BACKGROUND_MAP[bgId] || BACKGROUND_MAP['default'];
}
