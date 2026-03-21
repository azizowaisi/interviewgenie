<template>
  <div class="landing">
    <div class="gradient" aria-hidden="true"></div>
    <div class="wrap">
      <header>
        <div class="logo">Interview <span>Genie</span></div>
        <nav>
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="/docs" target="_blank" rel="noopener">API docs</a>
          <a href="/health" target="_blank" rel="noopener">Health</a>
        </nav>
      </header>

      <section class="hero">
        <div class="pill">AI interview copilot</div>
        <h1>Prepare smarter. Answer with clarity — in STAR format.</h1>
        <p class="lead">
          Interview Genie helps candidates match job descriptions, practice realistic questions,
          and get real-time structured answers whether you speak or type.
        </p>
        <div class="cta-row">
          <RouterLink class="btn btn-primary" to="/app">Preparing for an interview? Start the full process →</RouterLink>
          <a class="btn btn-secondary" href="#features">Learn more</a>
        </div>
      </section>

      <section id="features">
        <h2>What you get</h2>
        <div class="grid">
          <div class="card">
            <h3>Prepare</h3>
            <p>Create a role with job title and description, attach your CV (PDF/DOCX/TXT). Everything is stored so you can reuse it across mock and live sessions.</p>
          </div>
          <div class="card">
            <h3>ATS insight</h3>
            <p>See how well your CV aligns with the posting — strengths, gaps, and a simple fit score before you apply.</p>
          </div>
          <div class="card">
            <h3>Mock interview</h3>
            <p>Technical or HR-style questions tailored to the job. Answer in writing or by voice, then request structured feedback.</p>
          </div>
          <div class="card">
            <h3>Live interview</h3>
            <p>Ask out loud or type; your question is transcribed and answered in <strong>Situation · Task · Action · Result</strong> format, streamed as it’s generated.</p>
          </div>
          <div class="card">
            <h3>History &amp; attempts</h3>
            <p>Review past Q&amp;A, compare practice runs, and track multi-question attempts with scores and summaries.</p>
          </div>
          <div class="card">
            <h3>Desktop app</h3>
            <p>Prefer a native app? Use the Electron client from the repo — same flows, pointed at this API (<code>/app</code> uses the browser).</p>
          </div>
        </div>
      </section>

      <section id="how">
        <h2>How the full process works</h2>
        <ol class="steps" style="padding-left: 0; max-width: 42rem">
          <li><strong>Prepare</strong> — Add your target role, paste the job description, upload your CV.</li>
          <li><strong>ATS</strong> — Run analysis to understand fit and keywords.</li>
          <li><strong>Mock</strong> — Practice questions; get feedback on your answers.</li>
          <li><strong>Live</strong> — Use voice or text during a real interview prep session; STAR answers stream back.</li>
          <li><strong>History</strong> — Revisit everything you saved under your topics.</li>
        </ol>
        <div class="highlight-box">
          <h2>Ready?</h2>
          <p style="color: var(--muted); margin-bottom: 1.5rem">
            No separate login required for the demo flow — we use a default workspace. Open the web app and follow the numbered tabs.
          </p>
          <RouterLink class="btn btn-primary" to="/app">Go to interview workspace →</RouterLink>
        </div>
      </section>

      <footer>
        <p>Interview Genie API · <a href="/health">/health</a> · <a href="/docs">Swagger</a></p>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { RouterLink } from "vue-router";
</script>

<style>
.landing {
  --bg: #070a12;
  --surface: #0f1420;
  --card: #141b2d;
  --border: rgba(255, 255, 255, 0.08);
  --text: #e8edf7;
  --muted: #94a3b8;
  --accent: #6366f1;
  --accent2: #22d3ee;
  min-height: 100vh;
  font-family: "DM Sans", system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}
.landing * {
  box-sizing: border-box;
}
.landing .gradient {
  position: fixed;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99, 102, 241, 0.25), transparent),
    radial-gradient(ellipse 60% 40% at 100% 0%, rgba(34, 211, 238, 0.12), transparent);
  z-index: 0;
}
.landing .wrap {
  position: relative;
  z-index: 1;
  max-width: 1080px;
  margin: 0 auto;
  padding: 0 1.25rem;
}
.landing header {
  padding: 1rem 0;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.landing .logo {
  font-weight: 700;
  font-size: 1.15rem;
  letter-spacing: -0.02em;
}
.landing .logo span {
  color: var(--accent2);
}
.landing nav a {
  color: var(--muted);
  text-decoration: none;
  margin-left: 1.25rem;
  font-size: 0.95rem;
}
.landing nav a:hover {
  color: var(--text);
}
.landing .hero {
  padding: 3.5rem 0 2rem;
  text-align: center;
}
.landing .hero h1 {
  font-size: clamp(2rem, 5vw, 2.85rem);
  line-height: 1.15;
  margin: 0 0 1rem;
  font-weight: 700;
  letter-spacing: -0.03em;
}
.landing .hero p.lead {
  font-size: 1.2rem;
  color: var(--muted);
  max-width: 36rem;
  margin: 0 auto 2rem;
}
.landing .cta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: center;
  align-items: center;
}
.landing .btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.9rem 1.6rem;
  border-radius: 12px;
  font-weight: 600;
  font-size: 1.05rem;
  text-decoration: none;
  border: none;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}
.landing .btn:hover {
  transform: translateY(-1px);
}
.landing .btn-primary {
  background: linear-gradient(135deg, var(--accent), #818cf8);
  color: #fff;
  box-shadow: 0 8px 32px rgba(99, 102, 241, 0.35);
}
.landing .btn-secondary {
  background: var(--card);
  color: var(--text);
  border: 1px solid var(--border);
}
.landing .pill {
  display: inline-block;
  padding: 0.35rem 0.85rem;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.15);
  color: #a5b4fc;
  font-size: 0.8rem;
  font-weight: 600;
  margin-bottom: 1rem;
}
.landing section {
  padding: 2.5rem 0;
}
.landing section h2 {
  font-size: 1.5rem;
  margin: 0 0 1.25rem;
  letter-spacing: -0.02em;
}
.landing .grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1.25rem;
}
.landing .card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 1.5rem;
}
.landing .card h3 {
  margin: 0 0 0.5rem;
  font-size: 1.1rem;
  color: #c7d2fe;
}
.landing .card p {
  margin: 0;
  color: var(--muted);
  font-size: 0.95rem;
}
.landing .steps {
  counter-reset: step;
}
.landing .steps li {
  list-style: none;
  position: relative;
  padding-left: 3rem;
  margin-bottom: 1.5rem;
  color: var(--muted);
}
.landing .steps li::before {
  counter-increment: step;
  content: counter(step);
  position: absolute;
  left: 0;
  top: 0;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-weight: 700;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
.landing .steps strong {
  color: var(--text);
}
.landing .highlight-box {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(34, 211, 238, 0.08));
  border: 1px solid rgba(99, 102, 241, 0.25);
  border-radius: 16px;
  padding: 2rem;
  text-align: center;
  margin-top: 1rem;
}
.landing .highlight-box h2 {
  margin-top: 0;
}
.landing footer {
  padding: 2rem 0 3rem;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 0.9rem;
  text-align: center;
}
.landing footer a {
  color: var(--accent2);
}
.landing code {
  background: rgba(255, 255, 255, 0.06);
  padding: 0.15rem 0.45rem;
  border-radius: 6px;
  font-size: 0.85em;
}
</style>
