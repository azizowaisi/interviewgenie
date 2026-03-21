"use strict";

const SERVICE_LABELS = {
    "api-service": "Frontend & Backend (API)",
    "audio-service": "Audio pipeline",
    "stt-service": "Speech-to-text",
    "question-service": "Question / prompts",
    "llm-service": "LLM gateway",
    "formatter-service": "Answer formatter",
    "ollama": "Ollama",
    "mongo": "MongoDB",
    "monitoring-service": "Admin monitor",
    "whisper-service": "Whisper",
  };

  const LS_TOKEN = "adminToken";
  const LS_THEME = "adminTheme";
  const LS_SIDEBAR = "sidebarCollapsed";
  const REFRESH_MS = 10000;
  const CHART_MAX = 48;

  let config = { environment_label: "Production", server_label: "Kubernetes", auth_required: false };
  let clusterCache = null;
  let servicesCache = null;
  let podsCache = null;
  let chartCpu = [];
  let chartMem = [];
  let podsSort = { key: "name", dir: 1 };
  let refreshTimer = null;
  let currentPage = "dashboard";

  const $ = (id) => document.getElementById(id);

  function token() {
    const el = $("input-admin-token");
    return (el && el.value) || localStorage.getItem(LS_TOKEN) || "";
  }

  function headers(json) {
    const h = { Accept: json ? "application/json" : "*/*" };
    const t = token().trim();
    if (t) h["X-Admin-Token"] = t;
    return h;
  }

  async function api(path, opts = {}) {
    const r = await fetch(path, {
      ...opts,
      headers: { ...headers(true), ...(opts.headers || {}) },
    });
    if (r.status === 401) throw new Error("Unauthorized — add admin token in Settings");
    if (!r.ok) throw new Error((await r.text()) || r.statusText);
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("application/json")) return r.json();
    return r.text();
  }

  function showErr(msg) {
    const el = $("global-err");
    if (!el) return;
    if (!msg) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function fmtBytes(n) {
    if (n == null || !n) return "—";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let v = n,
      i = 0;
    while (v >= 1024 && i < u.length - 1) {
      v /= 1024;
      i++;
    }
    return (i ? v.toFixed(1) : v) + " " + u[i];
  }

  function fmtUptime(s) {
    if (s == null) return "—";
    const h = Math.floor(s / 3600),
      m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${m}m` : `${m}m`;
  }

  function labelForService(name) {
    return SERVICE_LABELS[name] || name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function deployFromPod(podName) {
    const known = Object.keys(SERVICE_LABELS);
    for (const k of known) if (podName.startsWith(k)) return k;
    const base = podName.replace(/-[a-f0-9]{6,12}-[a-z0-9]{5}$/i, "").replace(/-\d+$/, "");
    return base.split("-").slice(0, 2).join("-") || base;
  }

  /** Normalize hash: supports #/pods (legacy) and #/admin/pods (spec). */
  function normalizeHashPath() {
    let p = (location.hash || "#/").replace(/^#/, "");
    if (!p || p === "/") return "/";
    if (!p.startsWith("/")) p = "/" + p;
    if (p.startsWith("/admin")) {
      p = p.substring(6) || "/";
      if (p && !p.startsWith("/")) p = "/" + p;
    }
    return p;
  }

  function parseRoute() {
    const p = normalizeHashPath();
    const seg = p.split("/").filter(Boolean);
    if (seg[0] === "service" && seg[1])
      return { page: "service-detail", service: decodeURIComponent(seg[1]) };
    const allowed = ["dashboard", "pods", "services", "logs", "infrastructure", "settings"];
    if (allowed.includes(seg[0])) return { page: seg[0] };
    return { page: "dashboard" };
  }

  function setActiveNav(page) {
    document.querySelectorAll(".nav-item").forEach((btn) => {
      const target = btn.getAttribute("data-page");
      btn.classList.toggle("active", target === page || (page === "service-detail" && target === "services"));
    });
  }

  function showPage(name) {
    document.querySelectorAll(".page").forEach((el) => el.classList.add("hidden"));
    const map = {
      dashboard: "page-dashboard",
      pods: "page-pods",
      services: "page-services",
      logs: "page-logs",
      infrastructure: "page-infrastructure",
      settings: "page-settings",
      "service-detail": "page-service-detail",
    };
    const id = map[name];
    if (id && $(id)) $(id).classList.remove("hidden");
    currentPage = name;
    setActiveNav(name === "service-detail" ? "services" : name);
  }

  const HASH_BASE = "#/admin";

  function navigate(page, serviceName) {
    if (page === "service-detail" && serviceName)
      location.hash = HASH_BASE + "/service/" + encodeURIComponent(serviceName);
    else if (page === "dashboard") location.hash = HASH_BASE + "/";
    else location.hash = HASH_BASE + "/" + page;
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
    localStorage.setItem(LS_THEME, theme === "light" ? "light" : "dark");
    const btn = $("btn-theme");
    if (btn) btn.textContent = theme === "light" ? "Dark mode" : "Light mode";
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(cur === "dark" ? "light" : "dark");
  }

  function updateSparkline(svgId, values, strokeVar) {
    const svg = $(svgId);
    if (!svg) return;
    const w = 100,
      h = 40;
    if (!values.length) {
      svg.innerHTML = `<line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="var(--border)" stroke-width="0.5"/>`;
      return;
    }
    const min = 0,
      max = 100;
    const step = w / Math.max(values.length - 1, 1);
    const pts = values.map((v, i) => {
      const x = i * step;
      const clamped = Math.max(min, Math.min(max, v));
      const y = h - (clamped / 100) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const stroke = strokeVar === "mem" ? "var(--chart-mem)" : "var(--chart-cpu)";
    svg.innerHTML = `<polyline fill="none" stroke="${stroke}" stroke-width="1.2" vector-effect="non-scaling-stroke" points="${pts.join(" ")}"/>`;
  }

  function pushChartSample(cluster) {
    const n0 = cluster.nodes && cluster.nodes[0];
    const cpu = n0 && n0.cpu_percent != null ? n0.cpu_percent : null;
    const mem = n0 && n0.memory_percent != null ? n0.memory_percent : null;
    if (cpu != null) {
      chartCpu.push(cpu);
      if (chartCpu.length > CHART_MAX) chartCpu.shift();
    }
    if (mem != null) {
      chartMem.push(mem);
      if (chartMem.length > CHART_MAX) chartMem.shift();
    }
    updateSparkline("spark-cpu", chartCpu, "cpu");
    updateSparkline("spark-mem", chartMem, "mem");
  }

  function healthFromData(cluster, services) {
    if (!cluster) return { level: "warning", label: "Unknown" };
    const nodesOk = cluster.nodes && cluster.nodes.length && cluster.nodes.every((n) => n.ready);
    const failed = cluster.pods_failed > 0;
    const crash = (services || []).some((s) => s.status === "CrashLoop");
    if (crash || failed || !nodesOk) return { level: "critical", label: "Issues detected" };
    const warn = (services || []).some((s) => s.status === "Degraded" || s.status === "NoEndpoints");
    if (warn) return { level: "warning", label: "Degraded" };
    return { level: "healthy", label: "Healthy" };
  }

  function buildInsight(cluster, services, pods) {
    const lines = [];
    if (!cluster) return lines;
    if (cluster.pods_failed > 0) lines.push(`${cluster.pods_failed} pod(s) failed or stuck — check Pods.`);
    if (!cluster.metrics_available) lines.push("metrics-server not available — CPU/memory charts depend on it.");
    (services || []).forEach((s) => {
      if (s.status === "CrashLoop") lines.push(`${labelForService(s.name)} is in CrashLoopBackOff — inspect logs.`);
      const mem = s.memory_bytes || 0;
      const cpu = s.cpu_millicores || 0;
      if (s.name === "ollama" && mem > 3 * 1024 ** 3)
        lines.push("Ollama is using high memory — consider a smaller model or more node RAM.");
      if (s.name === "ollama" && cpu > 800) lines.push("Ollama CPU is very high — inference may be slow under load.");
      if ((s.name === "whisper-service" || s.name.includes("whisper")) && cpu > 500)
        lines.push("Whisper shows elevated CPU — expected during transcription bursts.");
    });
    if (cluster.nodes && cluster.nodes[0]) {
      const n = cluster.nodes[0];
      if (n.memory_percent != null && n.memory_percent > 85)
        lines.push("Node memory pressure is high — risk of OOM if workloads grow.");
      if (n.cpu_percent != null && n.cpu_percent > 90) lines.push("Node CPU is saturated — consider scaling or larger VM.");
    }
    if (!lines.length) lines.push("System is healthy. Continue monitoring pod restarts and latency.");
    return lines;
  }

  function serviceLoadBadge(s) {
    const cpu = s.cpu_millicores || 0;
    const mem = s.memory_bytes || 0;
    if (cpu > 400 || mem > 2 * 1024 ** 3)
      return '<span class="badge-load">High load</span>';
    if (cpu > 200 || mem > 1024 ** 3)
      return '<span class="badge-load" style="background:rgba(37,99,235,0.2);color:var(--primary)">Moderate</span>';
    return "";
  }

  function statusPill(status) {
    const st = status === "Running" ? "ok" : status === "CrashLoop" ? "bad" : "warn";
    return `<span class="pill ${st}">${escapeHtml(status)}</span>`;
  }

  function bumpLastUpdated() {
    const el = $("top-updated");
    if (!el) return;
    const t = new Date();
    el.textContent =
      "Updated " +
      t.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  async function loadConfig() {
    try {
      config = await api("/api/config");
    } catch (_) {
      config = { environment_label: "Production", server_label: "—", auth_required: false };
    }
    $("top-env").textContent = config.environment_label || "—";
    $("top-server").textContent = config.server_label || "—";
  }

  async function refreshClusterAndCharts() {
    const c = await api("/api/cluster");
    clusterCache = c;
    pushChartSample(c);
    return c;
  }

  async function renderDashboard() {
    showErr("");
    const [cluster, services] = await Promise.all([refreshClusterAndCharts(), api("/api/services")]);
    servicesCache = services.services;

    const h = healthFromData(cluster, services.services);
    const dot = $("top-status-dot");
    dot.className = "status-dot " + h.level;
    const statusEmoji =
      h.level === "healthy" ? "🟢 " : h.level === "warning" ? "🟡 " : "🔴 ";
    $("top-status-text").textContent = statusEmoji + h.label;

    const n0 = cluster.nodes[0] || {};
    const cards = $("dash-cards");
    const card = (label, value, sub, level) => {
      const lev = level ? ` ${level}` : "";
      return `<div class="stat-card${lev}"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value">${value}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ""}</div>`;
    };
    const cpuVal = n0.cpu_percent != null ? `${n0.cpu_percent}%` : cluster.metrics_available ? "—" : "N/A";
    const memVal = n0.memory_percent != null ? `${n0.memory_percent}%` : cluster.metrics_available ? "—" : "N/A";
    const cpuLev =
      !cluster.metrics_available || n0.cpu_percent == null
        ? ""
        : n0.cpu_percent >= 90
          ? "warn"
          : n0.cpu_percent < 80
            ? "ok"
            : "";
    const memLev =
      !cluster.metrics_available || n0.memory_percent == null
        ? ""
        : n0.memory_percent >= 88
          ? "warn"
          : n0.memory_percent < 75
            ? "ok"
            : "";
    cards.innerHTML =
      card(
        "CPU usage",
        cpuVal,
        !cluster.metrics_available ? "Enable metrics-server" : "Node allocatable (first node)",
        cpuLev
      ) +
      card("Memory usage", memVal, cluster.metrics_available ? "First node" : "", memLev) +
      card(
        "Pods running",
        String(cluster.pods_running),
        `${cluster.pods_total} total · ${cluster.pods_failed} failed`,
        cluster.pods_failed ? "critical" : "ok"
      ) +
      card(
        "System status",
        h.label,
        `${cluster.nodes.length} node(s)`,
        h.level === "healthy" ? "ok" : h.level === "warning" ? "warn" : "critical"
      );

    const insight = $("dash-insight");
    const pods = podsCache || (await api("/api/pods")).pods;
    const lines = buildInsight(cluster, services.services, pods);
    insight.innerHTML =
      `<h3>AI health insight</h3><p class="insight-lead">Rule-based hints from live cluster metrics — not an external LLM.</p><ul>` +
      lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("") +
      `</ul>`;

    const grid = $("dash-services-grid");
    grid.innerHTML = (services.services || [])
      .map((s) => {
        const label = labelForService(s.name);
        const dot =
          s.status === "Running"
            ? "🟢"
            : s.status === "CrashLoop"
              ? "🔴"
              : "🟡";
        return `<button type="button" class="service-tile" data-svc="${escapeHtml(s.name)}">
        <div class="service-tile-name">${dot} ${escapeHtml(label)} ${serviceLoadBadge(s)}</div>
        <div class="service-tile-meta">${statusPill(s.status)} · ${escapeHtml(s.pods_ready)} pods</div>
      </button>`;
      })
      .join("");
    grid.querySelectorAll("[data-svc]").forEach((btn) =>
      btn.addEventListener("click", () => navigate("service-detail", btn.getAttribute("data-svc")))
    );
  }

  function filterPods(list, q, phase) {
    q = (q || "").toLowerCase();
    const okPhases = ["Running", "Succeeded", "Completed"];
    return list.filter((p) => {
      if (phase === "running" && p.status !== "Running") return false;
      if (phase === "failed" && okPhases.includes(p.status)) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q);
    });
  }

  function sortPods(list) {
    const { key, dir } = podsSort;
    return [...list].sort((a, b) => {
      let va = a[key],
        vb = b[key];
      if (key === "cpu" || key === "memory") {
        va = String(va || "");
        vb = String(vb || "");
      }
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * dir;
    });
  }

  async function renderPods() {
    showErr("");
    const d = await api("/api/pods");
    podsCache = d.pods;
    const q = ($("pods-search") && $("pods-search").value) || "";
    const phase = ($("pods-filter") && $("pods-filter").value) || "all";
    let rows = sortPods(filterPods(d.pods, q, phase));
    const tb = $("pods-table-body");
    tb.innerHTML = rows
      .map(
        (p) =>
          `<tr>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.status)}</td>
        <td>${escapeHtml(p.cpu || "—")}</td>
        <td>${escapeHtml(p.memory || "—")}</td>
        <td>${p.restarts}</td>
        <td><button type="button" class="btn btn-ghost btn-sm" data-logs="${escapeHtml(p.name)}">Logs</button></td>
        <td><button type="button" class="btn btn-danger btn-sm" data-roll="${escapeHtml(deployFromPod(p.name))}">Restart</button></td>
      </tr>`
      )
      .join("");

    tb.querySelectorAll("[data-logs]").forEach((btn) => {
      btn.addEventListener("click", () => {
        $("log-pod-select").value = "";
        $("log-pod").value = btn.getAttribute("data-logs");
        navigate("logs");
        setTimeout(() => fetchLogs(true), 50);
      });
    });
    tb.querySelectorAll("[data-roll]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const dep = btn.getAttribute("data-roll");
        if (!confirm("Rollout restart deployment " + dep + "?")) return;
        btn.disabled = true;
        try {
          await api("/api/restart?deployment=" + encodeURIComponent(dep), { method: "POST" });
          await renderPods();
        } catch (e) {
          showErr(e.message);
        }
        btn.disabled = false;
      });
    });
  }

  async function renderServicesPage() {
    showErr("");
    const d = await api("/api/services");
    servicesCache = d.services;
    const grid = $("services-page-grid");
    grid.innerHTML = d.services
      .map((s) => {
        const noRestart = /^(mongo|mongodb)$/i.test(s.name);
        return `<div class="panel" style="padding:1.1rem">
        <div style="font-weight:600;margin-bottom:0.35rem">${escapeHtml(labelForService(s.name))}</div>
        <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.75rem">${escapeHtml(s.name)}</div>
        <div style="margin-bottom:0.5rem">${statusPill(s.status)}</div>
        <div class="kv-grid" style="margin:0.75rem 0;font-size:0.85rem">
          <div><dt>CPU</dt><dd>${s.cpu_millicores != null ? s.cpu_millicores + " m" : "—"}</dd></div>
          <div><dt>Memory</dt><dd>${fmtBytes(s.memory_bytes)}</dd></div>
          <div><dt>Uptime</dt><dd>${fmtUptime(s.uptime_seconds)}</dd></div>
          <div><dt>Pods</dt><dd>${escapeHtml(s.pods_ready)}</dd></div>
        </div>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
          <button type="button" class="btn btn-ghost btn-sm btn-open-svc" data-svc="${escapeHtml(s.name)}">Details</button>
          <button type="button" class="btn btn-ghost btn-sm btn-logs-svc" data-svc="${escapeHtml(s.name)}">Logs</button>
          ${
            noRestart
              ? '<span class="hint">StatefulSet — use kubectl</span>'
              : `<button type="button" class="btn btn-danger btn-sm btn-restart-svc" data-dep="${escapeHtml(s.name)}">Restart</button>`
          }
        </div>
      </div>`;
      })
      .join("");

    grid.querySelectorAll(".btn-open-svc").forEach((b) =>
      b.addEventListener("click", () => navigate("service-detail", b.getAttribute("data-svc")))
    );
    grid.querySelectorAll(".btn-logs-svc").forEach((b) => {
      b.addEventListener("click", async () => {
        const name = b.getAttribute("data-svc");
        const pods = podsCache || (await api("/api/pods")).pods;
        const match = pods.filter((p) => p.name.startsWith(name));
        const pod = match[0];
        if (pod) {
          $("log-pod").value = pod.name;
          navigate("logs");
          setTimeout(() => fetchLogs(true), 50);
        } else showErr("No pod found for service " + name);
      });
    });
    grid.querySelectorAll(".btn-restart-svc").forEach((b) => {
      b.addEventListener("click", async () => {
        const dep = b.getAttribute("data-dep");
        if (!confirm("Restart deployment " + dep + "?")) return;
        try {
          await api("/api/restart?deployment=" + encodeURIComponent(dep), { method: "POST" });
          await renderServicesPage();
        } catch (e) {
          showErr(e.message);
        }
      });
    });
  }

  async function renderServiceDetail(svcName) {
    showErr("");
    const [d, podsData] = await Promise.all([api("/api/services"), api("/api/pods")]);
    podsCache = podsData.pods;
    const s = d.services.find((x) => x.name === svcName);
    const el = $("service-detail-root");
    if (!s) {
      el.innerHTML = `<p class="hint">Service not found.</p><button type="button" class="btn btn-primary" onclick="location.hash='#/admin/services'">Back</button>`;
      return;
    }
    const matching = podsData.pods.filter((p) => p.name.startsWith(svcName));
    const noRestart = /^(mongo|mongodb)$/i.test(s.name);
    el.innerHTML = `
    <div class="detail-header">
      <div>
        <h1 class="page-title" style="margin-bottom:0.25rem">${escapeHtml(labelForService(s.name))}</h1>
        <div class="hint">${escapeHtml(s.name)} · ${escapeHtml(s.type || "")}</div>
      </div>
      <div class="detail-actions">
        <button type="button" class="btn btn-ghost" id="svc-back">← Services</button>
        ${
          noRestart
            ? ""
            : `<button type="button" class="btn btn-danger" id="svc-restart">Restart deployment</button>`
        }
      </div>
    </div>
    <div class="cards-grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">
      <div class="stat-card"><div class="stat-label">Status</div><div class="stat-value" style="font-size:1.1rem">${statusPill(s.status)}</div></div>
      <div class="stat-card"><div class="stat-label">CPU</div><div class="stat-value" style="font-size:1.25rem">${s.cpu_millicores != null ? s.cpu_millicores + "m" : "—"}</div></div>
      <div class="stat-card"><div class="stat-label">Memory</div><div class="stat-value" style="font-size:1.25rem">${fmtBytes(s.memory_bytes)}</div></div>
      <div class="stat-card"><div class="stat-label">Uptime</div><div class="stat-value" style="font-size:1.25rem">${fmtUptime(s.uptime_seconds)}</div></div>
    </div>
    <h2 class="page-title" style="font-size:1rem">Pods</h2>
    <div class="panel">
      <table class="data-table">
        <thead><tr><th>Name</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
        ${matching
          .map(
            (p) =>
              `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.status)}</td>
            <td><button type="button" class="btn btn-ghost btn-sm svc-pod-logs" data-pod="${escapeHtml(p.name)}">Logs</button></td></tr>`
          )
          .join("") || `<tr><td colspan="3">No pods matched prefix.</td></tr>`}
        </tbody>
      </table>
    </div>`;
    $("svc-back").addEventListener("click", () => navigate("services"));
    const rs = $("svc-restart");
    if (rs)
      rs.addEventListener("click", async () => {
        if (!confirm("Restart " + svcName + "?")) return;
        try {
          await api("/api/restart?deployment=" + encodeURIComponent(svcName), { method: "POST" });
          await renderServiceDetail(svcName);
        } catch (e) {
          showErr(e.message);
        }
      });
    el.querySelectorAll(".svc-pod-logs").forEach((b) => {
      b.addEventListener("click", () => {
        $("log-pod").value = b.getAttribute("data-pod");
        navigate("logs");
        setTimeout(() => fetchLogs(true), 50);
      });
    });
  }

  async function renderInfrastructure() {
    showErr("");
    const data = await api("/api/infrastructure");
    const root = $("infra-root");
    root.innerHTML = (data.nodes || [])
      .map((n) => {
        return `<div class="panel infra-node" style="padding:1.15rem">
        <h3>${escapeHtml(n.name)} ${n.ready ? '<span class="pill ok">Ready</span>' : '<span class="pill bad">NotReady</span>'}</h3>
        <div class="kv-grid">
          <div><dt>Architecture</dt><dd>${escapeHtml(n.architecture || "—")}</dd></div>
          <div><dt>Instance type</dt><dd>${escapeHtml(n.instance_type || "—")}</dd></div>
          <div><dt>OS</dt><dd>${escapeHtml(n.os_image || "—")}</dd></div>
          <div><dt>Kernel</dt><dd>${escapeHtml(n.kernel_version || "—")}</dd></div>
          <div><dt>Kubelet</dt><dd>${escapeHtml(n.kubelet_version || "—")}</dd></div>
          <div><dt>CPU (capacity)</dt><dd>${escapeHtml(String(n.capacity_cpu_display || n.capacity_cpu || "—"))}</dd></div>
          <div><dt>Memory (capacity)</dt><dd>${fmtBytes(n.capacity_memory_bytes)}</dd></div>
          <div><dt>Ephemeral disk (capacity)</dt><dd>${n.capacity_ephemeral_bytes ? fmtBytes(n.capacity_ephemeral_bytes) : "—"}</dd></div>
          <div><dt>CPU usage</dt><dd>${n.cpu_percent != null ? n.cpu_percent + "%" : "—"}</dd></div>
          <div><dt>Memory usage</dt><dd>${n.memory_percent != null ? n.memory_percent + "%" : "—"}</dd></div>
        </div>
      </div>`;
      })
      .join("") || "<p class='hint'>No nodes returned.</p>";
  }

  function fillLogPodSelect() {
    const sel = $("log-pod-select");
    if (!sel || !podsCache) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">Select pod…</option>' + podsCache.map((p) => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join("");
    if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
  }

  async function fetchLogs(scrollBottom) {
    showErr("");
    const pod = ($("log-pod") && $("log-pod").value.trim()) || ($("log-pod-select") && $("log-pod-select").value);
    if (!pod) {
      showErr("Select or enter a pod name");
      return;
    }
    let url = "/api/logs?pod=" + encodeURIComponent(pod) + "&tail=1000";
    const c = $("log-container") && $("log-container").value.trim();
    if (c) url += "&container=" + encodeURIComponent(c);
    const r = await fetch(url, { headers: { ...headers(false), Accept: "text/plain" } });
    if (r.status === 401) {
      showErr("Unauthorized");
      return;
    }
    const text = await r.text();
    if (!r.ok) {
      showErr(text || r.statusText);
      return;
    }
    $("log-out").dataset.raw = text;
    applyLogFilter(scrollBottom);
  }

  function lineMatchesLogLevel(line, level) {
    if (!level || level === "all") return true;
    const s = line.toLowerCase();
    const err = /\berror\b|\berr\b|\bfatal\b|\bpanic\b|exception/i.test(line);
    const wrn = /\bwarn\b|\bwrn\b|\bwarning\b/i.test(line);
    if (level === "error") return err;
    if (level === "warn") return wrn && !err;
    if (level === "info") return !err && !wrn;
    return true;
  }

  function applyLogFilter(scrollBottom) {
    const raw = ($("log-out") && $("log-out").dataset.raw) || "";
    const filter = ($("log-filter") && $("log-filter").value.trim().toLowerCase()) || "";
    const levelSel = $("log-level-filter");
    const level = levelSel ? levelSel.value : "all";
    let lines = raw.split("\n");
    if (filter) lines = lines.filter((ln) => ln.toLowerCase().includes(filter));
    lines = lines.filter((ln) => lineMatchesLogLevel(ln, level));
    const out = $("log-out");
    out.textContent = lines.join("\n") || "(empty)";
    const auto = $("log-autoscroll") && $("log-autoscroll").checked;
    if (auto || scrollBottom) out.scrollTop = out.scrollHeight;
  }

  function wireLogsPage() {
    fillLogPodSelect();
    const sel = $("log-pod-select");
    if (sel && !sel.dataset.wired) {
      sel.dataset.wired = "1";
      sel.addEventListener("change", () => {
        const v = sel.value;
        if (v) $("log-pod").value = v;
      });
    }
    const btn = $("btn-fetch-logs");
    if (btn && !btn.dataset.wired) {
      btn.dataset.wired = "1";
      btn.addEventListener("click", () => fetchLogs(true).catch((e) => showErr(e.message)));
    }
    const lf = $("log-filter");
    if (lf && !lf.dataset.wired) {
      lf.dataset.wired = "1";
      lf.addEventListener("input", () => applyLogFilter(false));
    }
    const ll = $("log-level-filter");
    if (ll && !ll.dataset.wired) {
      ll.dataset.wired = "1";
      ll.addEventListener("change", () => applyLogFilter(false));
    }
  }

  async function routeHandler() {
    const r = parseRoute();
    showPage(r.page === "service-detail" ? "service-detail" : r.page);
    showErr("");
    try {
      if (r.page === "dashboard") await renderDashboard();
      else if (r.page === "pods") await renderPods();
      else if (r.page === "services") await renderServicesPage();
      else if (r.page === "logs") {
        if (!podsCache) podsCache = (await api("/api/pods")).pods;
        fillLogPodSelect();
        wireLogsPage();
      } else if (r.page === "infrastructure") await renderInfrastructure();
      else if (r.page === "settings") {
        /* no-op */
      } else if (r.page === "service-detail") await renderServiceDetail(r.service);
      bumpLastUpdated();
    } catch (e) {
      showErr(e.message || String(e));
    }
  }

  function refreshCurrentPage() {
    routeHandler().catch((e) => showErr(e.message));
  }

  function startAutoRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (document.hidden) return;
      const p = parseRoute().page;
      if (p === "dashboard" || p === "pods" || p === "services" || p === "service-detail") refreshCurrentPage();
    }, REFRESH_MS);
  }

  function init() {
    const savedTheme = localStorage.getItem(LS_THEME) || "dark";
    applyTheme(savedTheme === "light" ? "light" : "dark");

    const tok = localStorage.getItem(LS_TOKEN);
    if (tok && $("input-admin-token")) $("input-admin-token").value = tok;

    if (localStorage.getItem(LS_SIDEBAR) === "1") {
      $("sidebar").classList.add("collapsed");
    }

    loadConfig().catch(() => {});

    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = btn.getAttribute("data-page");
        if (p === "dashboard") navigate("dashboard");
        else navigate(p);
        document.body.classList.remove("drawer-open");
      });
    });

    $("btn-sidebar-collapse").addEventListener("click", () => {
      $("sidebar").classList.toggle("collapsed");
      localStorage.setItem(LS_SIDEBAR, $("sidebar").classList.contains("collapsed") ? "1" : "0");
    });

    $("menu-btn").addEventListener("click", () => document.body.classList.add("drawer-open"));
    $("sidebar-overlay").addEventListener("click", () => document.body.classList.remove("drawer-open"));

    $("btn-refresh").addEventListener("click", () => refreshCurrentPage());
    $("btn-theme").addEventListener("click", toggleTheme);

    const tokInput = $("input-admin-token");
    if (tokInput) {
      tokInput.addEventListener("change", () => localStorage.setItem(LS_TOKEN, tokInput.value));
      tokInput.addEventListener("input", () => localStorage.setItem(LS_TOKEN, tokInput.value));
    }

    const podsHead = $("pods-table-head");
    if (podsHead && !podsHead.dataset.wired) {
      podsHead.dataset.wired = "1";
      podsHead.addEventListener("click", (e) => {
        const th = e.target.closest("[data-sort]");
        if (!th) return;
        const k = th.getAttribute("data-sort");
        if (podsSort.key === k) podsSort.dir *= -1;
        else {
          podsSort.key = k;
          podsSort.dir = 1;
        }
        if (parseRoute().page === "pods") renderPods().catch((err) => showErr(err.message));
      });
    }

    let podsSearchT;
    const ps = $("pods-search");
    if (ps) {
      ps.addEventListener("input", () => {
        clearTimeout(podsSearchT);
        podsSearchT = setTimeout(() => {
          if (parseRoute().page === "pods") renderPods().catch((err) => showErr(err.message));
        }, 200);
      });
    }
    const pf = $("pods-filter");
    if (pf) {
      pf.addEventListener("change", () => {
        if (parseRoute().page === "pods") renderPods().catch((err) => showErr(err.message));
      });
    }

    window.addEventListener("hashchange", () => routeHandler());
    routeHandler();
    startAutoRefresh();
  }

export function bootstrapAdminUi() {
  if (window.__IG_ADMIN_BOOTED__) return;
  window.__IG_ADMIN_BOOTED__ = true;
  init();
}
