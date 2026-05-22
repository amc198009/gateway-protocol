/**
 * Electron Forge build config — Gateway Protocol
 *
 * Per-platform makers (each is scoped via `platforms`, so `npm run make`
 * only runs the makers relevant to the host it's invoked on):
 *   macOS   → .dmg (maker-dmg) + .zip fallback
 *   Windows → Setup.exe (maker-squirrel)
 *   Linux   → .deb (maker-deb) + .rpm (maker-rpm) + .zip
 *
 * IMPORTANT — cross-compilation is NOT free:
 *   - Windows Squirrel builds need to run on Windows (or via wine+mono).
 *   - .deb needs `dpkg` + `fakeroot`; .rpm needs `rpmbuild`. Both Linux-only.
 *   - So a full three-OS release needs a CI matrix with macos-latest,
 *     windows-latest, and ubuntu-latest runners each running `npm run make`.
 *
 * Signing status:
 *   macOS   → ad-hoc signed locally via the postPackage hook below. This makes
 *             the build run on THIS machine without the Gatekeeper "cannot
 *             verify… malware" warning. It is NOT a Developer ID signature —
 *             other Macs will still warn; distribution needs notarization.
 *   Windows → UNSIGNED (SmartScreen warning). Authenticode signing is a
 *             separate, paid step — see TODO.md §1.
 */

module.exports = {
  packagerConfig: {
    name: 'Gateway Protocol',
    executableName: 'gateway-protocol',
    appBundleId: 'com.arturomorales.gateway-protocol',
    appCategoryType: 'public.app-category.healthcare-fitness',
    asar: true,
    // icon: './assets/icon', // add icon.icns / icon.ico later
  },
  rebuildConfig: {},
  makers: [
    // ── macOS ──
    {
      name: '@electron-forge/maker-dmg',
      config: { name: 'Gateway Protocol', format: 'ULFO' },
      platforms: ['darwin'],
    },
    // ── Windows ──
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'gateway_protocol',
        setupExe: 'Gateway Protocol Setup.exe',
        // setupIcon: './assets/icon.ico', // add later
      },
      platforms: ['win32'],
    },
    // ── Linux ──
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          name: 'gateway-protocol',
          productName: 'Gateway Protocol',
          genericName: 'Consciousness Practice Platform',
          categories: ['Education', 'Utility'],
          maintainer: 'Arturo Morales',
          homepage: 'https://github.com/amc198009/gateway-protocol',
        },
      },
      platforms: ['linux'],
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {
        options: {
          name: 'gateway-protocol',
          productName: 'Gateway Protocol',
          homepage: 'https://github.com/amc198009/gateway-protocol',
          license: 'AGPL-3.0-only',
        },
      },
      platforms: ['linux'],
    },
    // ── Universal fallback ──
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux', 'win32'],
    },
  ],
  plugins: [],
  hooks: {
    // macOS builds are otherwise unsigned, which trips Gatekeeper. Apply an
    // ad-hoc signature ("--sign -") to every packaged .app so it launches on
    // the build machine without the malware warning. Local-only: this does NOT
    // notarize or use a Developer ID, so other Macs still warn (see TODO.md §1).
    // No-op on Windows/Linux.
    postPackage: async (_forgeConfig, options) => {
      if (options.platform !== 'darwin') return;
      const { execFileSync } = require('node:child_process');
      const path = require('node:path');
      for (const out of options.outputPaths) {
        const app = path.join(out, 'Gateway Protocol.app');
        try {
          execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
          console.log(`✔ ad-hoc signed ${app}`);
        } catch (e) {
          console.warn(`⚠ ad-hoc sign failed for ${app}: ${e.message}`);
        }
      }
    },
  },
};
