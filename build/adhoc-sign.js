// electron-builder skips code signing entirely when no Developer ID identity is
// found, which leaves the bundle unsealed. macOS then treats the quarantined app
// as "damaged" and offers to move it to the Trash. Ad-hoc signing the merged
// bundle here makes it launchable (right-click → Open on other Macs).
// A real Developer ID sign, when credentials are present, runs right after this
// and replaces the ad-hoc signature. See SIGNING.md.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async ({ appOutDir, packager }) => {
  // Universal builds pack x64/arm64 into *-temp dirs first; signing those makes
  // the two trees differ and @electron/universal refuses to merge them.
  if (appOutDir.endsWith('-temp')) return;
  const app = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
