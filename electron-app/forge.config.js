/**
 * Electron Forge build config — Gateway Protocol V2
 *
 * macOS: produces a .dmg via @electron-forge/maker-dmg.
 *        Also produces a .zip fallback for non-Apple-Silicon installs.
 * Other platforms are not the V2 target; we can add Windows (squirrel)
 * and Linux (deb/rpm) makers later if needed.
 *
 * Notarization is intentionally OFF for the first build — it requires
 * an Apple Developer account + APP_BUNDLE_ID + notarytool credentials.
 * To enable later: add osxNotarize/osxSign blocks under packagerConfig
 * (see https://www.electronforge.io/guides/code-signing/code-signing-macos).
 */

module.exports = {
  packagerConfig: {
    name: 'Gateway Protocol',
    executableName: 'gateway-protocol',
    appBundleId: 'com.arturomorales.gateway-protocol',
    appCategoryType: 'public.app-category.healthcare-fitness',
    asar: true,
    // icon: './assets/icon', // add icon.icns later
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-dmg',
      config: {
        name: 'Gateway Protocol',
        format: 'ULFO',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
  ],
  plugins: [],
};
