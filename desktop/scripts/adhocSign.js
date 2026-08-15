const { execFileSync } = require("child_process");
const path = require("path");

// Without an Apple Developer certificate, electron-builder signs nothing, and
// what it leaves behind is worse than an unsigned app: the Electron binary
// arrives from its download linker-signed, so the bundle carries a signature
// that promises sealed resources it does not have. macOS reads that as a
// tampered app rather than an unsigned one, and a copy that has been downloaded
// is refused with "ReqFlow is damaged and can't be opened. You should move it
// to the Trash." Right-click → Open does not get past that message.
//
// Re-signing the finished bundle ad-hoc costs nothing and makes the seal
// truthful. The app is still not signed by anyone, so Gatekeeper still refuses
// it on first open — but as "the developer cannot be verified", which is the
// refusal right-click → Open is for.
//
// This runs before electron-builder's own signing step, so a machine that does
// have a certificate signs over the top of it and nothing here is in the way.
module.exports = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  // --deep is discouraged by Apple for release signing, where each nested
  // binary should be signed on its own terms. For an ad-hoc signature whose
  // only job is a consistent seal, it is the whole of what is needed.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });

  console.log(`[desktop] ad-hoc signed ${path.basename(appPath)}`);
};
