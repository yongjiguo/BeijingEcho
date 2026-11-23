// 人工参考等级：100=标志性目的地，90=热门经典，80=常见推荐，70=专题探索，60=小众探索。
// 分值是编辑判断，不代表实时流量、游客数量、官方景区等级或游览品质。
const tiers: Record<number, readonly string[]> = {
  100: ['forbidden-city', 'badaling-great-wall', 'mutianyu-great-wall', 'temple-of-heaven', 'summer-palace', 'tiananmen-square'],
  90: ['jingshan-park', 'beihai-park', 'shichahai', 'nanluoguxiang', 'yonghe-temple', 'qianmen-dashilan', 'old-summer-palace', '798-art-zone', 'wangfujing', 'prince-gong-mansion', 'national-museum', 'olympic-green'],
  80: ['guozijian-confucius-temple', 'ming-tombs', 'drum-bell-towers', 'houhai', 'panjiayuan-market', 'fragrant-hills', 'beijing-zoo', 'simatai', 'juyongguan', 'silk-street', 'hongqiao-market'],
  70: ['liulichang', 'ancient-observatory', 'capital-museum', 'ming-city-wall-park', 'baita-temple', 'dongjiaominxiang', 'soong-ching-ling', 'ditan-park', 'ritan-park', 'taimiao', 'zhongshan-park', 'baiyun-guan', 'dongyue-temple', 'tanzhe-temple', 'jietai-temple', 'lugou-bridge', 'zhoukoudian', 'cuandixia'],
  60: ['yuetan-park', 'big-bell-temple', 'zhihua-temple', 'fayuan-temple', 'wanshou-temple', 'dajue-temple', 'biyun-temple', 'wofu-temple', 'yunju-temple', 'yuandadu-park', 'huguang-guild-hall'],
};

const scores = new Map(Object.entries(tiers).flatMap(([score, ids]) =>
  ids.map((id) => [id, Number(score)] as const),
));

// 机场欢迎点及尚未评级的内容不显示分数，列表中排在已评级景点之后。
export function popularityScore(id: string): number | null {
  return scores.get(id) ?? null;
}

// 各页面共用同一热度标志，未评级内容不生成标志。
export function createPopularityBadge(id: string): HTMLSpanElement | null {
  const score = popularityScore(id);
  if (score == null) return null;
  const count = score / 10 - 3;
  const badge = document.createElement('span');
  badge.className = 'popularity-badge';
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', `Popularity: ${count} flames out of 7 — editorial rating`);
  badge.title = `Editorial popularity: ${count} / 7 — not live visitor data`;
  const label = document.createElement('span');
  label.textContent = 'Popularity';
  label.setAttribute('aria-hidden', 'true');
  badge.append(label);
  for (let i = 0; i < count; i++) {
    const flame = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    flame.setAttribute('viewBox', '0 0 24 26');
    flame.setAttribute('class', 'popularity-flame');
    flame.setAttribute('aria-hidden', 'true');
    flame.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M12 2C13 6 8 8 8 12c-2-1-2-3-2-3s-3 4-3 7a9 9 0 0 0 18 0c0-5-4-9-9-14Z');
    flame.append(path);
    badge.append(flame);
  }
  return badge;
}
