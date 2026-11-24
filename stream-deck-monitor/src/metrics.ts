import type { Sample } from "./helper.js";

export type MetricId =
	| "cpu"
	| "ram"
	| "gpu"
	| "vram"
	| "fps"
	| "frametime"
	| "cputemp"
	| "gputemp"
	| "disk"
	| "diskbusy"
	| "diskread"
	| "diskwrite"
	| "netdown"
	| "netup"
	| "ping"
	| "loss";

/** Per-key settings (edited in the Property Inspector). */
export type MetricSettings = {
	metric?: MetricId;
	/** Redraw interval in milliseconds. */
	refresh?: number;
	/** Sparkline style. */
	graph?: "area" | "line" | "bars" | "off";
	/** Thresholds in the native unit of the metric (%, °C, FPS, ms, MB/s). Empty = metric default. */
	warn?: number | string;
	crit?: number | string;
	colorOk?: string;
	colorWarn?: string;
	colorCrit?: string;
	tempUnit?: "C" | "F";
	netUnit?: "bytes" | "bits";
	showLabel?: boolean;
	/** Host for the ping / packet loss metrics (default 1.1.1.1). */
	pingHost?: string;
};

export type Formatted = {
	/** Big text, e.g. "42%" or "1.4". */
	big: string;
	/** Optional small suffix drawn next to the big text, e.g. "°C". */
	suffix?: string;
	/** Second line, e.g. "11.1 / 47.2 GB". */
	sub?: string;
	/** true when there is no value (the key shows N/A). */
	na: boolean;
};

export type MetricDef = {
	id: MetricId;
	label: string;
	accent: string;
	/** Value used for the sparkline and the thresholds (null = unavailable). */
	read: (s: Sample) => number | null;
	/** Direction in which values become "worse": high (usage, temperature, frame time), low (FPS) or none. */
	worse: "high" | "low" | "none";
	defWarn?: number;
	defCrit?: number;
	/** Fixed sparkline range; omitted = automatic. */
	range?: [number, number];
	/** Minimum upper bound for the automatic range. */
	minMax?: number;
	format: (v: number | null, s: Sample | undefined, st: MetricSettings, history: number[]) => Formatted;
};

export const METRIC_ORDER: MetricId[] = ["cpu", "ram", "gpu", "vram", "fps", "frametime", "cputemp", "gputemp", "disk", "diskbusy", "diskread", "diskwrite", "netdown", "netup", "ping", "loss"];

const MB = 1024 * 1024;
const GB = 1024 * MB;

const pct = (v: number): string => `${Math.round(v)}%`;
const avg = (h: number[]): number | null => (h.length ? h.reduce((a, b) => a + b, 0) / h.length : null);
const gb = (b: number): string => (b / GB).toFixed(b / GB >= 10 ? 0 : 1);
const NA: Formatted = { big: "N/A", na: true };

/** Formats a byte rate: bytes/s -> "KB/s" ... "GB/s" or bits -> "kbit/s" ... "Gbit/s". */
export function formatRate(bytesPerSec: number, unit: "bytes" | "bits"): { value: string; unit: string } {
	const bits = unit === "bits";
	const base = bits ? 1000 : 1024;
	let v = bits ? bytesPerSec * 8 : bytesPerSec;
	const names = bits ? ["bit/s", "kbit/s", "Mbit/s", "Gbit/s"] : ["B/s", "KB/s", "MB/s", "GB/s"];
	let i = 0;
	while (v >= base * 0.95 && i < names.length - 1) {
		v /= base;
		i++;
	}
	return { value: v >= 100 || i === 0 ? String(Math.round(v)) : v.toFixed(v >= 10 ? 1 : 2), unit: names[i] };
}

const rateFormat =
	(label: string) =>
	(v: number | null, _s: Sample | undefined, st: MetricSettings, history: number[]): Formatted => {
		if (v === null) return NA;
		const r = formatRate(v, st.netUnit ?? "bytes");
		const peak = history.length ? Math.max(...history) : null;
		return { big: r.value, sub: peak === null ? r.unit : `${r.unit} · max ${formatRate(peak, st.netUnit ?? "bytes").value}`, na: false };
	};

