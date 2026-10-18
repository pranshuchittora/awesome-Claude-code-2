# Contributing / 贡献指南

Thanks for helping make this list better! 感谢你帮助完善这个列表！

## How the list is built / 列表如何生成

Everything is generated from one file:

| File | Edit it? | Purpose |
|---|---|---|
| [`data/projects.json`](data/projects.json) | ✅ yes | Every entry in the list |
| [`data/categories.json`](data/categories.json) | ✅ rarely | Sections, categories, the "Start here" spotlight |
| `data/stats.json` | ❌ generated | GitHub stars / archived / last push, refreshed weekly by CI |
| `README.md`, `README.zh-CN.md` | ❌ generated | The two READMEs |
| `docs/data.json` | ❌ generated | Data for the [website](https://tomcatmew.github.io/awesome-Claude-code/) |

After editing, run:

```bash
python scripts/build.py --check   # validate
python scripts/build.py           # regenerate READMEs + website data
python scripts/build.py --refresh # optional: also refresh GitHub stars (set GITHUB_TOKEN to avoid rate limits)
```

No dependencies are needed beyond Python 3.9+. A GitHub Action refreshes star counts every Monday and whenever `data/` changes on `main`.

## Entry format / 条目格式

```json
{
  "name": "ccusage",
  "url": "https://github.com/ryoppippi/ccusage",
  "category": "usage-monitoring",
  "type": "repo",
  "desc": {
    "en": "CLI that analyzes Claude Code token usage and cost from local logs.",
    "zh": "从本地日志分析 Claude Code Token 用量与费用的命令行工具。"
  },
  "tags": ["cli", "cost"],
  "region": "jp",
  "featured": false
}
```

- `category` must be one of the ids in `data/categories.json`.
- `type`: `repo`, `website`, `doc`, `article`, `course`, `video`, `channel`, `community`, `podcast` or `newsletter`.
- `region` (optional): where the project or content comes from, e.g. `cn`, `jp`, `kr`. Omit for global.
- `desc`: keep it short (one sentence, ≤ 25 words), factual and free of marketing language. Both English and Chinese are required — if you can only write one, say so in the PR and a maintainer will help.
- `featured`: reserved for widely adopted, must-know resources. Please leave it `false` in suggestions.
- `group` (MCP servers only): `devtools`, `browser`, `data`, `cloud`, `design`, `productivity`, `search`, `os`, `memory`, `ai` or `other`.

## What belongs here / 收录标准

✅ Projects, guides, videos and communities about **Claude, Claude Code, the Claude Agent SDK or MCP** that are useful, maintained and have real users (or are genuinely novel).

❌ Not accepted:
- Account sharing, subscription reselling, "free API key" schemes or reverse-engineered web-session proxies (账号共享 / 拼车 / 转售 / 免费 API 类项目)
- Jailbreaks, leaked proprietary prompts, or anything that violates Anthropic's terms
- Empty or placeholder repositories, SEO spam, affiliate-link farms

## Bilibili and other video platforms / B 站与视频平台

Please link to the specific video (`https://www.bilibili.com/video/BV…`) or the creator's space (`https://space.bilibili.com/<uid>`), and put the creator's name in the description. 请附上具体视频或 UP 主空间链接，并在描述中注明 UP 主。
