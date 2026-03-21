<template>
  <div ref="mountEl" class="workspace-page"></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from "vue";
import workspaceHtml from "../assets/workspace-body.html?raw";
import "../../../static/workspace.css";

const mountEl = ref(null);

function injectConfig(root) {
  if (document.getElementById("interviewgenie-backend-config")) return;
  const cfg = document.createElement("script");
  cfg.id = "interviewgenie-backend-config";
  cfg.type = "application/json";
  cfg.textContent = "{}";
  root.appendChild(cfg);
}

function loadWorkspaceScript() {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-ig-workspace="1"]');
    if (existing) {
      existing.remove();
    }
    const s = document.createElement("script");
    s.src = "/static/workspace.js";
    s.async = false;
    s.dataset.igWorkspace = "1";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load workspace.js"));
    document.body.appendChild(s);
  });
}

onMounted(async () => {
  const el = mountEl.value;
  if (!el) return;
  el.innerHTML = workspaceHtml;
  await nextTick();
  const root = el.querySelector(".workspace-root");
  if (root) injectConfig(root);
  try {
    await loadWorkspaceScript();
  } catch (e) {
    console.error(e);
  }
});

onBeforeUnmount(() => {
  window.__IG_WORKSPACE_INIT__ = false;
  document.querySelectorAll('script[data-ig-workspace="1"]').forEach((n) => n.remove());
});
</script>

<style scoped>
.workspace-page {
  min-height: 100vh;
}
</style>
