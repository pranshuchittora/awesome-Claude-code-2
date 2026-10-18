#!/usr/bin/env python3
"""Generate README.md, README.zh-CN.md and docs/data.json from data/*.json.

    python scripts/build.py             # rebuild outputs from data + cached stats
    python scripts/build.py --refresh   # also refresh GitHub stats (GITHUB_TOKEN recommended)
    python scripts/build.py --check     # validate data/projects.json only

Only the standard library is used so the script runs anywhere Python 3.9+ does.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
REPO = "tomcatmew/awesome-Claude-code"
SITE = "https://tomcatmew.github.io/awesome-Claude-code/"
UA = "awesome-claude-code-builder (+https://github.com/%s)" % REPO

GITHUB_RE = re.compile(r"^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?$")
NOT_OWNERS = {"topics", "orgs", "features", "marketplace", "sponsors", "collections",
              "search", "apps", "settings", "trending", "explore", "enterprise"}
REQUIRED = ("name", "url", "category", "desc")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


# --------------------------------------------------------------------------- data

def load_json(path: Path, default=None):
    if not path.exists():
        return default
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, obj, compact=False):
    with path.open("w", encoding="utf-8", newline="\n") as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


def repo_of(url: str) -> str | None:
    """'owner/name' when the URL is exactly a GitHub repository root."""
    m = GITHUB_RE.match(url)
    if not m or m.group(1).lower() in NOT_OWNERS:
        return None
    return f"{m.group(1)}/{m.group(2)}"


def validate(projects, cats) -> list[str]:
    errors, seen = [], {}
    cat_ids = {c["id"] for s in cats["sections"] for c in s["categories"]}
    for i, p in enumerate(projects):
        where = f"#{i} {p.get('name', '?')}"
        for key in REQUIRED:
            if not p.get(key):
                errors.append(f"{where}: missing '{key}'")
        if p.get("category") not in cat_ids:
            errors.append(f"{where}: unknown category '{p.get('category')}'")
        desc = p.get("desc") or {}
        if not desc.get("en") or not desc.get("zh"):
            errors.append(f"{where}: desc needs both 'en' and 'zh'")
        url = p.get("url", "")
        if not url.startswith(("https://", "http://")):
            errors.append(f"{where}: url must be http(s)")
        key = url.rstrip("/").lower()
        if key in seen:
            errors.append(f"{where}: duplicate url (also #{seen[key]})")
        seen[key] = i
        if p.get("region") and p["region"] not in cats["regions"]:
            errors.append(f"{where}: unknown region '{p['region']}'")
        if p.get("type") and p["type"] not in cats["types"]:
            errors.append(f"{where}: unknown type '{p['type']}'")
    return errors


# -------------------------------------------------------------------------- stats

def _request(url, token=None, data=None):
    headers = {"User-Agent": UA, "Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.geturl(), r.read()


def _graphql_batch(repos, token):
    parts = []
    for i, full in enumerate(repos):
        owner, name = full.split("/", 1)
        parts.append(
            f'r{i}: repository(owner: {json.dumps(owner)}, name: {json.dumps(name)}) '
            '{ nameWithOwner stargazerCount forkCount isArchived pushedAt primaryLanguage { name } }'
        )
    body = json.dumps({"query": "query { " + " ".join(parts) + " }"}).encode()
    _, raw = _request("https://api.github.com/graphql", token, body)
    data = (json.loads(raw).get("data") or {})
    out = {}
    for i, full in enumerate(repos):
        node = data.get(f"r{i}")
        if node:
            out[full] = {
                "canonical": node["nameWithOwner"],
                "stars": node["stargazerCount"],
                "forks": node["forkCount"],
                "archived": node["isArchived"],
                "pushed_at": node["pushedAt"],
                "language": (node.get("primaryLanguage") or {}).get("name"),
            }
    return out


def _rest_one(full, token):
    try:
        _, raw = _request(f"https://api.github.com/repos/{full}", token)
    except urllib.error.HTTPError as e:
        return full, {"missing": True} if e.code == 404 else None
    j = json.loads(raw)
    return full, {
        "canonical": j["full_name"],
        "stars": j["stargazers_count"],
        "forks": j["forks_count"],
        "archived": j["archived"],
        "pushed_at": j["pushed_at"],
        "language": j.get("language"),
    }


STAR_RE = re.compile(r'id="repo-stars-counter-star"[^>]*?title="([\d,]+)"', re.S)
STAR_RE2 = re.compile(r'aria-label="([\d,]+) users? starred this repository"')


def _html_one(full, _token=None):
    """Fallback without a token: read the public repository page."""
    try:
        final, raw = _request(f"https://github.com/{full}")
    except urllib.error.HTTPError as e:
        return full, {"missing": True} if e.code == 404 else None
    except Exception:
        return full, None
    page = raw.decode("utf-8", "replace")
    m = STAR_RE.search(page) or STAR_RE2.search(page)
    canon = repo_of(final.split("?")[0]) or full
    return full, {
        "canonical": canon,
        "stars": int(m.group(1).replace(",", "")) if m else None,
        "archived": "This repository has been archived" in page,
    }


def refresh_stats(projects, stats):
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    # This list's own repo is tracked too, so the website can show its star count without an API call.
    repos = sorted({r for r in (repo_of(p["url"]) for p in projects) if r} | {REPO})
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    fresh = {}
    if token:
        for i in range(0, len(repos), 40):
            batch = repos[i:i + 40]
            try:
                fresh.update(_graphql_batch(batch, token))
            except Exception as e:  # keep going; REST fallback below
                print(f"graphql batch failed: {e}", file=sys.stderr)
        todo = [r for r in repos if r not in fresh]
        worker, threads = _rest_one, 4
    else:
        print("GITHUB_TOKEN not set: reading public repository pages instead", file=sys.stderr)
        todo, worker, threads = repos, _html_one, 6
    with cf.ThreadPoolExecutor(threads) as ex:
        for full, info in ex.map(lambda r: worker(r, token), todo):
            if info:
                fresh[full] = info
    for full, info in fresh.items():
        info["checked_at"] = now
        stats[full] = info
    missing = [r for r in repos if stats.get(r, {}).get("missing")]
    renamed = [(r, stats[r]["canonical"]) for r in repos
               if stats.get(r, {}).get("canonical") and stats[r]["canonical"].lower() != r.lower()]
    for r in missing:
        print(f"WARNING missing repo: {r}", file=sys.stderr)
    for old, new in renamed:
        print(f"NOTE renamed: {old} -> {new}", file=sys.stderr)
    return {k: v for k, v in stats.items() if k in repos}


# ------------------------------------------------------------------------- render

def fmt_stars(n):
    if n is None:
        return ""
    if n >= 100_000:
        return f"{n / 1000:.0f}k"
    if n >= 1000:
        return f"{n / 1000:.1f}k".replace(".0k", "k")
    return str(n)


def enrich(projects, cats, stats):
    sec_of = {c["id"]: s["id"] for s in cats["sections"] for c in s["categories"]}
    items = []
    for idx, p in enumerate(projects):
        repo = repo_of(p["url"])
        st = stats.get(repo, {}) if repo else {}
        item = {
            "name": p["name"],
            "url": p["url"],
            "category": p["category"],
            "section": sec_of[p["category"]],
            "type": p.get("type") or ("repo" if repo else "website"),
            "desc": p["desc"],
            "tags": p.get("tags", []),
            "region": p.get("region") or "global",
            "featured": bool(p.get("featured")),
            "order": idx,
        }
        for key in ("author", "group"):
            if p.get(key):
                item[key] = p[key]
        if repo:
            item["repo"] = st.get("canonical") or repo
            for key in ("stars", "archived", "pushed_at", "language"):
                if st.get(key) is not None:
                    item[key] = st[key]
        items.append(item)
    return items


def sort_items(items):
    return sorted(items, key=lambda x: (not x["featured"], -(x.get("stars") or -1), x["order"]))


T = {
    "en": {
        "title": "Awesome Claude Code",
        "tagline": "A curated, categorised and bilingual list of the best Claude Code & Claude ecosystem projects — tools, skills, subagents, plugins, MCP servers, apps, guides, videos and communities from around the world, including the Chinese community.",
        "browse": "Browse the interactive website",
        "browse_hint": "search, filter by category, type or region, sort by stars",
        "cta": "If this list saves you time, a ⭐ helps other Claude Code users find it. Spotted something missing? [Suggest it](https://github.com/{repo}/issues/new/choose).",
        "lang": "**English** · [简体中文](README.zh-CN.md)",
        "stats": "**{n}** resources · **{c}** categories · **{r}** GitHub repos with **{s}** total stars · updated **{d}**",
        "legend": "**Legend:** 🏆 top pick · ⭐ GitHub stars (refreshed weekly) · 🇨🇳 Chinese · 🇯🇵 Japanese · 🇰🇷 Korean · 🗄️ archived · 📘 docs · 📝 article · 🎓 course · 📺 video · 💬 community",
        "start": "Start here",
        "start_desc": "New to Claude Code? These are the resources most people end up using.",
        "th": ["Resource", "What it is", "Category"],
        "contents": "Contents",
        "cn_index": "Chinese-made projects at a glance",
        "cn_index_desc": "Projects by Chinese developers that appear in the functional categories above.",
        "back": "back to top",
        "contrib_h": "Contributing",
        "contrib": "Found something awesome? Open an [issue](https://github.com/{repo}/issues/new/choose) or a pull request. All entries live in [`data/projects.json`](data/projects.json); run `python scripts/build.py` to regenerate the READMEs and the website. See [CONTRIBUTING.md](CONTRIBUTING.md).",
        "history": "Star history",
        "license": "License",
        "license_txt": "[CC0 1.0](LICENSE) — to the extent possible under law, the curators have waived all copyright to this list.",
        "disclaimer": "This is a community project and is not affiliated with or endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic, PBC. Projects listed are owned by their respective authors — review code before running it, especially hooks, plugins and MCP servers that execute on your machine.",
        "archived": "archived",
        "by": "by",
        "up": "by",
    },
    "zh": {
        "title": "Awesome Claude Code",
        "tagline": "精心整理、分类清晰的中英双语 Claude Code 与 Claude 生态资源合集 —— 工具、技能、子代理、插件、MCP 服务器、应用、教程、视频与全球社区（含中文社区与 B 站）。",
        "browse": "浏览交互式网站",
        "browse_hint": "支持搜索、按分类/类型/地区筛选、按 Star 排序",
        "cta": "如果这份列表帮你节省了时间，点个 ⭐ 能让更多 Claude Code 用户发现它。发现遗漏？欢迎[推荐项目](https://github.com/{repo}/issues/new/choose)。",
        "lang": "[English](README.md) · **简体中文**",
        "stats": "共 **{n}** 个资源 · **{c}** 个分类 · **{r}** 个 GitHub 仓库，合计 **{s}** Star · 更新于 **{d}**",
        "legend": "**图例：** 🏆 精选 · ⭐ GitHub Star（每周自动更新）· 🇨🇳 国人/中文 · 🇯🇵 日本 · 🇰🇷 韩国 · 🗄️ 已归档 · 📘 文档 · 📝 文章 · 🎓 课程 · 📺 视频 · 💬 社区",
        "start": "从这里开始",
        "start_desc": "刚接触 Claude Code？以下是大多数人最终都会用到的资源。",
        "th": ["资源", "简介", "分类"],
        "contents": "目录",
        "cn_index": "国人开发项目速览",
        "cn_index_desc": "以下为上方各功能分类中由中国开发者创建的项目汇总。",
        "back": "返回顶部",
        "contrib_h": "参与贡献",
        "contrib": "发现了好项目？欢迎提交 [Issue](https://github.com/{repo}/issues/new/choose) 或 Pull Request。所有条目存放在 [`data/projects.json`](data/projects.json)，运行 `python scripts/build.py` 即可重新生成 README 与网站数据。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。",
        "history": "Star 趋势",
        "license": "许可证",
        "license_txt": "[CC0 1.0](LICENSE) —— 在法律允许的范围内，整理者放弃本列表的全部版权。",
        "disclaimer": "本项目为社区项目，与 Anthropic 无隶属或背书关系。Claude 与 Claude Code 是 Anthropic, PBC 的商标。所列项目归各自作者所有——运行前请先审阅代码，尤其是会在本机执行的钩子、插件与 MCP 服务器。",
        "archived": "已归档",
        "by": "作者",
        "up": "UP主",
    },
}


def entry_line(it, lang, cats):
    t = T[lang]
    name = it["name"].replace("[", "(").replace("]", ")")
    link = f"[{name}]({it['url']})"
    head = f"🏆 **{link}**" if it["featured"] else link
    marks = []
    icon = cats["types"].get(it["type"], {}).get("icon")
    if icon:
        marks.append(icon)
    flag = cats["regions"].get(it["region"], {}).get("flag")
    if flag:
        marks.append(flag)
    if it.get("stars") is not None:
        marks.append(f"⭐ {fmt_stars(it['stars'])}")
    if it.get("archived"):
        marks.append(f"🗄️ {t['archived']}")
    if it.get("author"):
        label = t["up"] if it["category"] == "cn-video" else t["by"]
        author = it["author"].replace("_", "\\_").replace("*", "\\*")
        marks.append(f"· _{label} {author}_")
    desc = it["desc"][lang].strip()
    return f"- {head}{(' ' + ' '.join(marks)) if marks else ''} — {desc}"


def render_readme(lang, cats, items, spotlight, generated):
    t = T[lang]
    other = "zh" if lang == "en" else "en"
    by_cat = {}
    for it in items:
        by_cat.setdefault(it["category"], []).append(it)
    repos = [it for it in items if it.get("repo")]
    total_stars = sum(it.get("stars") or 0 for it in repos)
    n_cats = sum(1 for s in cats["sections"] for c in s["categories"] if by_cat.get(c["id"]))
    L = []
    w = L.append

    w('<a id="top"></a>')
    w('<div align="center">')
    w("")
    w("<picture>")
    w('  <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.svg">')
    w(f'  <img alt="{t["title"]}" src="assets/banner-light.svg" width="100%">')
    w("</picture>")
    w("")
    w(f"# {t['title']}")
    w("")
    w("[![Awesome](https://awesome.re/badge-flat2.svg)](https://awesome.re)")
    w(f"[![Resources](https://img.shields.io/badge/resources-{len(items)}-d97757?style=flat-square)](#contents)")
    w(f"[![Website](https://img.shields.io/badge/website-online-2ea44f?style=flat-square)]({SITE})")
    w(f"[![Updated](https://img.shields.io/badge/updated-{generated.replace('-', '--')}-blue?style=flat-square)](https://github.com/{REPO}/commits/main)")
    w(f"[![Stars](https://img.shields.io/github/stars/{REPO}?style=flat-square&color=yellow)](https://github.com/{REPO}/stargazers)")
    w("[![License: CC0-1.0](https://img.shields.io/badge/license-CC0--1.0-lightgrey?style=flat-square)](LICENSE)")
    w("")
    w(t["lang"])
    w("")
    w(f"**{t['tagline']}**")
    w("")
    w(f"### 🔎 [{t['browse']} →]({SITE})")
    w(f"<sub>{t['browse_hint']}</sub>")
    w("")
    w(t["cta"].format(repo=REPO))
    w("")
    w("</div>")
    w("")
    w("> " + t["stats"].format(n=len(items), c=n_cats, r=len(repos),
                                s=f"{total_stars / 1_000_000:.1f}M" if total_stars >= 1_000_000 else fmt_stars(total_stars),
                                d=generated))
    w(">")
    w("> " + t["legend"])
    w("")

    # Start here
    url_map = {it["url"]: it for it in items}
    cat_name = {c["id"]: c["name"][lang] for s in cats["sections"] for c in s["categories"]}
    picks = [url_map[u] for u in spotlight if u in url_map]
    if picks:
        w(f"## 🚀 {t['start']}")
        w("")
        w(t["start_desc"])
        w("")
        w(f"| {t['th'][0]} | {t['th'][1]} | {t['th'][2]} |")
        w("|---|---|---|")
        for it in picks:
            stars = f" ⭐ {fmt_stars(it['stars'])}" if it.get("stars") is not None else ""
            desc = it["desc"][lang].replace("|", "\\|")
            w(f"| [**{it['name']}**]({it['url']}){stars} | {desc} | [{cat_name[it['category']]}](#{it['category']}) |")
        w("")

    # Contents
    w('<a id="contents"></a>')
    w(f"## 📑 {t['contents']}")
    w("")
    for s in cats["sections"]:
        live = [c for c in s["categories"] if by_cat.get(c["id"])]
        if not live:
            continue
        sec_count = sum(len(by_cat[c["id"]]) for c in live)
        w(f"- {s['emoji']} [{s['name'][lang]}](#{s['id']}) <sub>{sec_count}</sub>")
        w("  - " + " · ".join(f"[{c['name'][lang]}](#{c['id']}) <sub>{len(by_cat[c['id']])}</sub>" for c in live))
    w("")

    # Sections
    for s in cats["sections"]:
        live = [c for c in s["categories"] if by_cat.get(c["id"])]
        if not live:
            continue
        w("---")
        w("")
        w(f'<a id="{s["id"]}"></a>')
        w(f"## {s['emoji']} {s['name'][lang]}")
        w("")
        w(f"_{s['desc'][lang]}_")
        w("")
        for c in live:
            w(f'<a id="{c["id"]}"></a>')
            w(f"### {c['name'][lang]}")
            w("")
            w(f"<sub>{c['desc'][lang]}</sub>")
            w("")
            groups = c.get("groups")
            entries = sort_items(by_cat[c["id"]])
            if groups:
                order = [g["id"] for g in groups]
                for g in groups:
                    sub = [e for e in entries if e.get("group", "other") == g["id"]]
                    if not sub:
                        continue
                    w(f"**{g['emoji']} {g['name'][lang]}**")
                    w("")
                    for e in sub:
                        w(entry_line(e, lang, cats))
                    w("")
                rest = [e for e in entries if e.get("group", "other") not in order]
                for e in rest:
                    w(entry_line(e, lang, cats))
                if rest:
                    w("")
            else:
                for e in entries:
                    w(entry_line(e, lang, cats))
                w("")
        if s["id"] == "chinese":
            cn = sort_items([it for it in items if it["region"] == "cn" and not it["category"].startswith("cn-")])
            if cn:
                w('<a id="cn-projects"></a>')
                w(f"### {t['cn_index']}")
                w("")
                w(f"<sub>{t['cn_index_desc']}</sub>")
                w("")
                w(" · ".join(
                    f"[{it['name']}]({it['url']})" + (f" ⭐{fmt_stars(it['stars'])}" if it.get("stars") is not None else "")
                    for it in cn))
                w("")
        w(f'<div align="right"><a href="#top">↑ {t["back"]}</a></div>')
        w("")

    # Footer
    w("---")
    w("")
    w(f"## 🤝 {t['contrib_h']}")
    w("")
    w(t["contrib"].format(repo=REPO))
    w("")
    w(f"## 📈 {t['history']}")
    w("")
    w(f"[![Star History Chart](https://api.star-history.com/svg?repos={REPO}&type=Date)](https://star-history.com/#{REPO}&Date)")
    w("")
    w(f"## 📄 {t['license']}")
    w("")
    w(t["license_txt"])
    w("")
    w(f"<sub>{t['disclaimer']}</sub>")
    w("")
    return "\n".join(L)


# --------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="refresh GitHub stats")
    ap.add_argument("--check", action="store_true", help="validate data and exit")
    args = ap.parse_args()

    cats = load_json(DATA / "categories.json")
    projects = load_json(DATA / "projects.json", [])
    errors = validate(projects, cats)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        sys.exit(1)
    if args.check:
        print(f"OK: {len(projects)} entries")
        return

    stats = load_json(DATA / "stats.json", {})
    if args.refresh:
        started = time.time()
        stats = refresh_stats(projects, stats)
        save_json(DATA / "stats.json", dict(sorted(stats.items())))
        print(f"stats refreshed for {len(stats)} repos in {time.time() - started:.0f}s")

    generated = dt.date.today().isoformat()
    items = enrich(projects, cats, stats)
    spotlight = cats.get("spotlight", [])
    for lang, fname in (("en", "README.md"), ("zh", "README.zh-CN.md")):
        (ROOT / fname).write_text(render_readme(lang, cats, items, spotlight, generated),
                                  encoding="utf-8", newline="\n")
    site = {
        "generated": generated,
        "repo": REPO,
        "repo_stars": stats.get(REPO, {}).get("stars"),
        "sections": cats["sections"],
        "regions": cats["regions"],
        "types": cats["types"],
        "spotlight": spotlight,
        "items": [{k: v for k, v in it.items() if k != "order"} for it in items],
    }
    save_json(ROOT / "docs" / "data.json", site, compact=True)
    print(f"built {len(items)} entries -> README.md, README.zh-CN.md, docs/data.json")


if __name__ == "__main__":
    main()
