import streamDeck from "@elgato/streamdeck";
import { AudioHelper, type AudioSession } from "./audio-helper.js";

/** Global plugin settings (persisted by Stream Deck, shared by all keys). */
export type GlobalSettings = {
	/** "blacklist": hides the processes in `hidden`; "whitelist": shows only the processes in `allowed`. */
	filterMode?: "blacklist" | "whitelist";
	/** Hidden processes (lowercase executable names, e.g. "steam", "system"). */
	hidden?: string[];
	/** Allowed processes in whitelist mode. */
	allowed?: string[];
	/** Preferred order: the listed processes are shown first, in this order. */
	order?: string[];
	/** If true, only sessions that are playing audio right now are shown. */
	onlyPlaying?: boolean;
	/** Auto profile: "playing" (default) = only apps that are playing audio; "all" = every detected app. */
	autoSource?: "playing" | "all";
};

const POLL_MS = 1000;
/** How long (ms) an app stays in the Auto list after it stopped playing audio. */
const AUTO_LINGER_MS = 20_000;

/**
 * Shared state: audio sessions, icons, global settings, current page per device.
 * Actions register with `subscribe` and are redrawn on every change.
 */
class Mixer {
	readonly helper = new AudioHelper();
	sessions: AudioSession[] = [];
	global: GlobalSettings = {};
	readonly #icons = new Map<string, string | null>();
	readonly #iconRequests = new Set<string>();
	readonly #listeners = new Set<() => void>();
	#timer: NodeJS.Timeout | undefined;
	#lastJson = "";
	#polling = false;
	/** Until this instant, volume values read back are ignored (avoids "bounce" while the volume is being changed). */
	readonly #holdUntil = new Map<string, number>();
	/** Last time a process was seen "active" (playing audio). */
	readonly #lastActive = new Map<string, number>();
	/** Order in which processes were first seen "active": keeps the Auto keys in a stable position. */
	readonly #firstActive = new Map<string, number>();
	#autoSig = "";
	readonly #pages = new Map<string, number>();

	subscribe(fn: () => void): () => void {
		this.#listeners.add(fn);
		return () => this.#listeners.delete(fn);
	}

	notify(): void {
		for (const fn of this.#listeners) {
			try {
				fn();
			} catch (err) {
				streamDeck.logger.error(`Rendering error: ${err}`);
			}
		}
	}

