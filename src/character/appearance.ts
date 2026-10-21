/** Free wardrobe variants of one City Runner, with identical geometry and rules. */
export const SKIN_IDS = ['original-orange', 'neon-cyan', 'midnight-violet'] as const;
export type SkinId = typeof SKIN_IDS[number];
export interface CharacterSkin {
  readonly id: SkinId;
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly colors: Readonly<{ jacket: string; pants: string; shoe: string }>;
}
export const CHARACTER_SKINS: readonly CharacterSkin[] = Object.freeze([
  Object.freeze({ id: 'original-orange', name: 'Original Orange', label: '原色暖橙', description: 'City Runner 的经典城市配色。', colors: Object.freeze({ jacket: '#F47B45', pants: '#253241', shoe: '#F5EEE1' }) }),
  Object.freeze({ id: 'neon-cyan', name: 'Neon Cyan', label: '霓虹青蓝', description: '青蓝外套，深海蓝裤装与浅色运动鞋。', colors: Object.freeze({ jacket: '#32C5CF', pants: '#203D54', shoe: '#E4F4EF' }) }),
  Object.freeze({ id: 'midnight-violet', name: 'Midnight Violet', label: '午夜紫罗兰', description: '紫罗兰外套，深紫裤装与暖白运动鞋。', colors: Object.freeze({ jacket: '#9C79DF', pants: '#322B49', shoe: '#F3E9DA' }) }),
]);
export function isSkinId(value: unknown): value is SkinId {
  return value === 'original-orange' || value === 'neon-cyan' || value === 'midnight-violet';
}
export function getCharacterSkin(id: SkinId): CharacterSkin {
  const skin = CHARACTER_SKINS.find((entry) => entry.id === id);
  if (!skin) throw new Error(`未知 City Runner 外观：${id}`);
  return skin;
}
