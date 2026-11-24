import type { DialAction, KeyAction } from "@elgato/streamdeck";
import type { AudioSession } from "./audio-helper.js";
import { mixer } from "./mixer.js";

/** Settings of a single "App" / "Volume slider" key. */
export type AppSettings = {
	/** "auto": the app depends on the key position (1st key = 1st app of the list...); "fixed": always the same process. */
	mode?: "auto" | "fixed";
	/** Process for "fixed" mode (lowercase executable name). */
	process?: string;
	/** Volume change step in percentage points. */
	step?: number;
	/** true on the keys of the "Auto" profile: they only show apps that are playing audio, with pages. */
	auto?: boolean;
	[key: string]: string | number | boolean | undefined;
};

export type SlotAction = KeyAction<AppSettings> | DialAction<AppSettings>;
type SlotEntry = { action: SlotAction; settings: AppSettings };

/** "App" keys currently visible, by instance id. */
export const slots = new Map<string, SlotEntry>();

const isAutoProfile = (e: SlotEntry): boolean => e.settings.auto === true;

function groupKey(a: SlotAction): string {
	return `${a.device.id}|${a.controllerType}`;
}

function position(a: SlotAction): [number, number] {
	const c = a.coordinates;
	return c ? [c.row, c.column] : [99, 99];
}

/** Keys in automatic mode of the same group (same device and same "kind": Auto profile or not). */
function autoEntries(entry: SlotEntry): SlotEntry[] {
	const key = groupKey(entry.action);
	const auto = isAutoProfile(entry);
	return [...slots.values()]
		.filter((e) => (e.settings.mode ?? "auto") === "auto" && isAutoProfile(e) === auto && groupKey(e.action) === key)
		.sort((x, y) => {
			const [r1, c1] = position(x.action);
			const [r2, c2] = position(y.action);
			// in the Auto profile columns matter more than rows: every column is an app (app + sliders below)
			return auto ? c1 - c2 || r1 - r2 : r1 - r2 || c1 - c2;
		});
}

/** Number of "App" keys of the Auto profile on a device (= apps per page). */
function autoKeyCount(deviceId: string): number {
	return [...slots.values()].filter((e) => isAutoProfile(e) && e.action.device.id === deviceId && (e.settings.mode ?? "auto") === "auto").length;
}

/** Number of pages of the Auto profile on a device (at least 1). */
export function autoPageCount(deviceId: string): number {
	const per = autoKeyCount(deviceId);
	return per === 0 ? 1 : Math.max(1, Math.ceil(mixer.autoList().length / per));
}

/** Current page (0-based) of the Auto profile, limited to the pages that exist. */
export function autoPage(deviceId: string): number {
	return Math.min(mixer.page(deviceId), autoPageCount(deviceId) - 1);
}

/** Index (0-based) in the app list of a key in automatic mode: depends on its position (and on the page in the Auto profile). */
export function autoIndex(entry: SlotEntry): number {
	const entries = autoEntries(entry);
	const index = Math.max(entries.findIndex((e) => e.action.id === entry.action.id), 0);
	return isAutoProfile(entry) ? autoPage(entry.action.device.id) * entries.length + index : index;
}

/** Audio session shown by an "App" key (automatic or fixed process). */
export function resolveSession(entry: SlotEntry): { session?: AudioSession; name?: string } {
	if (entry.settings.mode === "fixed") {
		const name = entry.settings.process;
		return { session: name ? mixer.find(name) : undefined, name };
	}
	const list = isAutoProfile(entry) ? mixer.autoList() : mixer.visible();
	const session = list[autoIndex(entry)];
	return { session, name: session?.name };
}

/**
 * For a Volume slider key: the app of the nearest "App" key ABOVE it in the same column
 * (same device). `undefined` if there is no App key above.
 */
export function appAbove(device: string, row: number, column: number): ReturnType<typeof resolveSession> | undefined {
	const best = appEntryAbove(device, row, column);
	return best ? resolveSession(best) : undefined;
}

/** Row of the nearest App key above (same column), or undefined. */
export function appRowAbove(device: string, row: number, column: number): number | undefined {
	return appEntryAbove(device, row, column)?.action.coordinates?.row;
}

/** Row of the nearest App key BELOW (same column), or undefined. */
export function appRowBelow(device: string, row: number, column: number): number | undefined {
	let best: number | undefined;
	for (const e of slots.values()) {
		const c = e.action.coordinates;
		if (!c || !e.action.isKey() || e.action.device.id !== device || c.column !== column || c.row <= row) continue;
		if (best === undefined || c.row < best) best = c.row;
	}
	return best;
}

function appEntryAbove(device: string, row: number, column: number): SlotEntry | undefined {
	let best: SlotEntry | undefined;
	for (const e of slots.values()) {
		const c = e.action.coordinates;
		if (!c || !e.action.isKey() || e.action.device.id !== device || c.column !== column || c.row >= row) continue;
		if (!best || c.row > (best.action.coordinates?.row ?? -1)) best = e;
	}
	return best;
}
