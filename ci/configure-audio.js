/* CI helper: configure the iOS audio session so Web Audio plays through the
   hardware mute switch like a normal game, instead of being silenced by the
   WKWebView default "ambient" session. Patches AppDelegate.swift after
   `cap sync`. Non-fatal if the file shape changes. */
const fs = require("fs");

const PATH = "ios/App/App/AppDelegate.swift";

try {
  let src = fs.readFileSync(PATH, "utf8");
  if (!src.includes("import AVFoundation")) {
    src = src.replace("import Capacitor", "import Capacitor\nimport AVFoundation");
  }
  if (!src.includes("setCategory(.playback")) {
    const audioSetup =
      "\n        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])" +
      "\n        try? AVAudioSession.sharedInstance().setActive(true)";
    const re = /(didFinishLaunchingWithOptions[^{]*\{)/;
    if (re.test(src)) src = src.replace(re, "$1" + audioSetup);
    else console.warn("configure-audio: didFinishLaunching not found - skipped.");
  }
  fs.writeFileSync(PATH, src);
  console.log("Configured AVAudioSession for .playback");
} catch (e) {
  console.warn("configure-audio: could not patch AppDelegate.swift -", e.message);
}
