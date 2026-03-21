import { createRouter, createWebHistory } from "vue-router";
import LandingView from "../views/LandingView.vue";
import WorkspaceView from "../views/WorkspaceView.vue";

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "landing", component: LandingView },
    { path: "/app", name: "workspace", component: WorkspaceView },
  ],
});