	async start(): Promise<void> {
		try {
			this.global = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
		} catch (err) {
			streamDeck.logger.warn(`Could not read the global settings: ${err}`);
		}
		streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
			this.global = ev.settings ?? {};
			this.notify();
		});
		await this.refresh();
		this.#timer = setInterval(() => void this.refresh(), POLL_MS);
	}

	stop(): void {
		if (this.#timer) clearInterval(this.#timer);
		this.helper.dispose();
	}

	async refresh(): Promise<void> {
		if (this.#polling) return;
		this.#polling = true;
		try {
			const list = await this.helper.list();
			const now = Date.now();
			for (const s of list) {
				const hold = this.#holdUntil.get(s.name);
				const prev = this.sessions.find((p) => p.name === s.name);
				if (hold && hold > now && prev) {
					s.volume = prev.volume;
					s.muted = prev.muted;
				}
				if (!this.#icons.has(s.name)) void this.#loadIcon(s.name);
				if (s.active) {
					this.#lastActive.set(s.name, now);
					if (!this.#firstActive.has(s.name)) this.#firstActive.set(s.name, this.#firstActive.size);
				}
			}
			const json = JSON.stringify(list);
			this.sessions = list;
			// the Auto list also changes just with time passing (an app leaves after AUTO_LINGER_MS of silence)
			const autoSig = this.autoList().map((s) => s.name).join(",");
			if (json !== this.#lastJson || autoSig !== this.#autoSig) {
				this.#lastJson = json;
				this.#autoSig = autoSig;
				this.notify();
			}
		} catch (err) {
			streamDeck.logger.error(`Reading audio sessions failed: ${err}`);
		} finally {
			this.#polling = false;
		}
	}

	async #loadIcon(name: string): Promise<void> {
		if (this.#iconRequests.has(name)) return;
		this.#iconRequests.add(name);
		try {
			this.#icons.set(name, await this.helper.icon(name));
			this.notify();
		} catch (err) {
			streamDeck.logger.warn(`Icon not available for ${name}: ${err}`);
			this.#icons.set(name, null);
		} finally {
			this.#iconRequests.delete(name);
		}
	}

	/** Base64 PNG of the icon (without prefix); null if unavailable, undefined if not loaded yet. */
	icon(name: string): string | null | undefined {
		return this.#icons.get(name);
	}

	/** Sessions not excluded by the blacklist/whitelist (no other filters). */
	#allowed(): AudioSession[] {
		const g = this.global;
		const hidden = new Set(g.hidden ?? []);
		const allowed = new Set(g.allowed ?? []);
		return this.sessions.filter((s) => (g.filterMode === "whitelist" ? allowed.has(s.name) : !hidden.has(s.name)));
	}

	#rank(s: AudioSession): number {
		const i = (this.global.order ?? []).indexOf(s.name);
		return i < 0 ? Number.MAX_SAFE_INTEGER : i;
	}

	/** Sessions shown on the keys: applies blacklist/whitelist, the "only playing" filter and the ordering. */
	visible(): AudioSession[] {
		const list = this.#allowed().filter((s) => !this.global.onlyPlaying || s.active);
		return list.sort((a, b) => this.#rank(a) - this.#rank(b) || a.label.localeCompare(b.label, "en"));
	}

	/**
	 * List for the Auto profile: only the apps that are playing audio (plus the ones that stopped less than
	 * AUTO_LINGER_MS ago, so they do not vanish at every pause), or every app when `autoSource` is "all".
	 * Honours the blacklist/whitelist. Order: the one chosen in the panel, otherwise the order in which the
	 * apps started playing, so the keys do not get shuffled.
	 */
	autoList(): AudioSession[] {
		const now = Date.now();
		const all = this.global.autoSource === "all";
		return this.#allowed()
			.filter((s) => all || s.active || now - (this.#lastActive.get(s.name) ?? 0) < AUTO_LINGER_MS)
			.sort(
				(a, b) =>
					this.#rank(a) - this.#rank(b) ||
					(this.#firstActive.get(a.name) ?? 1e9) - (this.#firstActive.get(b.name) ?? 1e9) ||
					a.label.localeCompare(b.label, "en"),
			);
	}

	/** Current page (0-based) of the Auto profile on a device. */
	page(deviceId: string): number {
		return this.#pages.get(deviceId) ?? 0;
	}

	setPage(deviceId: string, page: number): void {
		this.#pages.set(deviceId, Math.max(0, page));
		this.notify();
	}

	find(name: string): AudioSession | undefined {
		return this.sessions.find((s) => s.name === name);
	}

	async changeVolume(name: string, delta: number): Promise<void> {
		const s = this.find(name);
		if (!s) return;
		await this.setVolume(name, s.volume + delta);
	}

	async setVolume(name: string, volume: number): Promise<void> {
		const s = this.find(name);
		if (!s) return;
		s.volume = Math.max(0, Math.min(100, Math.round(volume)));
		// raising the volume of a muted app unmutes it, like the Windows mixer does
		const unmute = s.muted && s.volume > 0;
		if (unmute) s.muted = false;
		this.#holdUntil.set(name, Date.now() + 1500);
		this.notify();
		try {
			await this.helper.setVolume(name, s.volume);
			if (unmute) await this.helper.setMute(name, false);
		} catch (err) {
			streamDeck.logger.error(`Setting the volume failed for ${name}: ${err}`);
		}
	}

	async toggleMute(name: string): Promise<void> {
		const s = this.find(name);
		if (!s) return;
		s.muted = !s.muted;
		this.#holdUntil.set(name, Date.now() + 1500);
		this.notify();
		try {
			await this.helper.setMute(name, s.muted);
		} catch (err) {
			streamDeck.logger.error(`Mute failed for ${name}: ${err}`);
		}
	}
}

export const mixer = new Mixer();
