// Generates the "Monitor Dashboard" profile (15-key Stream Deck, 5 columns x 3 rows) bundled with the plugin.
//
// Layout (column,row):
//   row 0: CPU        RAM        GPU        VRAM       FPS
//   row 1: CPU temp   GPU temp   Frame time Ping       Packet loss
//   row 2: Back       (empty)
//
// Stream Deck 7 "3.0" format (as stored in %APPDATA%\Elgato\StreamDeck\ProfilesV3): a .streamDeckProfile is a zip
//   <UUID>.sdProfile/manifest.json
//   <UUID>.sdProfile/Profiles/<PAGE-UUID>/manifest.json   (+ Images folder)
// The old "2.0" format with base32 folder names is rejected ("no pages in umbrella").
//
// Usage: node tools/make-profile.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_UUID = "dev.sdmonitor";
const PLUGIN_NAME = "System Monitor";
const PLUGIN_VERSION = "1.1.0.0";
const PROFILE_NAME = "Monitor Dashboard"; // must match Profiles[].Name in manifest.json
// Fixed IDs: rebuilding the profile always gives the same result
const PROFILE_UUID = "2B6F0A94-3C1D-4E8A-9B27-6D5E4C3B2A10";
const PAGE_UUID = "c4e8a1d2-7b3f-4a65-8e90-1f2d3c4b5a60";
const DEFAULT_PAGE_UUID = "9a7d5c31-2e4b-4f86-b1a3-0c8e6d4f2b75";
const DEVICE_MODEL = "20GBA9901"; // 15-key Stream Deck

const here = dirname(fileURLToPath(import.meta.url));
const outFile = process.env.PROFILE_OUT ?? resolve(here, "..", "dev.sdmonitor.sdPlugin", `${PROFILE_NAME}.streamDeckProfile`);

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

const metric = (id) => action("metric", "Metric", { metric: id, refresh: 1000, graph: "area", showLabel: true });

const layout = [
	["cpu", "ram", "gpu", "vram", "fps"],
	["cputemp", "gputemp", "frametime", "ping", "loss"],
	["back", null, null, null, null],
];
const actions = {};
layout.forEach((row, r) =>
	row.forEach((id, c) => {
		if (id === "back") actions[`${c},${r}`] = action("back", "Back");
		else if (id) actions[`${c},${r}`] = metric(id);
	}),
);

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
const work = mkdtempSync(join(tmpdir(), "sdmonitor-profile-"));
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
