/* CI helper: make the iOS app iPhone-only (TARGETED_DEVICE_FAMILY = 1) and set
   the marketing version. The ios/ project is regenerated each build, so this
   runs after `cap sync`. Drops the iPad requirement (no iPad screenshots). */
const fs = require("fs");
const xcode = require("xcode");

const PBXPROJ = "ios/App/App.xcodeproj/project.pbxproj";
const VERSION = process.env.MARKETING_VERSION || "1.0";

try {
  const proj = xcode.project(PBXPROJ);
  proj.parseSync();
  proj.updateBuildProperty("TARGETED_DEVICE_FAMILY", '"1"');
  proj.updateBuildProperty("MARKETING_VERSION", VERSION);
  fs.writeFileSync(PBXPROJ, proj.writeSync());
  console.log("Set TARGETED_DEVICE_FAMILY = 1 (iPhone only) and MARKETING_VERSION = " + VERSION);
} catch (e) {
  console.warn("iphone-only: could not patch project -", e.message);
}
