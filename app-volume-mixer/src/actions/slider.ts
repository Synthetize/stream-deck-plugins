import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	type KeyUpEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import { sendSessionsToInspector } from "../inspector.js";
import { appAbove, appRowAbove, appRowBelow } from "../layout.js";
import { mixer } from "../mixer.js";
import { renderSliderKey } from "../render.js";

type SliderSettings = { step?: number; [key: string]: string | number | boolean | undefined };
type SendToPluginEv = Parameters<NonNullable<SingletonAction<SliderSettings>["onSendToPlugin"]>>[0];
type Segment = { index: number; count: number; session: ReturnType<typeof appAbove> };

const DEFAULT_STEP = 5;
const REPEAT_DELAY_MS = 450;
const REPEAT_MS = 130;

/**
 * Vertical volume slider: "Volume slider" keys stacked one below the other, in the column of an App key.
 * The bar spans all the keys and fills up according to the volume.
 *  - 2 keys: the upper one RAISES the volume, the lower one LOWERS it (holding keeps changing it);
 *    the step is set in the panel.
 *  - 3 or more keys: pressing a segment sets the volume to that level (with 4 keys: 25/50/75/100%);
 *    pressing the segment that is already at its level lowers it by one, so you can reach zero.
 */
@action({ UUID: "dev.appmixer.volume.slider" })
export class SliderAction extends SingletonAction<SliderSettings> {
	readonly #rendered = new Map<string, string>();
	readonly #steps = new Map<string, number>();
	readonly #timers = new Map<string, { delay?: NodeJS.Timeout; repeat?: NodeJS.Timeout }>();

	constructor() {
		super();
		mixer.subscribe(() => this.renderAll());
	}

	override onWillAppear(ev: WillAppearEvent<SliderSettings>): void {
		this.#steps.set(ev.action.id, Number(ev.payload.settings?.step) || DEFAULT_STEP);
		this.#rendered.delete(ev.action.id);
		if (ev.action.isKey()) void ev.action.setTitle("");
		this.renderAll();
	}

	override onWillDisappear(ev: WillDisappearEvent<SliderSettings>): void {
		this.#stop(ev.action.id);
		this.#steps.delete(ev.action.id);
		this.#rendered.delete(ev.action.id);
		this.renderAll();
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<SliderSettings>): void {
		this.#steps.set(ev.action.id, Number(ev.payload.settings?.step) || DEFAULT_STEP);
	}

	override async onSendToPlugin(ev: SendToPluginEv): Promise<void> {
		const payload = ev.payload as { type?: string } | null;
		if (payload?.type === "getSessions") await sendSessionsToInspector(true);
	}

	/** Position of the key inside the slider stack of its column (index 1 = lowest key). */
	#segment(key: KeyAction<SliderSettings>): Segment | undefined {
		const c = key.coordinates;
		if (!c) return undefined;
		const device = key.device.id;
		const top = appRowAbove(device, c.row, c.column) ?? -1;
		const bottom = appRowBelow(device, c.row, c.column) ?? Number.MAX_SAFE_INTEGER;
		// slider keys of the same column between the app above and the next app below
		const rows: number[] = [];
		for (const a of this.actions) {
			const ac = a.isKey() ? a.coordinates : undefined;
			if (ac && a.device.id === device && ac.column === c.column && ac.row > top && ac.row < bottom) rows.push(ac.row);
		}
		rows.sort((a, b) => a - b);
		const pos = rows.indexOf(c.row);
		if (pos < 0) return undefined;
		return { index: rows.length - pos, count: rows.length, session: appAbove(device, c.row, c.column) };
	}

	override async onKeyDown(ev: KeyDownEvent<SliderSettings>): Promise<void> {
		const key = ev.action as KeyAction<SliderSettings>;
		const seg = this.#segment(key);
		const s = seg?.session?.session;
		if (!seg || !s) {
			await ev.action.showAlert();
			return;
		}

		if (seg.count === 2) {
			// upper key = +, lower key = −; holding keeps changing the volume
			const sign = seg.index === 2 ? 1 : -1;
			const apply = () => {
				const cur = this.#segment(key)?.session?.session;
				if (cur) void mixer.changeVolume(cur.name, sign * (this.#steps.get(key.id) ?? DEFAULT_STEP));
			};
			apply();
			const t: { delay?: NodeJS.Timeout; repeat?: NodeJS.Timeout } = {};
			t.delay = setTimeout(() => (t.repeat = setInterval(apply, REPEAT_MS)), REPEAT_DELAY_MS);
			this.#stop(key.id);
			this.#timers.set(key.id, t);
			return;
		}

		const levelStep = 100 / seg.count;
		let target = Math.round(seg.index * levelStep);
		if (Math.abs(s.volume - target) < 1) target = Math.round((seg.index - 1) * levelStep);
		await mixer.setVolume(s.name, target);
	}

	override onKeyUp(ev: KeyUpEvent<SliderSettings>): void {
		this.#stop(ev.action.id);
	}

	#stop(id: string): void {
		const t = this.#timers.get(id);
		if (!t) return;
		clearTimeout(t.delay);
		clearInterval(t.repeat);
		this.#timers.delete(id);
	}

	renderAll(): void {
		for (const a of this.actions) {
			if (!a.isKey()) continue;
			const key = a as KeyAction<SliderSettings>;
			const seg = this.#segment(key);
			const s = seg?.session?.session;
			let image: string;
			if (!seg) {
				image = renderSliderKey(0, false, false, "single");
			} else {
				const level = s ? (s.volume / 100) * seg.count : 0;
				const edge = seg.count === 1 ? "single" : seg.index === seg.count ? "top" : seg.index === 1 ? "bottom" : "middle";
				const symbol = seg.count === 2 ? (seg.index === 2 ? "+" : "−") : undefined;
				image = renderSliderKey(level - (seg.index - 1), !!s?.muted, !!s, edge, symbol);
			}
			if (this.#rendered.get(key.id) === image) continue;
			this.#rendered.set(key.id, image);
			key.setImage(image).catch((err) => streamDeck.logger.error(`setImage: ${err}`));
		}
	}
}
