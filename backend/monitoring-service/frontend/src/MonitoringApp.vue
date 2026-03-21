<template>
  <div class="monitor-vue-root" v-html="shellMarkup"></div>
</template>

<script setup>
import { onMounted } from "vue";
import shellMarkup from "./shell.html?raw";
import { bootstrapAdminUi } from "./monitorLogic.js";
import "./assets/admin.css";

onMounted(() => {
  bootstrapAdminUi();
});
</script>