const temp =
	(source: "cpuTemp" | "gpuTemp") =>
	(v: number | null, s: Sample | undefined, st: MetricSettings, history: number[]): Formatted => {
		if (v === null || v <= 0) {
			let sub = "no sensor";
			if (source === "cpuTemp") {
				switch (s?.tempStatus) {
					case "not-installed": sub = "setup needed";
						break;
					case "starting": sub = "starting…";
						break;
					case "no-driver": sub = "no PawnIO";
						break;
					case "unsupported": sub = "unsupported";
						break;
					case "no-lib": sub = "no library";
						break;
				}
			}
			return { big: "N/A", sub, na: true };
		}
		const f = st.tempUnit === "F";
		const conv = (c: number) => (f ? c * 1.8 + 32 : c);
		const max = history.length ? Math.max(...history) : v;
		return { big: String(Math.round(conv(v))), suffix: f ? "°F" : "°C", sub: `max ${Math.round(conv(max))}°`, na: false };
	};

export const METRICS: Record<MetricId, MetricDef> = {
	cpu: {
		id: "cpu", label: "CPU", accent: "#4aa3ff", read: (s) => s.cpu, worse: "high", defWarn: 70, defCrit: 90, range: [0, 100],
		format: (v, _s, _st, h) => (v === null ? NA : { big: pct(v), sub: `avg ${pct(avg(h) ?? v)}`, na: false }),
	},
	ram: {
		id: "ram", label: "RAM", accent: "#b07cff", read: (s) => s.ram, worse: "high", defWarn: 75, defCrit: 90, range: [0, 100],
		format: (v, s) => (v === null ? NA : { big: pct(v), sub: s?.ramUsed != null && s.ramTotal != null ? `${gb(s.ramUsed)} / ${gb(s.ramTotal)} GB` : undefined, na: false }),
	},
	gpu: {
		id: "gpu", label: "GPU", accent: "#3fd17f", read: (s) => s.gpu, worse: "high", defWarn: 85, defCrit: 98, range: [0, 100],
		format: (v, _s, _st, h) => (v === null ? NA : { big: pct(v), sub: `avg ${pct(avg(h) ?? v)}`, na: false }),
	},
	vram: {
		id: "vram", label: "VRAM", accent: "#2fd1c5", read: (s) => s.vram, worse: "high", defWarn: 80, defCrit: 95, range: [0, 100],
		format: (v, s) =>
			v === null
				? s?.vramUsed != null
					? { big: `${gb(s.vramUsed)}`, suffix: "GB", na: false }
					: NA
				: { big: pct(v), sub: s?.vramUsed != null && s.vramTotal != null ? `${gb(s.vramUsed)} / ${gb(s.vramTotal)} GB` : undefined, na: false },
	},
	fps: {
		id: "fps", label: "FPS", accent: "#7ee05a", read: (s) => s.fps, worse: "low", defWarn: 60, defCrit: 30, minMax: 60,
		format: (v, s) => {
			if (v === null) return { big: s?.fpsState === "idle" ? "—" : "N/A", sub: s?.fpsState === "idle" ? "no game" : s ? "RTSS not running" : undefined, na: true };
			return { big: String(Math.round(v)), sub: s?.fpsApp ?? undefined, na: false };
		},
	},
	frametime: {
		id: "frametime", label: "FRAME TIME", accent: "#7ee05a", read: (s) => (s.fps && s.fps > 0 ? 1000 / s.fps : null), worse: "high", defWarn: 20, defCrit: 34, minMax: 20,
		format: (v, s) => {
			if (v === null) return { big: s?.fpsState === "idle" ? "—" : "N/A", sub: s?.fpsState === "idle" ? "no game" : s ? "RTSS not running" : undefined, na: true };
			return { big: v.toFixed(1), sub: "ms", na: false };
		},
	},
	cputemp: {
		id: "cputemp", label: "CPU TEMP", accent: "#ffb347", read: (s) => (s.cpuTemp && s.cpuTemp > 0 ? s.cpuTemp : null), worse: "high", defWarn: 75, defCrit: 90, range: [20, 100],
		format: temp("cpuTemp"),
	},
	gputemp: {
		id: "gputemp", label: "GPU TEMP", accent: "#ffb347", read: (s) => (s.gpuTemp && s.gpuTemp > 0 ? s.gpuTemp : null), worse: "high", defWarn: 75, defCrit: 90, range: [20, 100],
		format: temp("gpuTemp"),
	},
	disk: {
		id: "disk", label: "DISK", accent: "#f0c040", read: (s) => (s.diskRead === null || s.diskWrite === null ? null : s.diskRead + s.diskWrite), worse: "none", minMax: 10 * MB,
		format: rateFormat("DISK"),
	},
	diskbusy: {
		id: "diskbusy", label: "DISK BUSY", accent: "#f0c040", read: (s) => s.disk, worse: "high", defWarn: 80, defCrit: 95, range: [0, 100],
		format: (v, _s, _st, h) => (v === null ? NA : { big: pct(v), sub: `avg ${pct(avg(h) ?? v)}`, na: false }),
	},
	diskread: { id: "diskread", label: "DISK READ", accent: "#f0c040", read: (s) => s.diskRead, worse: "none", minMax: 10 * MB, format: rateFormat("READ") },
	diskwrite: { id: "diskwrite", label: "DISK WRITE", accent: "#f08a40", read: (s) => s.diskWrite, worse: "none", minMax: 10 * MB, format: rateFormat("WRITE") },
	netdown: { id: "netdown", label: "NET ↓", accent: "#4ad0ff", read: (s) => s.netDown, worse: "none", minMax: 1 * MB, format: rateFormat("DOWN") },
	ping: {
		id: "ping", label: "PING", accent: "#4ad0ff", read: (s) => s.ping, worse: "high", defWarn: 60, defCrit: 120, minMax: 50,
		format: (v, s, _st, h) => {
			if (v === null) return { big: s?.loss != null && s.loss > 0 ? "LOST" : "N/A", sub: s?.pingHost ?? undefined, na: true };
			const max = h.length ? Math.max(...h) : v;
			return { big: String(Math.round(v)), suffix: "ms", sub: `${s?.pingHost ?? ""} · max ${Math.round(max)}`.replace(/^ · /, ""), na: false };
		},
	},
	loss: {
		id: "loss", label: "PACKET LOSS", accent: "#4ad0ff", read: (s) => s.loss, worse: "high", defWarn: 1, defCrit: 5, range: [0, 100],
		format: (v) => (v === null ? { big: "…", sub: "measuring", na: true } : { big: v < 10 ? `${v.toFixed(v === 0 ? 0 : 1)}%` : pct(v), sub: "last 60 pings", na: false }),
	},
	netup: { id: "netup", label: "NET ↑", accent: "#ff7ab8", read: (s) => s.netUp, worse: "none", minMax: 1 * MB, format: rateFormat("UP") },
};

/** Thresholds are entered in "MB/s" for throughput metrics; everything else uses the native unit. */
const RATE_METRICS = new Set<MetricId>(["disk", "diskread", "diskwrite", "netdown", "netup"]);

function num(v: unknown): number | undefined {
	if (v === "" || v === null || v === undefined) return undefined;
	const n = Number(v);
	return Number.isFinite(n) ? n : undefined;
}

/** State color of a value: ok / warn / crit. */
export function stateColor(def: MetricDef, st: MetricSettings, v: number | null): string {
	const ok = st.colorOk || def.accent;
	const warnC = st.colorWarn || "#ffb020";
	const critC = st.colorCrit || "#ff4d4d";
	if (v === null || def.worse === "none" && num(st.warn) === undefined && num(st.crit) === undefined) return ok;
	const scale = RATE_METRICS.has(def.id) ? MB : 1;
	const warn = num(st.warn) ?? def.defWarn;
	const crit = num(st.crit) ?? def.defCrit;
	const worse = def.worse === "none" ? "high" : def.worse;
	const hit = (limit: number | undefined) => limit !== undefined && (worse === "high" ? v >= limit * scale : v <= limit * scale);
	if (hit(crit)) return critC;
	if (hit(warn)) return warnC;
	return ok;
}
