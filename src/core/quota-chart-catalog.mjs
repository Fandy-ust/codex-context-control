// Both native and web views render this ordered catalog from the API response.
export const QUOTA_SECTIONS = [
  {id: 'overview', title: '概览', chartIds: ['weekly', 'windows', 'weekly-scatter', 'five-hour-scatter', 'efficiency', 'weeks']},
  {id: 'trends', title: '趋势', chartIds: ['weekly', 'weeks', 'cumulative', 'forecast', 'hours']},
  {id: 'relationships', title: '换算关系', chartIds: ['weekly-scatter', 'five-hour-scatter', 'efficiency', 'models', 'cache', 'distribution', 'boxplot']},
  {id: 'windows', title: '窗口与明细', chartIds: ['windows', 'anomalies', 'ratio', 'ranking']}
];
export const QUOTA_CHARTS = [
  {id: 'weekly', title: 'Weekly 消耗曲线', kind: 'line', xLabel: '周期天数', yLabel: 'Weekly 已用 %', wide: true},
  {id: 'windows', title: '5h 窗口消耗贡献', kind: 'bar', xLabel: '5h 窗口', yLabel: 'Weekly 百分点', wide: true},
  {id: 'weekly-scatter', title: 'Token 与每周额度变化', kind: 'scatter', xLabel: '本机观测 token', yLabel: 'Weekly 百分点'},
  {id: 'five-hour-scatter', title: 'Token 与 5h 额度变化', kind: 'scatter', xLabel: '本机观测 token', yLabel: '5h 百分点'},
  {id: 'efficiency', title: '每 1% 每周额度对应 Token', kind: 'bar', xLabel: '5h 窗口', yLabel: 'Token / Weekly 百分点'},
  {id: 'weeks', title: '多周消耗热力图', kind: 'heatmap', xLabel: '周期天数', yLabel: 'Weekly 周期'},
  {id: 'cumulative', title: '累计 Token 与额度', kind: 'dual', xLabel: '时间', yLabel: '累计 token', rightLabel: '观测 Weekly 百分点', wide: true},
  {id: 'models', title: '模型消耗对比', kind: 'bar', xLabel: '模型', yLabel: 'Weekly 百分点 / 1M token'},
  {id: 'cache', title: '缓存与额度消耗', kind: 'scatter', xLabel: '缓存占比 %', yLabel: 'Weekly 百分点 / 1M token'},
  {id: 'distribution', title: '窗口消耗分布', kind: 'bar', xLabel: 'Weekly 百分点区间', yLabel: '窗口数'},
  {id: 'boxplot', title: '各周 Token 换算的波动', kind: 'box', xLabel: 'Weekly 周期', yLabel: 'Token / Weekly 百分点'},
  {id: 'forecast', title: '历史速度外推', kind: 'line', xLabel: '未来小时', yLabel: 'Weekly 已用 %', wide: true},
  {id: 'anomalies', title: '消耗偏高的观测窗口', kind: 'scatter', xLabel: '本机观测 token', yLabel: 'Weekly 百分点'},
  {id: 'hours', title: '日内消耗热力图', kind: 'heatmap', xLabel: '本地小时', yLabel: '日期'},
  {id: 'ratio', title: '5h / Weekly 比值', kind: 'bar', xLabel: '5h 窗口', yLabel: '5h 百分点 / Weekly 百分点'},
  {id: 'ranking', title: '本机对话与项目排行', kind: 'table', xLabel: '对话 / 项目', yLabel: '本机观测 token', wide: true}
];
