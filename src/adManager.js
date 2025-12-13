/**
 * AdManager - Centralized ad management for Learn Shoot
 * 
 * Handles all ad lifecycle operations including:
 * - Rewarded video ads (revive, extra life)
 * - Interstitial ads (wave transitions)
 * - Banner ads (start screen)
 * 
 * Uses mock ads for development, can be swapped with Google AdSense H5 Games API
 */

// Ad configuration
const AD_CONFIG = {
  // Set to true when Google AdSense is approved and configured
  useRealAds: false,

  // Mock ad durations (in ms)
  mockRewardedDuration: 3000,  // 3 seconds for testing
  mockInterstitialDuration: 2000,  // 2 seconds for testing

  // Ad limits per session
  maxRevives: 1,
  maxExtraLives: 1,
  waveAdInterval: 3,  // Show interstitial every N waves

  // Revive requires watching 2 ads
  reviveAdCount: 2,

  // AdSense Publisher ID
  publisherId: 'ca-pub-2673888149354227'
};

// Session tracking
let adSession = {
  revivesUsed: 0,
  extraLivesUsed: 0,
  adsWatched: 0,
  currentReviveAdCount: 0
};

// Callbacks storage
let currentAdCallback = null;
let currentAdType = null;

/**
 * Initialize the ad system
 */
export function initAds() {
  console.log(`[AdManager] Initialized in ${AD_CONFIG.useRealAds ? 'production' : 'mock'} mode`);

  if (AD_CONFIG.useRealAds) {
    // TODO: Initialize Google AdSense H5 Games API
    // This requires beta approval from Google
    initGoogleAds();
  }

  resetSessionLimits();
}

/**
 * Reset session limits (call on new game start)
 */
export function resetSessionLimits() {
  adSession = {
    revivesUsed: 0,
    extraLivesUsed: 0,
    adsWatched: 0,
    currentReviveAdCount: 0
  };
  console.log('[AdManager] Session limits reset');
}

/**
 * Check if a specific ad type can be shown
 */
export function canShowAd(type) {
  switch (type) {
    case 'revive':
      return adSession.revivesUsed < AD_CONFIG.maxRevives;
    case 'extraLife':
      return adSession.extraLivesUsed < AD_CONFIG.maxExtraLives;
    case 'interstitial':
      return true;  // No limit on interstitials
    default:
      return false;
  }
}

/**
 * Check if wave should trigger interstitial ad
 */
export function shouldShowWaveAd(waveNumber) {
  return waveNumber > 1 && waveNumber % AD_CONFIG.waveAdInterval === 0;
}

/**
 * Get the number of ads required for revive
 */
export function getReviveAdCount() {
  return AD_CONFIG.reviveAdCount;
}

/**
 * Get current revive ad progress
 */
export function getCurrentReviveProgress() {
  return adSession.currentReviveAdCount;
}

/**
 * Show a rewarded video ad
 * @param {string} type - 'revive' or 'extraLife'
 * @param {Function} onComplete - Called when ad completes successfully
 * @param {Function} onCancel - Called if ad is cancelled/fails
 */
export function showRewardedAd(type, onComplete, onCancel) {
  if (!canShowAd(type)) {
    console.log(`[AdManager] Cannot show ${type} ad - limit reached`);
    if (onCancel) onCancel();
    return;
  }

  console.log(`[AdManager] Showing rewarded ad: ${type}`);
  currentAdType = type;
  currentAdCallback = onComplete;

  if (AD_CONFIG.useRealAds) {
    showGoogleRewardedAd(type, onComplete, onCancel);
  } else {
    showMockRewardedAd(type, onComplete, onCancel);
  }
}

/**
 * Show an interstitial ad
 * @param {Function} onComplete - Called when ad finishes
 */
export function showInterstitialAd(onComplete) {
  console.log('[AdManager] Showing interstitial ad');

  if (AD_CONFIG.useRealAds) {
    showGoogleInterstitialAd(onComplete);
  } else {
    showMockInterstitialAd(onComplete);
  }
}

// ==================== MOCK AD SYSTEM ====================

