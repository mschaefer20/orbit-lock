/* CI helper: point the App target at the App Store provisioning profile
   that `app-store-connect fetch-signing-files` downloaded. Backstop for
   `xcode-project use-profiles`, which can finish without touching the target
   (archive then fails with '"App" requires a provisioning profile').
   Runs after use-profiles; macOS only (uses `security cms`). */
const fs = require("fs"), path = require("path"), os = require("os");
const { execFileSync } = require("child_process");
const xcode = require("xcode");

const PBXPROJ = "ios/App/App.xcodeproj/project.pbxproj";
const BUNDLE_ID = process.env.BUNDLE_ID;
const DIR = path.join(os.homedir(), "Library/MobileDevice/Provisioning Profiles");

function fail(msg) { console.error("apply-signing: " + msg); process.exit(1); }
if (!BUNDLE_ID) fail("BUNDLE_ID is not set");

// decode every installed profile and keep the App Store one for this bundle id
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /\.mobileprovision$/.test(f)) : [];
const field = (xml, key) => { const m = xml.match(new RegExp("<key>" + key + "</key>\\s*<string>([^<]*)</string>")); return m && m[1]; };
let profile = null;
for (const f of files) {
  const xml = execFileSync("security", ["cms", "-D", "-i", path.join(DIR, f)], { encoding: "utf8" });
  const appId = field(xml, "application-identifier") || "";
  const team = (xml.match(/<key>TeamIdentifier<\/key>\s*<array>\s*<string>([^<]*)<\/string>/) || [])[1];
  const store = !/<key>ProvisionedDevices<\/key>/.test(xml) && !/<key>get-task-allow<\/key>\s*<true\/>/.test(xml);
  console.log(`profile ${f}: ${field(xml, "Name")} app=${appId} team=${team} appstore=${store}`);
  if (store && appId === team + "." + BUNDLE_ID) profile = { name: field(xml, "Name"), uuid: field(xml, "UUID"), team };
}
if (!profile) fail(`no App Store profile for ${BUNDLE_ID} among ${files.length} installed profile(s). Check the fetch-signing-files output above.`);

const proj = xcode.project(PBXPROJ);
proj.parseSync();
if (!proj.pbxTargetByName("App")) fail("no target named App in " + PBXPROJ);
const set = (k, v) => proj.updateBuildProperty(k, v, undefined, "App");
set("CODE_SIGN_STYLE", "Manual");
set("DEVELOPMENT_TEAM", profile.team);
set("CODE_SIGN_IDENTITY", '"Apple Distribution"');
set('"CODE_SIGN_IDENTITY[sdk=iphoneos*]"', '"Apple Distribution"');
set("PROVISIONING_PROFILE_SPECIFIER", `"${profile.name}"`);
set("PROVISIONING_PROFILE", `"${profile.uuid}"`);
fs.writeFileSync(PBXPROJ, proj.writeSync());
console.log(`apply-signing: App target -> "${profile.name}" (${profile.uuid}), team ${profile.team}`);
