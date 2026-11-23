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
