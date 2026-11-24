// Downloads LibreHardwareMonitorLib (MPL-2.0) and its dependency closure from nuget.org for .NET Framework 4.7.2
// and puts the DLLs into helper/lib (used by build-helper.cmd, then copied next to SensorHelper.exe).
// Usage: node tools/fetch-lhm.mjs [version]
import { mkdirSync, mkdtempSync, readdirSync, copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const libDir = resolve(here, "..", "helper", "lib");
const ROOT = "librehardwaremonitorlib";
const VERSION = process.argv[2] ?? "0.9.6";
// Assemblies that are part of .NET Framework itself (GAC): never bundle them.
const SKIP = new Set(["system.management", "system.security.claims", "system.collections", "system.runtime", "system.globalization", "system.io", "system.text.encoding", "system.threading.tasks", "system.resources.resourcemanager", "system.runtime.extensions", "system.security.principal"]);
const FW = ["net472", "net471", "net47", "net462", "net461", "net46", "net452", "net45", "net40", "netstandard2.0", "netstandard1.3"];
const GROUPS = [".netframework4.7.2", ".netframework4.6.2", ".netframework4.6.1", ".netframework4.6", ".netframework4.5", ".netstandard2.0", ".netstandard1.3"];

mkdirSync(libDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "lhm-"));
const done = new Set();

async function fetchPkg(id, version) {
	const key = id.toLowerCase();
	if (done.has(key) || SKIP.has(key)) return;
	done.add(key);
	const url = `https://api.nuget.org/v3-flatcontainer/${key}/${version}/${key}.${version}.nupkg`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
	const nupkg = join(work, `${key}.zip`);
	writeFileSync(nupkg, Buffer.from(await res.arrayBuffer()));
	const dir = join(work, key);
	mkdirSync(dir, { recursive: true });
	if (spawnSync("tar", ["-xf", nupkg, "-C", dir]).status !== 0) throw new Error(`Cannot extract ${id}`);

	// Best matching lib folder
	// LibreHardwareMonitorLib ships its real implementation under runtimes/win-x64/lib/net472 (lib/ only has reference stubs)
	const rt = join(dir, "runtimes", "win-x64", "lib");
	const libRoot = existsSync(rt) ? rt : join(dir, "lib");
	if (existsSync(libRoot)) {
		const have = readdirSync(libRoot);
		const pick = FW.find((f) => have.includes(f));
		if (pick) {
			for (const f of readdirSync(join(libRoot, pick))) {
				if (f.toLowerCase().endsWith(".dll")) copyFileSync(join(libRoot, pick, f), join(libDir, f));
			}
			console.log(`  ${id} ${version} (${pick})`);
		}
	}
	// Dependencies from the nuspec
	const nuspec = readdirSync(dir).find((f) => f.endsWith(".nuspec"));
	const xml = readFileSync(join(dir, nuspec), "utf8");
	const groups = [...xml.matchAll(/<group targetFramework="([^"]+)"\s*>([\s\S]*?)<\/group>/g)].map((m) => ({ tf: m[1].toLowerCase(), body: m[2] }));
	let body = "";
	for (const g of GROUPS) {
		const hit = groups.find((x) => x.tf === g);
		if (hit) { body = hit.body; break; }
	}
	if (!body && !groups.length) body = (xml.match(/<dependencies>([\s\S]*?)<\/dependencies>/) ?? [, ""])[1];
	for (const m of body.matchAll(/<dependency id="([^"]+)" version="([^"]+)"/g)) {
		const v = m[2].replace(/[\[\(\]\)]/g, "").split(",")[0];
		await fetchPkg(m[1], v);
	}
}

console.log(`Fetching LibreHardwareMonitorLib ${VERSION} + dependencies into ${libDir}`);
await fetchPkg(ROOT, VERSION);
rmSync(work, { recursive: true, force: true });
console.log("Done:", readdirSync(libDir).join(", "));

