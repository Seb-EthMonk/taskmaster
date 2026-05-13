<template>
  <div class="tm-chat-overlay">
    <!-- Invisible backdrop — clicking outside closes the panel -->
    <div v-if="isOpen" class="tm-chat-backdrop" @click="close" />

    <!-- Chat panel: stays in DOM after first open so TMChat instance persists -->
    <div v-if="chatLoaded" class="tm-chat-panel" :class="{ 'tm-chat-panel--open': isOpen }">
      <div id="tm-chat-embed" class="tm-chat-embed-container" />
    </div>

    <!-- Floating wand bubble -->
    <button
      class="tm-chat-bubble"
      :class="{ 'tm-chat-bubble--active': isOpen }"
      @click="toggle"
      :title="isOpen ? 'Close chat' : 'Open TM Chat'"
    >🪄</button>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';

declare global {
  interface Window {
    TMChat?: {
      init: (config: Record<string, unknown>) => void;
    };
  }
}

const isOpen = ref(false);
const chatLoaded = ref(false);
let initialized = false;

function toggle() {
  isOpen.value ? close() : open();
}

async function open() {
  isOpen.value = true;
  if (!initialized) {
    chatLoaded.value = true;
    await nextTick();
    loadChat();
  }
}

function close() {
  isOpen.value = false;
}

function loadChat() {
  if (!document.querySelector('#tm-chat-overlay-css')) {
    const link = document.createElement('link');
    link.id = 'tm-chat-overlay-css';
    link.rel = 'stylesheet';
    link.href = '/chatapp/chat.css';
    document.head.appendChild(link);
  }

  const script = document.createElement('script');
  script.src = '/chatapp/chat.js';
  script.onload = () => {
    initialized = true;
    window.TMChat?.init({
      container: '#tm-chat-embed',
      serverUrl: window.location.origin,
      defaultModel: 'kimi',
      position: 'panel',
    });
  };
  document.head.appendChild(script);
}
</script>

<style scoped>
/* Root overlay — no pointer events so it doesn't block the app */
.tm-chat-overlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 500;
}

/* Re-enable pointer events on all children */
.tm-chat-overlay > * {
  pointer-events: auto;
}

/* Transparent full-screen backdrop to capture outside clicks */
.tm-chat-backdrop {
  position: fixed;
  inset: 0;
  z-index: 498;
  background: transparent;
  cursor: default;
}

/* Chat panel */
.tm-chat-panel {
  position: fixed;
  bottom: 88px;
  right: 24px;
  width: 420px;
  height: 600px;
  background: #12121a;
  border: 1px solid #1a1a24;
  border-radius: 12px;
  overflow: hidden;
  z-index: 499;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(99, 102, 241, 0.15);
  display: none;
  flex-direction: column;
  transform-origin: bottom right;
  animation: none;
}

.tm-chat-panel--open {
  display: flex;
  animation: panel-in 0.18s ease-out;
}

@keyframes panel-in {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* Floating wand bubble */
.tm-chat-bubble {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #6366f1;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.45);
  transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.tm-chat-bubble:hover {
  transform: scale(1.1);
  box-shadow: 0 8px 30px rgba(99, 102, 241, 0.65);
}

.tm-chat-bubble--active {
  background: #4f46e5;
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.6);
}

/* Embedded chat container */
.tm-chat-embed-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* Ensure chat app fills container */
.tm-chat-embed-container :deep(.tm-chat-container) {
  height: 100% !important;
  width: 100% !important;
}
</style>
