<template>
  <div class="settings-view">
    <div class="settings-header">
      <h1>Settings</h1>
      <p class="subtitle">Customize your TaskMaster dashboard</p>
    </div>

    <div class="settings-sections">
      <!-- Background Image Section -->
      <section class="settings-section">
        <div class="section-header">
          <span class="section-icon">🖼️</span>
          <div class="section-title">
            <h2>Background Image</h2>
            <p class="section-description">Choose a built-in background or go without</p>
          </div>
        </div>

        <div class="section-content">
          <!-- Current Background Preview -->
          <div class="background-preview" :class="{ 'has-image': settingsStore.hasBackgroundImage }">
            <div
              v-if="settingsStore.hasBackgroundImage"
              class="preview-image"
              :style="{ backgroundImage: `url(${settingsStore.backgroundImage})` }"
            >
              <div class="preview-overlay" :style="{ opacity: settingsStore.backgroundOpacity }"></div>
            </div>
            <div v-else class="preview-placeholder">
              <span class="placeholder-icon">🎨</span>
              <span class="placeholder-text">No background selected</span>
            </div>
            <div class="preview-label">Preview</div>
          </div>

          <!-- Background Gallery -->
          <div class="form-group">
            <label>Choose Background</label>
            <div class="bg-gallery">
              <button
                class="bg-thumb"
                :class="{ active: !settingsStore.backgroundImage }"
                @click="selectBackground('')"
                title="No background"
              >
                <div class="bg-thumb-none">❌</div>
                <span class="bg-thumb-label">None</span>
              </button>
              <button
                v-for="bg in builtInBackgrounds"
                :key="bg.path"
                class="bg-thumb"
                :class="{ active: settingsStore.backgroundImage === bg.path }"
                @click="selectBackground(bg.path)"
                :title="bg.name"
              >
                <img :src="bg.path" :alt="bg.name" loading="lazy" />
                <span class="bg-thumb-label">{{ bg.name }}</span>
              </button>
            </div>
          </div>

          <!-- Opacity Slider -->
          <div class="form-group">
            <label for="bg-opacity">
              Overlay Opacity
              <span class="opacity-value">{{ Math.round(settingsStore.backgroundOpacity * 100) }}%</span>
            </label>
            <input
              id="bg-opacity"
              type="range"
              min="5"
              max="100"
              :value="settingsStore.backgroundOpacity * 100"
              class="opacity-slider"
              @input="handleOpacityChange"
            />
            <div class="slider-labels">
              <span>More visible</span>
              <span>Subtle</span>
            </div>
            <small class="help-text">
              Adjust how prominent the background appears. Lower opacity makes text more readable.
            </small>
          </div>

          <!-- Brightness Slider -->
          <div class="form-group">
            <label for="bg-brightness">
              Background Brightness
              <span class="brightness-value">{{ Math.round(settingsStore.backgroundBrightness * 100) }}%</span>
            </label>
            <input
              id="bg-brightness"
              type="range"
              min="20"
              max="150"
              :value="settingsStore.backgroundBrightness * 100"
              class="brightness-slider"
              @input="handleBrightnessChange"
            />
            <div class="slider-labels">
              <span>Dim</span>
              <span>Bright</span>
            </div>
            <small class="help-text">
              Adjust the brightness of the background image itself. Higher values show more color and detail.
            </small>
          </div>

          <!-- Enable/Disable Toggle -->
          <div class="form-group toggle-group">
            <label class="toggle-label">
              <span>Enable Background</span>
              <input
                type="checkbox"
                :checked="settingsStore.backgroundEnabled"
                :disabled="!settingsStore.backgroundImage"
                @change="handleToggleChange"
              />
            </label>
          </div>
        </div>
      </section>

      <!-- Energy System Section -->
      <section class="settings-section">
        <div class="section-header">
          <span class="section-icon">⚡</span>
          <div class="section-title">
            <h2>Energy System</h2>
            <p class="section-description">Enable energy management to control task execution</p>
          </div>
        </div>

        <div class="section-content">
          <!-- Enable/Disable Toggle -->
          <div class="form-group toggle-group">
            <label class="toggle-label">
              <span>Enable Energy System</span>
              <input
                type="checkbox"
                :checked="energyStore.isEnabled"
                @change="toggleEnergySystem"
              />
            </label>
            <small class="help-text">
              When enabled, each task consumes energy.
            </small>
          </div>

          <!-- Energy Configuration (only when enabled) -->
          <div v-if="energyStore.isEnabled" class="energy-config">
            <!-- Max Energy Slider -->
            <div class="form-group">
              <label for="max-energy">
                Maximum Energy Pool
                <span class="slider-value">{{ energyStore.maxEnergy }}</span>
              </label>
              <input
                id="max-energy"
                type="range"
                min="50"
                max="500"
                step="10"
                :value="energyStore.maxEnergy"
                class="energy-slider"
                @input="handleMaxEnergyChange"
              />
              <div class="slider-labels">
                <span>50 (Fast)</span>
                <span>500 (~50k tokens)</span>
              </div>
              <small class="help-text">
                Set your total energy pool. Higher values = more tasks before refueling.
              </small>
            </div>

            <!-- Warning Threshold -->
            <div class="form-group">
              <label for="threshold">
                Warning Threshold (%)
                <span class="slider-value">{{ energyStore.threshold }}%</span>
              </label>
              <input
                id="threshold"
                type="range"
                min="5"
                max="50"
                :value="energyStore.threshold"
                class="energy-slider"
                @input="handleThresholdChange"
              />
              <small class="help-text">
                Energy bar turns amber when below this percentage.
              </small>
            </div>

            <!-- Current Energy Display -->
            <div class="current-energy-display">
              <div class="energy-preview-bar">
                <div
                  class="energy-preview-fill"
                  :style="{ width: `${energyStore.energyPercentage}%`, backgroundColor: energyStore.energyBarColor }"
                ></div>
              </div>
              <span class="energy-preview-text">
                Current: {{ energyStore.currentEnergy }}/{{ energyStore.maxEnergy }} ({{ energyStore.energyPercentage }}%)
              </span>
            </div>

            <!-- Set Energy to 50% Button (for testing regeneration) -->
            <div class="form-group">
              <label>Test Energy Level</label>
              <div class="energy-test-buttons">
                <button class="btn-secondary" @click="setEnergyTo50Percent">
                  Set Energy to 50%
                </button>
                <button class="btn-secondary btn-zero" @click="setEnergyToZero">
                  Set Energy to 0
                </button>
              </div>
              <small class="help-text">
                Sets energy to test different states.
              </small>
            </div>

            <!-- Feed Items -->
            <div class="feed-section">
              <h3>Feed Your TaskMaster</h3>
              <div class="feed-grid">
                <button
                  v-for="item in FEED_ITEMS"
                  :key="item.id"
                  class="feed-item-btn"
                  @click="feedEnergy(item.id)"
                >
                  <span class="feed-emoji">{{ item.emoji }}</span>
                  <span class="feed-name">{{ item.name }}</span>
                  <span class="feed-amount">+{{ item.amount }}</span>
                </button>
              </div>
            </div>

            <!-- Receipts -->
            <div v-if="energyStore.receipts.length > 0" class="receipts-section">
              <h3>Recent Energy Activity</h3>
              <div class="receipts-list">
                <div
                  v-for="receipt in recentReceipts"
                  :key="receipt.id"
                  class="receipt-item"
                  :class="receipt.action"
                >
                  <span class="receipt-time">{{ formatTime(receipt.timestamp) }}</span>
                  <span class="receipt-desc">{{ receipt.description }}</span>
                  <span class="receipt-amount" :class="{ 'positive': receipt.amount > 0, 'negative': receipt.amount < 0 }">
                    {{ receipt.amount > 0 ? '+' : '' }}{{ receipt.amount }}
                  </span>
                </div>
              </div>
              <button class="clear-receipts-btn" @click="energyStore.clearReceipts">
                Clear History
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- About Section -->
      <section class="settings-section">
        <div class="section-header">
          <span class="section-icon">ℹ️</span>
          <div class="section-title">
            <h2>About</h2>
            <p class="section-description">TaskMaster version information</p>
          </div>
        </div>

        <div class="section-content">
          <div class="about-info">
            <div class="info-row">
              <span class="info-label">Version</span>
              <span class="info-value">2.6.0 Seraphin</span>
            </div>
            <div class="info-row">
              <span class="info-label">Build</span>
              <span class="info-value">{{ buildDate }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useSettingsStore } from '../stores/settings';