function showMockRewardedAd(type, onComplete, onCancel) {
  const overlay = createAdOverlay('rewarded', type);
  document.body.appendChild(overlay);

  let timeLeft = Math.ceil(AD_CONFIG.mockRewardedDuration / 1000);
  const timerEl = overlay.querySelector('.ad-timer');
  const progressEl = overlay.querySelector('.ad-progress-bar');

  // Update timer countdown
  const timerInterval = setInterval(() => {
    timeLeft--;
    if (timerEl) timerEl.textContent = `${timeLeft}s`;
  }, 1000);

  // Progress bar animation
  progressEl.style.transition = `width ${AD_CONFIG.mockRewardedDuration}ms linear`;
  setTimeout(() => progressEl.style.width = '100%', 50);

  // Complete after duration
  setTimeout(() => {
    clearInterval(timerInterval);
    overlay.remove();
    adSession.adsWatched++;

    if (type === 'revive') {
      adSession.currentReviveAdCount++;
      console.log(`[AdManager] Revive ad ${adSession.currentReviveAdCount}/${AD_CONFIG.reviveAdCount} completed`);

      if (adSession.currentReviveAdCount >= AD_CONFIG.reviveAdCount) {
        adSession.revivesUsed++;
        adSession.currentReviveAdCount = 0;
        console.log('[AdManager] All revive ads completed, granting revive');
        if (onComplete) onComplete();
      } else {
        // Need to watch more ads - callback with partial progress
        if (onComplete) onComplete({ partial: true, current: adSession.currentReviveAdCount, total: AD_CONFIG.reviveAdCount });
      }
    } else if (type === 'extraLife') {
      adSession.extraLivesUsed++;
      console.log('[AdManager] Extra life ad completed, granting reward');
      if (onComplete) onComplete();
    }
  }, AD_CONFIG.mockRewardedDuration);
}

function showMockInterstitialAd(onComplete) {
  const overlay = createAdOverlay('interstitial');
  document.body.appendChild(overlay);

  let timeLeft = Math.ceil(AD_CONFIG.mockInterstitialDuration / 1000);
  const timerEl = overlay.querySelector('.ad-timer');
  const progressEl = overlay.querySelector('.ad-progress-bar');

  const timerInterval = setInterval(() => {
    timeLeft--;
    if (timerEl) timerEl.textContent = `${timeLeft}s`;
  }, 1000);

  progressEl.style.transition = `width ${AD_CONFIG.mockInterstitialDuration}ms linear`;
  setTimeout(() => progressEl.style.width = '100%', 50);

  setTimeout(() => {
    clearInterval(timerInterval);
    overlay.remove();
    adSession.adsWatched++;
    console.log('[AdManager] Interstitial ad completed');
    if (onComplete) onComplete();
  }, AD_CONFIG.mockInterstitialDuration);
}

function createAdOverlay(adType, rewardType = '') {
  const overlay = document.createElement('div');
  overlay.id = 'ad-overlay';
  overlay.className = 'ad-overlay show';

  let adContent = '';
  if (adType === 'rewarded') {
    const progress = rewardType === 'revive'
      ? `Ad ${adSession.currentReviveAdCount + 1}/${AD_CONFIG.reviveAdCount}`
      : 'Reward Ad';
    adContent = `
      <div class="ad-content">
        <div class="ad-mock-badge">🎬 MOCK AD</div>
        <h2>${rewardType === 'revive' ? '💀 REVIVE AD' : '❤️ EXTRA LIFE AD'}</h2>
        <p class="ad-progress-text">${progress}</p>
        <div class="ad-timer-container">
          <span class="ad-timer">${Math.ceil(AD_CONFIG.mockRewardedDuration / 1000)}s</span>
        </div>
        <div class="ad-progress-track">
          <div class="ad-progress-bar"></div>
        </div>
        <p class="ad-note">In production, a real video ad would play here</p>
      </div>
    `;
  } else {
    adContent = `
      <div class="ad-content">
        <div class="ad-mock-badge">📺 MOCK AD</div>
        <h2>WAVE TRANSITION AD</h2>
        <div class="ad-timer-container">
          <span class="ad-timer">${Math.ceil(AD_CONFIG.mockInterstitialDuration / 1000)}s</span>
        </div>
        <div class="ad-progress-track">
          <div class="ad-progress-bar"></div>
        </div>
        <p class="ad-note">Interstitial ad placeholder</p>
      </div>
    `;
  }

  overlay.innerHTML = adContent;
  return overlay;
}

// ==================== GOOGLE ADSENSE INTEGRATION ====================
// These functions will be implemented when AdSense H5 Games is approved

function initGoogleAds() {
  console.log('[AdManager] Initializing Google AdSense H5 Games...');
  // TODO: Implement when AdSense access is granted
  // window.adsbygoogle = window.adsbygoogle || [];
}

function showGoogleRewardedAd(type, onComplete, onCancel) {
  // TODO: Implement Google H5 Games rewarded ad
  // H5GamesAds.requestRewardedAd().then(ad => {
  //   ad.show().then(() => onComplete()).catch(() => onCancel());
  // });

  // Fallback to mock for now
  showMockRewardedAd(type, onComplete, onCancel);
}

function showGoogleInterstitialAd(onComplete) {
  // TODO: Implement Google H5 Games interstitial ad
  // H5GamesAds.showInterstitialAd().then(() => onComplete());

  // Fallback to mock for now
  showMockInterstitialAd(onComplete);
}

// Export config for external access
export const AdConfig = AD_CONFIG;
