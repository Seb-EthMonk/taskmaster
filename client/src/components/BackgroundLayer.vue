<template>
  <div
    v-if="settingsStore.hasBackgroundImage"
    class="background-layer"
    :class="{ loaded: imageLoaded, error: imageError }"
  >
    <div
      class="background-image"
      :style="backgroundImageStyle"
      @load="handleImageLoad"
    ></div>
    <div class="background-overlay" :style="overlayStyle"></div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useSettingsStore } from '../stores/settings';

const settingsStore = useSettingsStore();
const imageLoaded = ref(false);
const imageError = ref(false);

const backgroundImageStyle = computed(() => ({
  backgroundImage: `url(${settingsStore.backgroundImage})`,
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
  backgroundAttachment: 'fixed',
}));

const overlayStyle = computed(() => {
  // brightness controls how much of the dark overlay is applied
  // 1.0 = full overlay (current behaviour)
  // 0.2 = almost no overlay (very colourful)
  // 1.5 = extra dark overlay
  const overlayOpacity = (1 - settingsStore.backgroundOpacity) * settingsStore.backgroundBrightness;
  return {
    backgroundColor: '#0a0a0f',
    opacity: Math.min(1, Math.max(0, overlayOpacity)),
  };
});

// Watch for image path changes to reset load state
watch(
  () => settingsStore.backgroundImage,
  () => {
    imageLoaded.value = false;
    imageError.value = false;

    // Preload image to check if it loads successfully
    if (settingsStore.backgroundImage) {
      const img = new Image();
      img.onload = () => {
        imageLoaded.value = true;
        imageError.value = false;
      };
      img.onerror = () => {
        imageLoaded.value = false;
        imageError.value = true;
        console.error('Failed to load background image:', settingsStore.backgroundImage);
      };
      img.src = settingsStore.backgroundImage;
    }
  },
  { immediate: true }
);

function handleImageLoad() {
  imageLoaded.value = true;
  imageError.value = false;
}
</script>

<style scoped>
.background-layer {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
}

.background-image {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 0.5s ease;
}

.background-layer.loaded .background-image {
  opacity: 1;
}

.background-overlay {
  position: absolute;
  inset: 0;
  transition: opacity 0.3s ease;
}

/* When there's an error, hide the background layer completely */
.background-layer.error {
  display: none;
}
</style>
