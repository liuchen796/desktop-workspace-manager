const path = require('node:path');

const DEFAULT_CATEGORIES = [
  { id: 'projects', label: '客户项目', color: '#157A6E' },
  { id: 'papers', label: '论文与资料', color: '#5965A8' },
  { id: 'ai-dev', label: 'AI 与开发', color: '#2563A7' },
  { id: 'office', label: '办公与沟通', color: '#C26D2D' },
  { id: 'engineering', label: '工程工具', color: '#7B5AA6' },
  { id: 'network', label: '网络与远程', color: '#1685A9' },
  { id: 'creative', label: '创作与媒体', color: '#C44D6D' },
  { id: 'entertainment', label: '游戏与娱乐', color: '#B34B3E' },
  { id: 'inbox', label: '待整理', color: '#D29C22', system: true },
  { id: 'other', label: '其他', color: '#667085', system: true },
];

const RULES = [
  ['projects', /客户|项目|管理系统|答题卡|交接|明阳|风电|出清|报告|工作/i],
  ['papers', /论文|文献|参考|模板|职称|obsidian|markdown|\.md$|\.docx?$|\.pdf$/i],
  ['ai-dev', /antigravity|cockpit|qoder|trae|visual studio|vscode|pycharm|代码|开发|ai技巧|提示词|github/i],
  ['office', /wps|office|微信|weixin|企业微信|wxwork|qq$|telegram|腾讯会议|wemeet|邮件|文档/i],
  ['engineering', /matlab|kicad|vmware|bambu|轮毂|技术栈|工程|cad|仿真/i],
  ['network', /clash|v2ray|todesk|向日葵|awe.?sun|vpn|remote|远程|everything/i],
  ['creative', /剪映|jianying|upscayl|图片|视频|婚纱|\.mp4$|\.mov$|\.png$|\.jpe?g$/i],
  ['entertainment', /炉石|hearthstone|battle\.net|暴雪|qq三国|16对战|游戏/i],
];

function classifyItem(item, manualCategory, isNew = false, availableCategoryIds = null) {
  const categoryAvailable = (id) => !availableCategoryIds || availableCategoryIds.has(id);
  if (manualCategory && categoryAvailable(manualCategory)) return manualCategory;
  if (isNew && categoryAvailable('inbox')) return 'inbox';
  const haystack = [item.name, item.path, item.target || '', item.extension || ''].join(' ');
  for (const [category, pattern] of RULES) {
    if (categoryAvailable(category) && pattern.test(haystack)) return category;
  }
  return 'other';
}

function safeCategoryFolder(label) {
  const cleaned = String(label || '其他')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || '其他';
}

function uniquePath(candidate, existsSync) {
  if (!existsSync(candidate)) return candidate;
  const parsed = path.parse(candidate);
  for (let index = 2; index < 10000; index += 1) {
    const next = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
    if (!existsSync(next)) return next;
  }
  throw new Error('无法为重名文件生成可用名称');
}

module.exports = { DEFAULT_CATEGORIES, RULES, classifyItem, safeCategoryFolder, uniquePath };