import { useEnergyStore, FEED_ITEMS } from '../stores/energy';


const settingsStore = useSettingsStore();
const energyStore = useEnergyStore();
const buildDate = ref(new Date().toLocaleDateString());

// Computed
const recentReceipts = computed(() => {
  return energyStore.receipts.slice(-10).reverse(); // Last 10, newest first
});

// Energy system handlers
function toggleEnergySystem(event: Event) {
  const target = event.target as HTMLInputElement;
  energyStore.toggleEnergySystem(target.checked);
}

function handleMaxEnergyChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const value = parseInt(target.value, 10);
  energyStore.setMaxEnergy(value);
}

function handleThresholdChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const value = parseInt(target.value, 10);
  energyStore.setThreshold(value);
}

function feedEnergy(feedItemId: string) {
  energyStore.feedEnergy(feedItemId);
}

function setEnergyTo50Percent() {
  const targetEnergy = Math.floor(energyStore.maxEnergy * 0.5);
  energyStore.setCurrentEnergy(targetEnergy);
}

function setEnergyToZero() {
  energyStore.setCurrentEnergy(0);
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Built-in background images (served from /backgrounds/ via public folder)
const builtInBackgrounds = [
  { name: '01', path: '/backgrounds/background01.png' },
  { name: '02', path: '/backgrounds/background02.png' },
  { name: '03', path: '/backgrounds/background03.png' },
  { name: '04', path: '/backgrounds/background04.png' },
  { name: '05', path: '/backgrounds/background05.png' },
  { name: '06', path: '/backgrounds/background06.png' },
  { name: '07', path: '/backgrounds/background07.png' },
  { name: '08', path: '/backgrounds/background08.png' },
  { name: '09', path: '/backgrounds/background09.png' },
  { name: '10', path: '/backgrounds/background10.png' },
  { name: '11', path: '/backgrounds/background11.png' },
  { name: '12', path: '/backgrounds/background12.png' },
  { name: '13', path: '/backgrounds/background13.png' },
  { name: '14', path: '/backgrounds/background14.png' },
];

function selectBackground(path: string) {
  if (!path) {
    settingsStore.clearBackground();
  } else {
    settingsStore.setBackgroundImage(path);
  }
}

function handleOpacityChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const value = parseInt(target.value, 10);
  settingsStore.setBackgroundOpacity(value / 100);
}

function handleBrightnessChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const value = parseInt(target.value, 10);
  settingsStore.setBackgroundBrightness(value / 100);
}

function handleToggleChange(event: Event) {
  const target = event.target as HTMLInputElement;
  settingsStore.toggleBackground(target.checked);
}
</script>

<style scoped>
.settings-view {
  padding: 2rem;
  max-width: 800px;
}

.settings-header {
  margin-bottom: 2rem;
}

.settings-header h1 {
  font-size: 2rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.subtitle {
  color: var(--text-secondary);
  font-size: 1rem;
}

.settings-sections {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.settings-section {
  background-color: var(--bg-surface);
  border-radius: 0.75rem;
  border: 1px solid var(--bg-highlight);
  overflow: hidden;
}

.section-header {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 1.25rem;
  border-bottom: 1px solid var(--bg-highlight);
}

.section-icon {
  font-size: 1.5rem;
  line-height: 1;
}

.section-title h2 {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.25rem;
}

.section-description {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.section-content {
  padding: 1.5rem;
}

/* Background Preview */
.background-preview {
  width: 100%;
  height: 200px;
  border-radius: 0.5rem;
  background-color: var(--bg-primary);
  border: 2px dashed var(--bg-highlight);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1.5rem;
  position: relative;
  overflow: hidden;
}

.background-preview.has-image {
  border-style: solid;
  border-color: var(--color-primary);
}

.preview-image {
  width: 100%;
  height: 100%;
  background-size: cover;
  background-position: center;
  position: relative;
}

.preview-overlay {
  position: absolute;
  inset: 0;
  background-color: var(--bg-primary);
}

.preview-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-secondary);
}

.placeholder-icon {
  font-size: 3rem;
  opacity: 0.5;
}

.placeholder-text {
  font-size: 0.9375rem;
}

.preview-label {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  background-color: rgba(0, 0, 0, 0.7);
  color: var(--text-primary);
  padding: 0.25rem 0.75rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

/* Form Elements */
.form-group {
  margin-bottom: 1.5rem;
}

.form-group label {
  display: block;
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.path-input-group {
  display: flex;
  gap: 0.5rem;
}

.path-input {
  flex: 1;
  padding: 0.625rem 0.875rem;
  background-color: var(--bg-highlight);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.5rem;
  color: var(--text-primary);
  font-size: 0.9375rem;
  outline: none;
  transition: border-color 0.2s ease;
}

.path-input:focus {
  border-color: var(--color-primary);
}

.path-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.5;
}

/* Background Gallery */
.bg-gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.bg-thumb {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem;
  background: var(--bg-highlight);
  border: 2px solid transparent;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.bg-thumb:hover {
  border-color: var(--color-primary);
  transform: translateY(-2px);
}

.bg-thumb.active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.3);
}

.bg-thumb img {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  border-radius: 0.25rem;
  display: block;
}

.bg-thumb-none {
  width: 100%;
  aspect-ratio: 16 / 10;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-surface);
  border-radius: 0.25rem;
  font-size: 1.25rem;
}

