(function () {
  "use strict";

  var I18N = {
    en: {
      eyebrow: "Community-curated · bilingual · updated weekly",
      title: "The Claude Code ecosystem, organised.",
      lede: "Tools, skills, subagents, plugins, MCP servers, apps, guides, videos and communities, from GitHub to Bilibili, sorted by what they do.",
      searchPh: "Search {n} resources, e.g. “statusline”, “mcp browser”, “bilibili”",
      start: "Start here",
      startDesc: "If you only bookmark a few things, make it these.",
      board: "Most starred Claude Code projects",
      categories: "Categories",
      everything: "Everything",
      sort: "Sort",
      sortCurated: "Curated",
      sortStars: "Most stars",
      sortUpdated: "Recently updated",
      sortName: "Name",
      reset: "Clear filters",
      star: "Star on GitHub",
      count: "Showing {n} of {t} resources",
      empty: "Nothing matches. Try fewer words, or clear the filters.",
      tAll: "All", tRepo: "Repos", tVideo: "Videos", tRead: "Docs & articles", tComm: "Communities",
      rAll: "All regions",
      sResources: "resources", sCategories: "categories", sRepos: "GitHub repos", sStars: "combined stars", sCn: "Chinese community", sUpdated: "last updated",
      topPick: "Top pick",
      archived: "archived",
      by: "by", up: "by",
      updated: "updated {t}",
      ago: { d: "{n}d ago", mo: "{n}mo ago", y: "{n}y ago", today: "today" },
      generated: "Data generated {d} from data/projects.json.",
      contrib: 'Know something that belongs here? <a href="https://github.com/tomcatmew/awesome-Claude-code/issues/new/choose">Suggest it</a> or open a pull request against <code>data/projects.json</code>.',
      disclaimer: "Community project, not affiliated with or endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic, PBC. Review third-party code before running it.",
      langBtn: "中文"
    },
    zh: {
      eyebrow: "社区整理 · 中英双语 · 每周自动更新",
      title: "Claude Code 生态，一页看全。",
      lede: "工具、技能、子代理、插件、MCP 服务器、应用、教程、视频与社区，从 GitHub 到 B 站，按功能分类整理。",
      searchPh: "搜索 {n} 个资源，例如 “状态栏”、“mcp browser”、“B站”",
      start: "从这里开始",
      startDesc: "如果只收藏几个，就收藏这些。",
      board: "Claude Code 项目 Star 排行",
      categories: "分类",
      everything: "全部",
      sort: "排序",
      sortCurated: "精选顺序",
      sortStars: "Star 最多",
      sortUpdated: "最近更新",
      sortName: "名称",
      reset: "清除筛选",
      star: "在 GitHub 上 Star",
      count: "显示 {n} / {t} 个资源",
      empty: "没有匹配的结果。试试减少关键词或清除筛选。",
      tAll: "全部", tRepo: "仓库", tVideo: "视频", tRead: "文档与文章", tComm: "社区",
      rAll: "全部地区",
      sResources: "个资源", sCategories: "个分类", sRepos: "个 GitHub 仓库", sStars: "Star 总数", sCn: "中文社区条目", sUpdated: "最近更新",
      topPick: "精选",
      archived: "已归档",
      by: "作者", up: "UP主",
      updated: "{t}更新",
      ago: { d: "{n} 天前", mo: "{n} 个月前", y: "{n} 年前", today: "今天" },
      generated: "数据生成于 {d}，来源 data/projects.json。",
      contrib: '有值得收录的项目？欢迎<a href="https://github.com/tomcatmew/awesome-Claude-code/issues/new/choose">提交推荐</a>，或直接向 <code>data/projects.json</code> 发起 Pull Request。',
      disclaimer: "社区项目，与 Anthropic 无隶属或背书关系。Claude 与 Claude Code 是 Anthropic, PBC 的商标。运行第三方代码前请先审阅。",
      langBtn: "EN"
    }
  };

  var TYPE_GROUPS = {
    all: null,
    repo: ["repo"],
    video: ["video", "channel"],
    read: ["doc", "article", "course", "website", "newsletter", "podcast"],
    comm: ["community"]
  };

  var $ = function (s) { return document.querySelector(s); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  var DATA = null, CAT = {}, SEC = {}, ORDER = {};
  var params = new URLSearchParams(location.search);
  var state = {
    q: params.get("q") || "",
    cat: params.get("cat") || "all",
    type: params.get("type") || "all",
    region: params.get("region") || "all",
    sort: params.get("sort") || "curated",
    lang: params.get("lang") || store.get("acc-lang") ||
      ((navigator.language || "").toLowerCase().indexOf("zh") === 0 ? "zh" : "en")
  };
  if (!I18N[state.lang]) state.lang = "en";

  function t(key) { return I18N[state.lang][key]; }
  function fmt(s, o) { return s.replace(/\{(\w+)\}/g, function (_, k) { return o[k]; }); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function stars(n) {
    if (n == null) return "";
    if (n >= 100000) return Math.round(n / 1000) + "k";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    return String(n);
  }
  function ago(iso) {
    if (!iso) return null;
    var days = Math.floor((Date.now() - Date.parse(iso)) / 864e5);
    var a = t("ago");
    if (days < 1) return { s: a.today, days: 0 };
    if (days < 60) return { s: fmt(a.d, { n: days }), days: days };
    if (days < 730) return { s: fmt(a.mo, { n: Math.round(days / 30) }), days: days };
    return { s: fmt(a.y, { n: Math.round(days / 365) }), days: days };
  }

  // ------------------------------------------------------------------ filters
  function terms() {
    return state.q.toLowerCase().split(/\s+/).filter(Boolean);
  }
  function haystack(it) {
    if (!it._h) {
      var c = CAT[it.category];
      it._h = [it.name, it.repo || "", it.url, it.desc.en, it.desc.zh, (it.tags || []).join(" "),
        it.author || "", c.name.en, c.name.zh, it.region === "cn" ? "china chinese 中文 国产" : ""].join(" ").toLowerCase();
    }
    return it._h;
  }
  function matches(it, opts) {
    opts = opts || {};
    var tg = TYPE_GROUPS[state.type];
    if (tg && tg.indexOf(it.type) < 0) return false;
    if (state.region !== "all" && it.region !== state.region) return false;
    if (!opts.ignoreCat && state.cat !== "all") {
      if (state.cat.indexOf("sec:") === 0) { if (it.section !== state.cat.slice(4)) return false; }
      else if (it.category !== state.cat) return false;
    }
    var h = haystack(it), ts = terms();
    for (var i = 0; i < ts.length; i++) if (h.indexOf(ts[i]) < 0) return false;
    return true;
  }
  function sorter(a, b) {
    if (state.sort === "stars") return (b.stars || -1) - (a.stars || -1) || a.name.localeCompare(b.name);
    if (state.sort === "updated") return (Date.parse(b.pushed_at || 0) || 0) - (Date.parse(a.pushed_at || 0) || 0) || (b.stars || 0) - (a.stars || 0);
    if (state.sort === "name") return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    return (b.featured - a.featured) || (b.stars || -1) - (a.stars || -1) || ORDER[a.url] - ORDER[b.url];
  }

  function highlight(text) {
    var safe = esc(text), ts = terms();
    if (!ts.length) return safe;
    var re = new RegExp("(" + ts.map(function (x) { return esc(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("|") + ")", "gi");
    return safe.replace(re, "<mark>$1</mark>");
  }

  // ------------------------------------------------------------------- render
  function rowHTML(it, showCat) {
    var flag = DATA.regions[it.region] ? DATA.regions[it.region].flag : "";
    var type = DATA.types[it.type] || {};
    var badges = "";
    if (it.featured) badges += '<span class="badge top">🏆 ' + esc(t("topPick")) + "</span>";
    if (it.type !== "repo" && type.icon) badges += '<span class="badge">' + type.icon + " " + esc(type[state.lang]) + "</span>";
    if (flag) badges += '<span class="badge" title="' + esc(DATA.regions[it.region][state.lang]) + '">' + flag + "</span>";
    if (it.archived) badges += '<span class="badge arch">🗄️ ' + esc(t("archived")) + "</span>";
    if (it.author) badges += '<span class="badge">' + esc((it.category === "cn-video" ? t("up") : t("by")) + " " + it.author) + "</span>";
    if (showCat) badges += '<span class="badge cat">' + esc(CAT[it.category].name[state.lang]) + "</span>";
    var slug = it.repo ? it.repo : it.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    if (slug.length > 60) slug = slug.slice(0, 57) + "…";
    var side = "";
    if (it.stars != null) side += '<span class="stars" title="' + it.stars.toLocaleString() + ' stars">' + stars(it.stars) + "</span>";
    var u = ago(it.pushed_at);
    if (u) side += '<span class="upd' + (u.days <= 30 ? " fresh" : "") + '" title="' + esc(it.pushed_at) + '">' + esc(fmt(t("updated"), { t: u.s })) + "</span>";
    var tags = (it.tags || []).slice(0, 6).map(function (x) {
      return '<button type="button" class="tag" data-tag="' + esc(x) + '">#' + esc(x) + "</button>";
    }).join("");
    return '<li class="row"><div class="row-main"><div class="row-title">' +
      '<a class="name" href="' + esc(it.url) + '" target="_blank" rel="noopener">' + highlight(it.name) + "</a>" +
      '<span class="slug">' + esc(slug) + "</span>" + badges + "</div>" +
      '<p class="row-desc">' + highlight(it.desc[state.lang]) + "</p>" +
      (tags ? '<div class="tags">' + tags + "</div>" : "") + "</div>" +
      (side ? '<div class="row-side">' + side + "</div>" : "") + "</li>";
  }

  function renderResults() {
    var hits = DATA.items.filter(function (it) { return matches(it); });
    var box = $("#results");
    $("#count").textContent = fmt(t("count"), { n: hits.length, t: DATA.items.length });
    var dirty = state.q || state.cat !== "all" || state.type !== "all" || state.region !== "all" || state.sort !== "curated";
    $("#reset").hidden = !dirty;
    if (!hits.length) { box.innerHTML = '<div class="empty">' + esc(t("empty")) + "</div>"; return; }

    if (state.sort !== "curated") {
      hits.sort(sorter);
      box.innerHTML = '<ul class="list" style="margin-top:8px">' + hits.map(function (it) { return rowHTML(it, true); }).join("") + "</ul>";
      return;
    }
    var html = "";
    DATA.sections.forEach(function (s) {
      var secHtml = "";
      s.categories.forEach(function (c) {
        var list = hits.filter(function (it) { return it.category === c.id; }).sort(sorter);
        if (!list.length) return;
        secHtml += '<div class="cat-block" id="c-' + c.id + '"><h3>' + esc(c.name[state.lang]) +
          ' <span class="n">' + list.length + "</span></h3><p>" + esc(c.desc[state.lang]) + "</p>";
        if (c.groups) {
          var known = {};
          c.groups.forEach(function (g) {
            known[g.id] = 1;
            var sub = list.filter(function (it) { return (it.group || "other") === g.id; });
            if (!sub.length) return;
            secHtml += '<div class="group-h">' + g.emoji + " " + esc(g.name[state.lang]) + "</div>" +
              '<ul class="list">' + sub.map(function (it) { return rowHTML(it); }).join("") + "</ul>";
          });
          var rest = list.filter(function (it) { return !known[it.group || "other"]; });
          if (rest.length) secHtml += '<ul class="list">' + rest.map(function (it) { return rowHTML(it); }).join("") + "</ul>";
        } else {
          secHtml += '<ul class="list">' + list.map(function (it) { return rowHTML(it); }).join("") + "</ul>";
        }
        secHtml += "</div>";
      });
      if (secHtml) {
        html += '<section class="sec-block" id="s-' + s.id + '"><h2>' + s.emoji + " " + esc(s.name[state.lang]) +
          "</h2><p>" + esc(s.desc[state.lang]) + "</p>" + secHtml + "</section>";
      }
    });
    box.innerHTML = html;
  }

  function renderSidebar() {
    var base = DATA.items.filter(function (it) { return matches(it, { ignoreCat: true }); });
    var count = {};
    base.forEach(function (it) {
      count[it.category] = (count[it.category] || 0) + 1;
      count["sec:" + it.section] = (count["sec:" + it.section] || 0) + 1;
    });
    function btn(id, label, cls, n) {
      return '<button type="button" class="cat-btn ' + cls + '" data-cat="' + id + '" aria-pressed="' + (state.cat === id) + '"' +
        (n ? "" : " disabled") + "><span>" + label + '</span><span class="n">' + (n || 0) + "</span></button>";
    }
    var html = btn("all", esc(t("everything")), "sec", base.length);
    DATA.sections.forEach(function (s) {
      if (!s.categories.some(function (c) { return CAT[c.id]._total; })) return;
      html += btn("sec:" + s.id, s.emoji + " " + esc(s.name[state.lang]), "sec", count["sec:" + s.id]);
      s.categories.forEach(function (c) {
        if (!CAT[c.id]._total) return;
        html += btn(c.id, esc(c.name[state.lang]), "sub", count[c.id]);
      });
    });
    $("#cats").innerHTML = html;
  }

  function renderFilters() {
    var types = [["all", "tAll"], ["repo", "tRepo"], ["video", "tVideo"], ["read", "tRead"], ["comm", "tComm"]];
    $("#type-filter").innerHTML = types.map(function (x) {
      return '<button type="button" data-type="' + x[0] + '" aria-pressed="' + (state.type === x[0]) + '">' + esc(t(x[1])) + "</button>";
    }).join("");
    var present = {};
    DATA.items.forEach(function (it) { if (it.region !== "global") present[it.region] = (present[it.region] || 0) + 1; });
    var regions = Object.keys(present).filter(function (r) { return present[r] >= 3 || state.region === r; })
      .sort(function (a, b) { return present[b] - present[a]; });
    $("#region-filter").innerHTML = '<button type="button" data-region="all" aria-pressed="' + (state.region === "all") + '">' + esc(t("rAll")) + "</button>" +
      regions.map(function (r) {
        var info = DATA.regions[r] || { flag: r, en: r, zh: r };
        return '<button type="button" data-region="' + r + '" aria-pressed="' + (state.region === r) + '" title="' + esc(info[state.lang]) + '">' +
          info.flag + " " + esc(info[state.lang]) + "</button>";
      }).join("");
    $("#sort").value = state.sort;
  }

  function renderStatic() {
    document.documentElement.lang = state.lang === "zh" ? "zh-CN" : "en";
    document.querySelectorAll("[data-i18n]").forEach(function (el) { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-html]").forEach(function (el) { el.innerHTML = t(el.dataset.i18nHtml); });
    $("#lang-toggle").textContent = t("langBtn");
    $("#q").placeholder = fmt(t("searchPh"), { n: DATA.items.length });
    $("#generated").textContent = fmt(t("generated"), { d: DATA.generated });

    var repos = DATA.items.filter(function (it) { return it.repo; });
    var total = repos.reduce(function (s, it) { return s + (it.stars || 0); }, 0);
    var cats = Object.keys(CAT).filter(function (k) { return CAT[k]._total; }).length;
    var cn = DATA.items.filter(function (it) { return it.region === "cn"; }).length;
    var st = [[DATA.items.length, "sResources"], [cats, "sCategories"], [repos.length, "sRepos"],
      [total >= 1e6 ? (total / 1e6).toFixed(1) + "M" : stars(total), "sStars"], [cn, "sCn"], [DATA.generated, "sUpdated"]];
    $("#stats").innerHTML = st.map(function (x) { return "<div><dt>" + esc(t(x[1])) + "</dt><dd>" + esc(x[0]) + "</dd></div>"; }).join("");

    var byUrl = {};
    DATA.items.forEach(function (it) { byUrl[it.url] = it; });
    $("#spot-grid").innerHTML = (DATA.spotlight || []).map(function (u) { return byUrl[u]; }).filter(Boolean).map(function (it) {
      return '<a class="spot-card" href="' + esc(it.url) + '" target="_blank" rel="noopener"><span class="top"><strong>' + esc(it.name) +
        "</strong>" + (it.stars != null ? '<span class="stars">' + stars(it.stars) + "</span>" : "") + "</span><p>" +
        esc(it.desc[state.lang]) + '</p><span class="cat">' + esc(CAT[it.category].name[state.lang]) + "</span></a>";
    }).join("");
    $("#spot").hidden = !(DATA.spotlight || []).length;

    // The leaderboard is about the Claude Code ecosystem itself, so general-purpose apps are left out.
    var boardSections = { official: 1, extending: 1, workflows: 1, tooling: 1, mcp: 1, learning: 1, chinese: 1 };
    $("#board").innerHTML = repos.filter(function (it) { return boardSections[it.section]; }).sort(function (a, b) { return (b.stars || 0) - (a.stars || 0); }).slice(0, 12).map(function (it) {
      return '<li><a href="' + esc(it.url) + '" target="_blank" rel="noopener" title="' + esc(it.desc[state.lang]) + '">' + esc(it.name) +
        '</a><span class="stars">' + stars(it.stars) + "</span></li>";
    }).join("");
  }

  function syncURL() {
    var p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.cat !== "all") p.set("cat", state.cat);
    if (state.type !== "all") p.set("type", state.type);
    if (state.region !== "all") p.set("region", state.region);
    if (state.sort !== "curated") p.set("sort", state.sort);
    var s = p.toString();
    history.replaceState(null, "", location.pathname + (s ? "?" + s : "") + location.hash);
  }

  function update(opts) {
    renderFilters();
    renderSidebar();
    renderResults();
    syncURL();
    if (opts && opts.scroll) {
      var top = $("#browse").getBoundingClientRect().top + window.scrollY - 70;
      if (window.scrollY > top) window.scrollTo({ top: top });
    }
  }

  // ------------------------------------------------------------------- events
  function bind() {
    var timer;
    var q = $("#q");
    q.value = state.q;
    q.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () { state.q = q.value.trim(); update(); }, 90);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "/" && document.activeElement !== q && !/input|select|textarea/i.test(document.activeElement.tagName)) {
        e.preventDefault(); q.focus(); q.select();
      } else if (e.key === "Escape" && document.activeElement === q && q.value) {
        q.value = ""; state.q = ""; update();
      }
    });
    $("#cats").addEventListener("click", function (e) {
      var b = e.target.closest(".cat-btn");
      if (!b || b.disabled) return;
      state.cat = b.dataset.cat;
      if (window.matchMedia("(max-width: 820px)").matches) $("#cat-details").open = false;
      update({ scroll: true });
    });
    $("#type-filter").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      state.type = b.dataset.type; update();
    });
    $("#region-filter").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      state.region = b.dataset.region; update();
    });
    $("#sort").addEventListener("change", function (e) { state.sort = e.target.value; update(); });
    $("#reset").addEventListener("click", function () {
      state.q = ""; state.cat = "all"; state.type = "all"; state.region = "all"; state.sort = "curated";
      q.value = ""; update();
    });
    $("#results").addEventListener("click", function (e) {
      var b = e.target.closest(".tag"); if (!b) return;
      state.q = b.dataset.tag; q.value = state.q; update({ scroll: true });
    });
    $("#lang-toggle").addEventListener("click", function () {
      state.lang = state.lang === "en" ? "zh" : "en";
      store.set("acc-lang", state.lang);
      renderStatic(); update();
    });
    $("#theme-toggle").addEventListener("click", function () {
      var root = document.documentElement;
      var dark = root.dataset.theme ? root.dataset.theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.dataset.theme = dark ? "light" : "dark";
      store.set("acc-theme", root.dataset.theme);
    });
    // The category panel is always open on desktop and collapsible on small screens.
    var mq = window.matchMedia("(max-width: 820px)");
    var details = $("#cat-details");
    function applyMQ() { details.open = !mq.matches; }
    applyMQ();
    if (mq.addEventListener) mq.addEventListener("change", applyMQ); else mq.addListener(applyMQ);
    details.querySelector("summary").addEventListener("click", function (e) { if (!mq.matches) e.preventDefault(); });
  }

  // Live star count for this repo on the header button; cached per visitor for an hour (anonymous API limit is 60/h).
  function loadRepoStars(repo, fallback) {
    function show(n) { var el = $("#gh-count"); el.textContent = stars(n) || "0"; el.hidden = false; }
    if (typeof fallback === "number") show(fallback);
    var cached = null;
    try { cached = JSON.parse(sessionStorage.getItem("acc-stars") || "null"); } catch (e) {}
    if (cached && Date.now() - cached.t < 36e5) { show(cached.n); return; }
    fetch("https://api.github.com/repos/" + repo).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || typeof j.stargazers_count !== "number") return;
      show(j.stargazers_count);
      try { sessionStorage.setItem("acc-stars", JSON.stringify({ t: Date.now(), n: j.stargazers_count })); } catch (e) {}
    }).catch(function () {});
  }

  fetch("data.json").then(function (r) { return r.json(); }).then(function (d) {
    DATA = d;
    d.sections.forEach(function (s) {
      SEC[s.id] = s;
      s.categories.forEach(function (c) { CAT[c.id] = c; c._total = 0; });
    });
    d.items.forEach(function (it, i) { ORDER[it.url] = i; CAT[it.category]._total++; });
    renderStatic();
    bind();
    update();
    loadRepoStars(d.repo, d.repo_stars);
  }).catch(function (err) {
    $("#results").innerHTML = '<div class="empty">Could not load data.json (' + esc(err.message) + ")</div>";
  });
})();
