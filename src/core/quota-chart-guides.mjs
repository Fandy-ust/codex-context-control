// Shared reading guidance for Swift Charts and the Windows chart cards.
export const QUOTA_CHART_GUIDES = {
  weekly: [
    ['横轴是每周周期的第几天，纵轴是账户已用额度；线越陡，说明那段时间消耗越快。', 'The horizontal axis shows days into the weekly cycle; the vertical axis shows account quota used. Steeper lines mean faster consumption.'],
    ['把不同周的同一天放在一起看。希望额度撑到重置时，可留意本周曲线是否比平时更早接近 100%；这张图始终代表整个账户。', 'Compare the same day across weeks. To make quota last until reset, watch whether this week approaches 100% earlier than usual. This chart always covers the whole account.']
  ],
  windows: [
    ['每根柱子代表一个 5 小时窗口，柱子越高，该窗口观测到的 Weekly 消耗越多。', 'Each bar represents a five-hour window. Taller bars mean more observed Weekly consumption in that window.'],
    ['先找高柱对应的工作时段，再结合完成的任务判断是否值得；低柱不一定更好，也可能只是工作较少。', 'Find the work sessions behind tall bars, then judge the consumption against what you accomplished. A shorter bar may simply mean less work.']
  ],
  'weekly-scatter': [
    ['每个点代表一个可比较区间；越往右表示 Token 越多，越往上表示 Weekly 消耗越多。', 'Each point is a comparable interval. Farther right means more tokens; higher means more Weekly quota consumed.'],
    ['在同一模型、相近任务下看：相同 Token 对应更低的点，表示观测到的额度消耗较少。散点很分散时，不适合用一条线预测消耗。', 'For the same model and similar tasks, a lower point at the same token count means less observed quota consumption. A widely scattered cloud is a poor basis for predicting consumption with one line.']
  ],
  'five-hour-scatter': [
    ['每个点把一个区间的 Token 与 5 小时额度变化放在一起；越高表示短周期额度消耗越多。', 'Each point compares interval tokens with five-hour quota usage. Higher points mean more short-cycle quota consumed.'],
    ['在 Token 相近且任务类似时比较点的高度，有助于了解哪些工作更容易触及短周期限制。', 'Compare point heights for similar token counts and tasks to understand which work is more likely to reach the short-cycle limit.']
  ],
  efficiency: [
    ['柱子表示每消耗 1 个 Weekly 百分点对应多少 Token；柱子越高，代表同样额度下观测到的 Token 越多。', 'Bars show tokens per Weekly percentage point. Taller bars mean more observed tokens for the same quota consumption.'],
    ['适合比较同模型、相近任务的窗口。更高不等于答案更好，仍要看任务质量、输入长度和缓存使用情况。', 'Compare windows for the same model and similar tasks. A higher value does not mean a better answer; consider task quality, input length, and cache use.']
  ],
  weeks: [
    ['每行是一周、每列是周期内的一天；颜色越深，该天观测到的消耗越多，空白表示缺少可比较记录。', 'Rows are weeks and columns are days within each cycle. Darker cells mean more observed consumption; blank cells lack comparable records.'],
    ['看深色是否集中在固定几天，帮助安排高强度工作。颜色均匀或较浅只表示消耗节奏不同，没有统一的最好分布。', 'Look for recurring busy days to plan intensive work. An even or pale pattern only shows a different usage rhythm; there is no single best distribution.']
  ],
  cumulative: [
    ['实线用左轴看累计 Token，虚线用右轴看累计 Weekly 消耗；比较两条线的变化时段，不要直接比较高度。', 'Read cumulative tokens on the left axis and dashed Weekly consumption on the right axis. Compare when they change, not their absolute heights.'],
    ['Token 增长相近但额度增长更快的时段值得回看模型和任务变化；缺口不代表期间没有使用。', 'Review model and task changes when quota grows faster despite similar token growth. Gaps do not mean there was no usage.']
  ],
  models: [
    ['每根柱子对应一个模型，表示处理 100 万 Token 时观测到的 Weekly 消耗；只采用单模型区间。', 'Each bar is a model and shows observed Weekly consumption per million tokens, using single-model intervals only.'],
    ['同类任务下较低的柱子表示较省额度；选择模型还要结合完成质量和速度。样本少的模型不宜直接下结论。', 'For comparable tasks, a shorter bar indicates lower quota consumption. Also consider quality and speed; avoid firm conclusions from few samples.']
  ],
  cache: [
    ['横轴是缓存输入占比，纵轴是每 100 万 Token 的 Weekly 消耗；每个点代表一个观测区间。', 'The horizontal axis is cached input share; the vertical axis is Weekly consumption per million tokens. Each point is an observed interval.'],
    ['同模型下看点是否随缓存占比增加而降低。右下方表示该区间缓存较多且消耗较少，但相关性不能保证提高缓存就一定省额度。', 'For the same model, see whether points fall as cached share rises. The lower right indicates more cache and less consumption in that interval, but correlation does not guarantee savings.']
  ],
  distribution: [
    ['横轴把 5 小时窗口按 Weekly 消耗分组，柱子高度表示落在这一组的窗口数量。', 'The horizontal axis groups five-hour windows by Weekly consumption; bar height is the number of windows in each group.'],
    ['左侧柱子多表示通常消耗较少，右侧长尾表示偶尔有高强度窗口。可据此预留额度，柱子越高并不表示表现越好。', 'More bars on the left mean usually lighter consumption; a right tail shows occasional intensive windows. Use this to reserve quota; taller bars are not better performance.']
  ],
  boxplot: [
    ['每组对应一周；中线是典型的 Token / Weekly 百分点，箱体表示中间一半观测，须线表示范围。', 'Each group is a week. The middle line is typical tokens per Weekly percentage point, the box covers the middle half of observations, and whiskers show the range.'],
    ['同模型和类似任务下，中线较高表示每份额度对应更多 Token；箱体较窄表示更稳定，仍需结合样本数量判断。', 'For the same model and similar tasks, a higher middle line means more tokens per quota unit. A narrower box means more consistency; also check sample size.']
  ],
  forecast: [
    ['横轴是未来小时，纵轴是账户预计已用额度；多条线展示近期较慢、平均及较快的消耗节奏。', 'The horizontal axis is future hours and the vertical axis is projected account quota used. Lines show slower, average, and faster recent usage rhythms.'],
    ['看曲线多久接近 100%，判断是否需要放慢节奏。换模型或改变任务后预测会变化；这里始终是账户整体预测。', 'See how soon lines approach 100% to decide whether to slow down. Changing models or tasks changes the outlook; this always forecasts the whole account.']
  ],
  anomalies: [
    ['横轴是 Token，纵轴是 Weekly 消耗；标为偏高的点，表示相对其他窗口消耗较多。', 'The horizontal axis is tokens and the vertical axis is Weekly consumption. Points marked elevated consumed more relative to other windows.'],
    ['优先回看偏高窗口的任务、模型和缓存变化。偏高是排查线索，不等于计费出错或任务不值得。', 'Review tasks, models, and cache changes in elevated windows first. Elevated consumption is a clue, not proof of an accounting error or an unworthy task.']
  ],
  hours: [
    ['每行是一天、每列是本地小时；颜色越深表示该小时结束的观测区间消耗越多。', 'Rows are dates and columns are local hours. Darker cells mean more consumption in intervals ending in that hour.'],
    ['看高消耗集中在哪些时段，用于安排工作和预留额度；空白不能当作零使用，也不能据此判断某个小时更便宜。', 'Find intensive times to plan work and reserve quota. Blank cells do not mean zero usage, and the chart does not show cheaper hours.']
  ],
  ratio: [
    ['柱子表示同一窗口中 5 小时消耗百分点除以 Weekly 消耗百分点；越高表示短周期额度消耗相对更快。', 'Bars divide five-hour percentage points by Weekly percentage points in the same window. Higher values mean relatively faster short-cycle consumption.'],
    ['结合两个周期的剩余额度判断哪个限制更可能先到。比值本身没有越高越好或越低越好的标准。', 'Combine this ratio with both remaining balances to judge which limit may arrive first. The ratio itself has no universally better direction.']
  ],
  ranking: [
    ['按本机记录的输入与输出 Token 合计排列对话和项目；请求数表示发生了多少次模型调用。', 'Chats and projects are ranked by locally recorded input plus output tokens. Request count shows how many model calls occurred.'],
    ['从排名靠前的任务寻找可优化的长输入或重复请求，再结合完成结果判断。Token 多不等于浪费，也不等于精确占用了同等比例的账户额度。', 'Review long inputs or repeated requests in top-ranked work alongside the results achieved. More tokens do not imply waste or an exact share of account quota.']
  ]
};