.bg-thumb-label {
  font-size: 0.6875rem;
  color: var(--text-secondary);
  text-align: center;
}

.help-text {
  display: block;
  margin-top: 0.375rem;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.error-message {
  padding: 0.75rem;
  background-color: rgba(239, 68, 68, 0.1);
  border: 1px solid var(--color-error);
  border-radius: 0.5rem;
  color: var(--color-error);
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

/* Opacity Slider */
.opacity-value {
  float: right;
  color: var(--color-primary);
  font-weight: 600;
}

.opacity-slider,
.brightness-slider {
  width: 100%;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--bg-highlight);
  border-radius: 3px;
  outline: none;
  cursor: pointer;
}

.opacity-slider::-webkit-slider-thumb,
.brightness-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  background: var(--color-primary);
  border-radius: 50%;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.opacity-slider::-webkit-slider-thumb:hover,
.brightness-slider::-webkit-slider-thumb:hover {
  background: var(--color-primary-hover);
}

.opacity-slider::-moz-range-thumb,
.brightness-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  background: var(--color-primary);
  border-radius: 50%;
  cursor: pointer;
  border: none;
}

/* Brightness Slider */
.brightness-value {
  float: right;
  color: var(--color-primary);
  font-weight: 600;
}

.slider-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 0.375rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

/* Toggle */
.toggle-group {
  margin-bottom: 1rem;
}

.toggle-label {
  display: flex !important;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}

.toggle-label input[type="checkbox"] {
  width: 48px;
  height: 24px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--bg-highlight);
  border-radius: 12px;
  position: relative;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.toggle-label input[type="checkbox"]:checked {
  background: var(--color-primary);
}

.toggle-label input[type="checkbox"]::after {
  content: '';
  position: absolute;
  width: 20px;
  height: 20px;
  background: white;
  border-radius: 50%;
  top: 2px;
  left: 2px;
  transition: transform 0.2s ease;
}

.toggle-label input[type="checkbox"]:checked::after {
  transform: translateX(24px);
}

.toggle-label input[type="checkbox"]:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Buttons */
.action-buttons {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  padding-top: 1rem;
  border-top: 1px solid var(--bg-highlight);
}

