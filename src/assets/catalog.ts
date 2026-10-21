import generated from './generated/manifest.json';

export const assetManifest = generated;
export type AssetId = keyof typeof generated.assets;
export const assetIds = Object.keys(generated.assets) as AssetId[];
export const getAsset = (id: AssetId) => assetManifest.assets[id];
export const assetUrl = (id: AssetId): string => `${import.meta.env.BASE_URL}${getAsset(id).path}?v=${getAsset(id).sha256}`;

const labels: Readonly<Record<string, string>> = {
  'powerup-magnet': '磁铁道具',
  'powerup-shield': '护盾道具',
  'powerup-double-score': '双倍得分道具',
  roadblock: '施工路障',
  'traffic-cone': '交通锥',
  'street-lamp': '城市路灯',
  'city-building-01': '住宅建筑',
  'city-building-02': '办公建筑',
  'city-runner': 'City Runner 城市跑者',
};
export const assetLabel = (id: AssetId): string => labels[id] ?? id;
