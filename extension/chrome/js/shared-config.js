(function configureAeroTrack(global) {
  const backendBaseUrl = 'https://aerotrack-api.aerotrack-sajid.workers.dev';

  global.AEROTRACK_CONFIG = Object.freeze({
    appName: 'AeroTrack Flight Hub',
    buildVersion: '0.4.0',
    backendBaseUrl,
    activityApiUrl: `${backendBaseUrl}/api/activity`,
    supportUrl: '',
    privacyUrl: '',
    uninstallFeedbackUrl: '',
    webSearchUrl: 'https://duckduckgo.com/?q={query}',
  });
}(globalThis));