.btn-primary {
  padding: 0.625rem 1.25rem;
  background-color: var(--color-primary);
  color: white;
  border: none;
  border-radius: 0.5rem;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.btn-primary:hover:not(:disabled) {
  background-color: var(--color-primary-hover);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 0.625rem 1.25rem;
  background-color: var(--bg-highlight);
  color: var(--text-primary);
  border: none;
  border-radius: 0.5rem;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.btn-secondary:hover:not(:disabled) {
  background-color: #2a2a36;
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* About Section */
.about-info {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.info-row {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--bg-highlight);
}

.info-row:last-child {
  border-bottom: none;
}

.info-label {
  color: var(--text-secondary);
  font-size: 0.9375rem;
}

.info-value {
  color: var(--text-primary);
  font-size: 0.9375rem;
  font-weight: 500;
}

.slider-value {
  float: right;
  color: var(--color-primary);
  font-weight: 600;
}

/* Energy System Styles */
.energy-test-buttons {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.energy-test-buttons .btn-zero {
  background-color: rgba(239, 68, 68, 0.1);
  border: 1px solid var(--color-error);
  color: var(--color-error);
}

.energy-test-buttons .btn-zero:hover {
  background-color: var(--color-error);
  color: white;
}

.energy-config {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--bg-highlight);
}

.energy-slider {
  width: 100%;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--bg-highlight);
  border-radius: 3px;
  outline: none;
  cursor: pointer;
}

.energy-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  background: var(--color-primary);
  border-radius: 50%;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.energy-slider::-webkit-slider-thumb:hover {
  background: var(--color-primary-hover);
}

.energy-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  background: var(--color-primary);
  border-radius: 50%;
  cursor: pointer;
  border: none;
}

.current-energy-display {
  background-color: var(--bg-highlight);
  padding: 1rem;
  border-radius: 0.5rem;
  margin-bottom: 1.5rem;
}

.energy-preview-bar {
  width: 100%;
  height: 12px;
  background-color: var(--bg-surface);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.energy-preview-fill {
  height: 100%;
  border-radius: 6px;
  transition: width 0.3s ease, background-color 0.3s ease;
}

.energy-preview-text {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

/* Feed Section */
.feed-section {
  margin-top: 1.5rem;
}

.feed-section h3 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.75rem;
}

.feed-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 0.5rem;
}

.feed-item-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.75rem;
  background-color: var(--bg-highlight);
  border: 1px solid transparent;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.feed-item-btn:hover {
  background-color: var(--bg-surface);
  border-color: var(--color-primary);
  transform: translateY(-2px);
}

.feed-emoji {
  font-size: 1.5rem;
}

.feed-name {
  font-size: 0.75rem;
  color: var(--text-primary);
  font-weight: 500;
}

.feed-amount {
  font-size: 0.75rem;
  color: #22c55e;
  font-weight: 600;
}

/* Receipts Section */
.receipts-section {
  margin-top: 1.5rem;
}

.receipts-section h3 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.75rem;
}

.receipts-list {
  background-color: var(--bg-highlight);
  border-radius: 0.5rem;
  overflow: hidden;
  max-height: 200px;
  overflow-y: auto;
}

.receipt-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0.875rem;
  border-bottom: 1px solid var(--bg-surface);
  font-size: 0.8125rem;
}

.receipt-item:last-child {
  border-bottom: none;
}

.receipt-time {
  color: var(--text-secondary);
  min-width: 50px;
  font-size: 0.75rem;
}

.receipt-desc {
  flex: 1;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.receipt-amount {
  font-weight: 600;
  font-family: 'JetBrains Mono', monospace;
}

.receipt-amount.positive {
  color: #22c55e;
}

.receipt-amount.negative {
  color: #ef4444;
}

.clear-receipts-btn {
  margin-top: 0.75rem;
  padding: 0.5rem 1rem;
  background-color: transparent;
  border: 1px solid var(--color-error);
  border-radius: 0.375rem;
  color: var(--color-error);
  font-size: 0.8125rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.clear-receipts-btn:hover {
  background-color: var(--color-error);
  color: white;
}

/* Responsive */
@media (max-width: 640px) {
  .settings-view {
    padding: 1rem;
  }

  .settings-header h1 {
    font-size: 1.5rem;
  }

  .bg-gallery {
    grid-template-columns: repeat(3, 1fr);
  }

  .feed-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .form-row {
    grid-template-columns: 1fr;
  }

  .port-info {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .port-number {
    font-size: 1.5rem;
  }
}
</style>
