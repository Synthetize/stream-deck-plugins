// Generates the "App Mixer Auto" profile (15-key Stream Deck, 5 columns x 3 rows) bundled with the plugin.
//
// Layout (key = "column,row"):
//   column 0     : Back (previous profile) / Next page / Previous page
//   columns 1-4  : App key (auto) + 2 Volume slider keys below it
//
// Stream Deck 7 "3.0" format (as stored in %APPDATA%\Elgato\StreamDeck\ProfilesV3): a .streamDeckProfile is a zip
//   <UUID>.sdProfile/manifest.json
//   <UUID>.sdProfile/Profiles/<PAGE-UUID>/manifest.json   (+ Images folder)
// The old "2.0" format with base32 folder names was rejected ("no pages in umbrella").
//
// Usage: node tools/make-profile.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_UUID = "dev.appmixer.volume";
const PLUGIN_NAME = "App Volume Mixer";
const PLUGIN_VERSION = "3.1.1.0";
const PROFILE_NAME = "App Mixer Auto"; // must match Profiles[].Name in manifest.json
// Fixed IDs: rebuilding the profile always gives the same result
const PROFILE_UUID = "7E0C3E52-5B1A-4B7C-9D55-2F4C8A1E6B10";
const PAGE_UUID = "a3c1d6f4-8b2e-4f57-9a0d-5e6b7c8d9e01";
const DEFAULT_PAGE_UUID = "5d2b9c10-4e7a-4a83-8c31-0f6e1b7a2d44";
const DEVICE_MODEL = "20GBA9901"; // 15-key Stream Deck
const COLUMNS = 5;

const here = dirname(fileURLToPath(import.meta.url));
const outFile = process.env.PROFILE_OUT ?? resolve(here, "..", "dev.appmixer.volume.sdPlugin", `${PROFILE_NAME}.streamDeckProfile`);

// Stable ActionIDs, so the file is reproducible
let counter = 0;
const actionId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

const action = (uuid, name, settings = null) => ({
	ActionID: actionId(),
	LinkedTitle: false,
	Name: name,
	Plugin: { Name: PLUGIN_NAME, UUID: PLUGIN_UUID, Version: PLUGIN_VERSION },
	Resources: null,
	Settings: settings,
	State: 0,
	States: [
		{
			FontFamily: "",
			FontSize: 16,
			FontStyle: "",
			FontUnderline: false,
			OutlineThickness: 2,
			ShowTitle: false,
			TitleAlignment: "bottom",
			TitleColor: "#ffffff",
		},
	],
	UUID: `${PLUGIN_UUID}.${uuid}`,
});

const actions = {
	"0,0": action("back", "Back"),
	"0,1": action("next-page", "Next page"),
	"0,2": action("prev-page", "Previous page"),
};
for (let c = 1; c < COLUMNS; c++) {
	actions[`${c},0`] = action("app", "App", { mode: "auto", auto: true });
	actions[`${c},1`] = action("slider", "Volume slider");
	actions[`${c},2`] = action("slider", "Volume slider");
}

const topManifest = {
	Device: { Model: DEVICE_MODEL, UUID: "" },
	InstalledByPluginUUID: PLUGIN_UUID,
	Name: PROFILE_NAME,
	Pages: { Current: PAGE_UUID, Default: DEFAULT_PAGE_UUID, Pages: [PAGE_UUID] },
	PreconfiguredName: PROFILE_NAME,
	Version: "3.0",
};
const pageManifest = { Controllers: [{ Actions: actions, Type: "Keypad" }], Icon: "", Name: "" };
const defaultPageManifest = { Controllers: [{ Actions: null, Type: "Keypad" }], Icon: "", Name: "" };

// temporary folder -> zip (the tar bundled with Windows 10/11 with --format zip uses "/" in paths)
const work = mkdtempSync(join(tmpdir(), "appmixer-profile-"));
const top = join(work, `${PROFILE_UUID}.sdProfile`);
mkdirSync(join(top, "Images"), { recursive: true });
writeFileSync(join(top, "manifest.json"), JSON.stringify(topManifest));
for (const [uuid, manifest] of [
	[PAGE_UUID, pageManifest],
	[DEFAULT_PAGE_UUID, defaultPageManifest],
]) {
	const dir = join(top, "Profiles", uuid.toUpperCase());
	mkdirSync(join(dir, "Images"), { recursive: true });
	writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
}

rmSync(outFile, { force: true });
const r = spawnSync("tar", ["--format", "zip", "-c", "-f", outFile, "-C", work, `${PROFILE_UUID}.sdProfile`], { stdio: "inherit" });
rmSync(work, { recursive: true, force: true });
if (r.status !== 0) {
	console.error("Creating the zip failed (needs the 'tar' that ships with Windows 10/11).");
	process.exit(1);
}
console.log(`Profile created: ${outFile}`);
