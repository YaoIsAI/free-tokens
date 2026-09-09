// AI 工具官网导航 · 策展数据（站长维护，好123 式指向官网）
// 卡片外跳统一经站内 /goto 中转提示页（防钓鱼 + 外跳统计）；
// /goto 只认这里精确列出的 https URL（白名单，防开放重定向），增删工具后无需改跳转逻辑。
// 结构：分类数组 [{ id, name, tools:[{ name, url, desc, token?, logo? }] }]
//   token: 可选——站内有该产品免费 Token 时填搜索词，卡片显示「免费用」角标 → /?search=<token>
//   logo: 可选——品牌真实图标文件名（public/tools-icons/<logo>，自托管）。有则卡片显示真实 logo，
//         无则回退为工具名首字符 + 分类渐变底（.tools-avatar--g0..g5）。新增工具想要真实 logo，
//         先把图标文件放进 public/tools-icons/ 再填这里（下载脚本见 scripts/download-tools-icons.js）。
//   blurb: 可选——分类导语（一句话，渲染在分类标题下；给搜索引擎的长尾关键词燃料）。
// 新增工具直接往对应分类追加对象即可；数据全量 esc() 输出，无 XSS 风险。
module.exports = [
  {
    id: 'chat',
    name: '对话大模型',
    blurb: '免费AI对话与AI聊天助手：ChatGPT、Claude、DeepSeek、Kimi等主流大模型官方入口，写文案、查资料、做翻译一站直达。',
    tools: [
      { name: 'ChatGPT', url: 'https://chatgpt.com', logo: 'chatgpt.svg', desc: 'OpenAI 旗舰对话助手', token: 'OpenAI' },
      { name: 'Claude', url: 'https://claude.ai', logo: 'claude.png', desc: 'Anthropic 官方对话助手', token: 'Anthropic' },
      { name: 'Gemini', url: 'https://gemini.google.com', logo: 'gemini.png', desc: 'Google 多模态大模型助手', token: 'Gemini' },
      { name: 'DeepSeek', url: 'https://chat.deepseek.com', logo: 'deepseek.svg', desc: '深度求索，开源高性价比', token: 'DeepSeek' },
      { name: 'Kimi', url: 'https://kimi.moonshot.cn', logo: 'kimi.png', desc: '月之暗面，超长上下文', token: 'Kimi' },
      { name: '通义千问', url: 'https://tongyi.aliyun.com', logo: 'tongyi.svg', desc: '阿里巴巴通义大模型', token: '通义千问' },
      { name: '文心一言', url: 'https://yiyan.baidu.com', logo: 'wenxin.png', desc: '百度文心大模型' },
      { name: '豆包', url: 'https://www.doubao.com', logo: 'doubao.png', desc: '字节跳动 AI 助手', token: '豆包' },
      { name: '腾讯元宝', url: 'https://yuanbao.tencent.com', logo: 'yuanbao.ico', desc: '腾讯混元大模型助手' },
      { name: 'Grok', url: 'https://grok.com', logo: 'grok.png', desc: 'xAI 对话助手' },
      { name: 'Z.ai', url: 'https://z.ai', desc: '智谱 GLM 助手' },
      { name: '小米MiMo', url: 'https://mimo.mi.com', logo: 'mimo.svg', desc: '小米 Agent 大模型' },
      { name: 'Qwen Chat', url: 'https://chat.qwen.ai', logo: 'qwenchat.svg', desc: '通义千问官方对话' },
      { name: '海螺AI', url: 'https://hailuoai.com', logo: 'hailuo.ico', desc: 'MiniMax 对话与视频创作' }
    ]
  },
  {
    id: 'image',
    name: '图像生成',
    blurb: 'AI绘画与AI生图工具：Midjourney、Flux、Ideogram，文生图、海报字体与品牌视觉设计。',
    tools: [
      { name: 'Midjourney', url: 'https://www.midjourney.com', logo: 'midjourney.ico', desc: '高质量 AI 绘画' },
      { name: 'Stable Diffusion', url: 'https://stability.ai', logo: 'stability.ico', desc: '开源扩散模型' },
      { name: '即梦AI', url: 'https://jimeng.jianying.com', logo: 'jimeng.png', desc: '字节图像视频创作' },
      { name: '可灵AI', url: 'https://klingai.kuaishou.com', logo: 'kling.png', desc: '快手图像视频生成' },
      { name: 'Flux', url: 'https://blackforestlabs.ai', logo: 'flux.png', desc: '高质量图像模型' },
      { name: 'Leonardo', url: 'https://leonardo.ai', logo: 'leonardo.png', desc: '创意图像生成' },
      { name: 'Recraft', url: 'https://www.recraft.ai', logo: 'recraft.ico', desc: '矢量与品牌设计' },
      { name: 'Ideogram', url: 'https://ideogram.ai', desc: '英文海报字体准确' },
      { name: '通义万相', url: 'https://tongyi.aliyun.com', logo: 'tongyi.svg', desc: '阿里视觉生成' }
    ]
  },
  {
    id: 'video',
    name: '视频生成',
    blurb: 'AI视频与文生视频工具：Sora、可灵、Vidu、HeyGen数字人，短视频、营销成片与AI短剧制作。',
    tools: [
      { name: 'Sora', url: 'https://sora.com', logo: 'sora.svg', desc: 'OpenAI 视频生成（Sora 2）' },
      { name: '可灵AI', url: 'https://klingai.kuaishou.com', logo: 'kling.png', desc: '快手视频生成' },
      { name: '即梦AI', url: 'https://jimeng.jianying.com', logo: 'jimeng.png', desc: '字节一站式视频创作' },
      { name: 'Runway', url: 'https://runwayml.com', logo: 'runway.png', desc: '专业视频创作工具' },
      { name: 'Pika', url: 'https://pika.art', logo: 'pika.png', desc: '视频生成' },
      { name: 'Luma', url: 'https://lumalabs.ai', logo: 'luma.png', desc: 'Dream Machine 视频' },
      { name: '剪映', url: 'https://www.capcut.cn', logo: 'jianying.png', desc: '抖音剪辑 + AI 功能' },
      { name: 'Vidu', url: 'https://www.vidu.cn', logo: 'vidu.png', desc: '参考生视频，主体一致' },
      { name: 'HeyGen', url: 'https://www.heygen.com', desc: '数字人口播视频' },
      { name: 'Synthesia', url: 'https://www.synthesia.io', desc: '企业培训视频' },
      { name: 'PixVerse', url: 'https://pixverse.ai', desc: '特效短视频' },
      { name: 'Flow', url: 'https://labs.google/fx/tools/flow', desc: '谷歌 AI 影视工作室' },
      { name: 'Seedance', url: 'https://seedance.ai', desc: '字节角色一致性视频' },
      { name: 'Hailuo', url: 'https://hailuoai.com', logo: 'hailuo.ico', desc: 'MiniMax 免费额度大方' },
      { name: 'D-ID', url: 'https://www.d-id.com', desc: '实时数字人' }
    ]
  },
  {
    id: 'coding',
    name: '编程开发',
    blurb: 'AI编程工具、代码补全与编程智能体：Cursor、Claude Code、Cline、Kiro，Vibe Coding必备。',
    tools: [
      { name: 'Cursor', url: 'https://www.cursor.com', logo: 'cursor.png', desc: 'AI 原生代码编辑器' },
      { name: 'GitHub Copilot', url: 'https://github.com/features/copilot', logo: 'copilot.png', desc: '代码补全助手' },
      { name: 'Claude Code', url: 'https://claude.com', logo: 'claude-code.png', desc: '终端里的 AI 编程' },
      { name: 'Replit', url: 'https://replit.com', logo: 'replit.svg', desc: '云端开发平台' },
      { name: '通义灵码', url: 'https://lingma.aliyun.com', logo: 'lingma.png', desc: '阿里编程助手' },
      { name: 'Windsurf', url: 'https://windsurf.com', logo: 'windsurf.svg', desc: '免费额度大方的 AI IDE' },
      { name: 'Continue', url: 'https://www.continue.dev', logo: 'continue.png', desc: '开源编程助手' },
      { name: 'Cline', url: 'https://cline.bot', desc: '开源 VSCode 智能体' },
      { name: 'Aider', url: 'https://aider.chat', desc: '终端编程，Git 原生' },
      { name: 'Devin', url: 'https://devin.ai', desc: '全自主软件工程师' },
      { name: 'Codex', url: 'https://openai.com/codex', desc: 'OpenAI 云端编程智能体' },
      { name: 'Kiro', url: 'https://kiro.dev', logo: 'kiro.ico', desc: 'AWS 规格驱动开发' },
      { name: 'Kilo Code', url: 'https://kilo.ai', desc: '上下文控制强的后起之秀' },
      { name: 'Zed', url: 'https://zed.dev', desc: '极速编辑器 + AI' },
      { name: 'OpenCode', url: 'https://opencode.ai', logo: 'opencode.png', desc: '开源终端智能体' },
      { name: 'Qoder', url: 'https://qoder.com', desc: '自主开发 IDE' },
      { name: 'Gemini CLI', url: 'https://github.com/google-gemini/gemini-cli', desc: '谷歌免费终端智能体' },
      { name: 'Goose', url: 'https://block.github.io/goose', desc: 'Block 开源通用智能体' },
      { name: 'Trae', url: 'https://www.trae.ai', desc: '字节免费 AI IDE' }
    ]
  },
  {
    id: 'audio',
    name: '音频',
    blurb: 'AI音乐生成、语音合成与克隆：Suno一句话出歌，ElevenLabs拟人配音。',
    tools: [
      { name: 'Suno', url: 'https://suno.com', logo: 'suno.png', desc: 'AI 音乐生成' },
      { name: '海绵音乐', url: 'https://www.haimian.com', logo: 'haimian.png', desc: '字节 AI 音乐创作' },
      { name: 'ElevenLabs', url: 'https://elevenlabs.io', logo: 'elevenlabs.png', desc: '语音克隆与合成' },
      { name: 'Udio', url: 'https://www.udio.com', logo: 'udio.png', desc: 'AI 音乐生成' },
      { name: '天工SkyMusic', url: 'https://www.tiangong.cn', logo: 'tiangong.ico', desc: '昆仑万维 AI 音乐' }
    ]
  },
  {
    id: 'office',
    name: '办公效率',
    blurb: 'AI办公、智能文档与知识库：飞书、Notion AI、腾讯ima、NotebookLM，做PPT、记笔记、管资料。',
    tools: [
      { name: 'Notion AI', url: 'https://www.notion.so', logo: 'notion.svg', desc: 'AI 笔记与办公' },
      { name: 'Gamma', url: 'https://gamma.app', logo: 'gamma.ico', desc: 'AI 生成 PPT/网页' },
      { name: 'AiPPT', url: 'https://www.aippt.cn', logo: 'aippt.ico', desc: 'AI 一键生成 PPT' },
      { name: '讯飞星火', url: 'https://xinghuo.xfyun.cn', logo: 'xinghuo.png', desc: '科大讯飞大模型助手' },
      { name: 'WPS AI', url: 'https://ai.wps.cn', logo: 'wps.ico', desc: '金山智能办公' },
      { name: '腾讯文档', url: 'https://docs.qq.com', logo: 'tencent-docs.ico', desc: '腾讯智能协作文档' },
      { name: '飞书', url: 'https://www.feishu.cn', logo: 'feishu.ico', desc: '字节智能办公' },
      { name: 'NotebookLM', url: 'https://notebooklm.google', desc: '谷歌研究学习助手' },
      { name: 'ima', url: 'https://ima.qq.com', desc: '腾讯 AI 知识库' }
    ]
  },
  {
    id: 'search',
    name: 'AI 搜索',
    blurb: 'AI搜索引擎：Perplexity、秘塔、Felo，无广告、直接给答案，查资料做调研更快。',
    tools: [
      { name: 'Perplexity', url: 'https://www.perplexity.ai', logo: 'perplexity.png', desc: 'AI 答案引擎' },
      { name: '秘塔AI搜索', url: 'https://metaso.cn', logo: 'metaso.png', desc: '无广告，直达结果' },
      { name: '天工AI搜索', url: 'https://www.tiangong.cn', logo: 'tiangong.ico', desc: '国内 AI 搜索' },
      { name: '360 AI搜索', url: 'https://www.so.com', logo: 'so360.ico', desc: '360 智能搜索' },
      { name: 'Felo', url: 'https://felo.ai', logo: 'felo.png', desc: '多语言 AI 搜索' }
    ]
  },
  {
    id: 'agent',
    name: '智能体 / 平台',
    blurb: 'AI智能体与应用开发平台：Manus自主办事，Dify、Coze扣子零代码搭应用。',
    tools: [
      { name: 'Coze 扣子', url: 'https://www.coze.cn', logo: 'coze.png', desc: '字节智能体平台' },
      { name: 'Dify', url: 'https://dify.ai', logo: 'dify.svg', desc: '开源 LLM 应用平台' },
      { name: '文心智能体', url: 'https://agents.baidu.com', logo: 'baidu-agent.svg', desc: '百度智能体平台' },
      { name: '阿里云百炼', url: 'https://bailian.aliyun.com', logo: 'bailian.svg', desc: '阿里 AI 应用开发平台（原 App Studio）' },
      { name: 'LangChain', url: 'https://www.langchain.com', logo: 'langchain.svg', desc: 'LLM 应用开发框架' },
      { name: 'Manus', url: 'https://manus.im', logo: 'manus.ico', desc: '通用任务执行智能体' },
      { name: 'Genspark', url: 'https://www.genspark.ai', desc: '全能 AI 工作台' }
    ]
  },
  {
    id: 'design',
    name: '设计创意',
    blurb: 'AI设计、在线作图与UI协作：Canva、MasterGo、Figma，海报、UI与平面设计。',
    tools: [
      { name: 'Canva', url: 'https://www.canva.com', logo: 'canva.svg', desc: '在线设计平台' },
      { name: '稿定设计', url: 'https://www.gaoding.com', logo: 'gaoding.png', desc: '国内在线设计' },
      { name: '美图设计室', url: 'https://www.designkit.cn', logo: 'meitu.ico', desc: 'AI 设计工具' },
      { name: 'Figma', url: 'https://www.figma.com', logo: 'figma.svg', desc: '协作设计工具' },
      { name: '创客贴', url: 'https://www.chuangkit.com', logo: 'chuangkit.ico', desc: '平面设计平台' },
      { name: 'MasterGo', url: 'https://mastergo.com', logo: 'mastergo.ico', desc: '国产在线 UI 设计' }
    ]
  },
  {
    id: 'appgen',
    name: 'AI 应用生成',
    blurb: '一句话生成完整应用：Lovable、Bolt、v0，对话即交付，上线小产品最快。',
    tools: [
      { name: 'Lovable', url: 'https://lovable.dev', logo: 'lovable.png', desc: '对话生成全栈应用' },
      { name: 'Bolt', url: 'https://bolt.new', desc: '浏览器里 vibe coding' },
      { name: 'v0', url: 'https://v0.dev', desc: 'Vercel 界面生成' }
    ]
  },
  {
    id: 'writing',
    name: '写作 / 学习',
    blurb: 'AI写作、论文模板与专业翻译：笔灵AI、DeepL，写论文、改文案、翻资料。',
    tools: [
      { name: '笔灵AI', url: 'https://ibiling.cn', logo: 'biling.png', desc: '写作模板与论文' },
      { name: '讯飞绘文', url: 'https://xinghuo.xfyun.cn/write', logo: 'xunfei-huiwen.png', desc: 'AI 批量原创（讯飞星火写作）' },
      { name: '彩云小译', url: 'https://fanyi.caiyunapp.com', logo: 'caiyun.ico', desc: 'AI 翻译' },
      { name: 'DeepL', url: 'https://www.deepl.com', logo: 'deepl.png', desc: '专业翻译' },
      { name: 'QuillBot', url: 'https://quillbot.com', logo: 'quillbot.png', desc: '写作改写工具' }
    ]
  }
];
