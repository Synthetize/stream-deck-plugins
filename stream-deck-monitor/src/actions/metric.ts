import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import { helper, runElevated, type Sample } from "../helper.js";
import { METRICS, METRIC_ORDER, stateColor, type MetricId, type MetricSettings } from "../metrics.js";
import { HISTORY, renderIdle, renderMetric } from "../render.js";

type SendToPluginEv = Parameters<NonNullable<SingletonAction<MetricSettings>["onSendToPlugin"]>>[0];

type Instance = {
	action: KeyAction<MetricSettings>;
	settings: MetricSettings;
	lastDraw: number;
	lastImage: string;
};

const DEFAULT_REFRESH = 1000;

/** Samples of every metric (oldest first), kept for all metrics so a new key immediately has a graph. */
const history = new Map<MetricId, Array<number | null>>(METRIC_ORDER.map((id) => [id, []]));

function metricOf(st: MetricSettings): MetricId {
	return st.metric && st.metric in METRICS ? st.metric : "cpu";
}

function refreshOf(st: MetricSettings): number {
	const n = Number(st.refresh);
	return Number.isFinite(n) && n >= 250 ? Math.min(10000, n) : DEFAULT_REFRESH;
}

/** What the Property Inspector needs to know about the sensors. */
function statusPayload(s: Sample | undefined) {
	return {
		type: "status",
		helperRunning: helper.running && !!s,
		tempStatus: s?.tempStatus ?? "unknown",
		tempDetail: s?.tempDetail ?? null,
		pawnio: s?.pawnio ?? false,
		fpsState: s?.fpsState ?? "unknown",
		fpsApp: s?.fpsApp ?? null,
		cpuTemp: s?.cpuTemp ?? null,
		gpuTemp: s?.gpuTemp ?? null,
	};
}

/** "Metric" key: shows one live metric (value + sparkline), chosen in the Property Inspector. */
@action({ UUID: "dev.sdmonitor.metric" })
export class MetricAction extends SingletonAction<MetricSettings> {
	readonly #instances = new Map<string, Instance>();
	#lastStatus = "";
	#pingHost = "";

	constructor() {
		super();
		helper.subscribe((s) => this.#onSample(s));
	}

	override onWillAppear(ev: WillAppearEvent<MetricSettings>): void {
		if (!ev.action.isKey()) return;
		const settings = ev.payload.settings ?? {};
		this.#instances.set(ev.action.id, { action: ev.action as KeyAction<MetricSettings>, settings, lastDraw: 0, lastImage: "" });
		void ev.action.setTitle("");
		this.#updateInterval();
		this.#draw(this.#instances.get(ev.action.id)!, helper.last, true);
	}

	override onWillDisappear(ev: WillDisappearEvent<MetricSettings>): void {
		this.#instances.delete(ev.action.id);
		this.#updateInterval();
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<MetricSettings>): void {
		const inst = this.#instances.get(ev.action.id);
		if (!inst) return;
		inst.settings = ev.payload.settings ?? {};
		if (inst.settings.pingHost?.trim()) this.#pingHost = inst.settings.pingHost.trim();
		this.#updateInterval();
		this.#draw(inst, helper.last, true);
	}

	override async onKeyDown(ev: KeyDownEvent<MetricSettings>): Promise<void> {
		const inst = this.#instances.get(ev.action.id);
		if (!inst) return;
		const def = METRICS[metricOf(inst.settings)];
		// Visual feedback when the value cannot be read (e.g. temperature sensors not set up)
		if (helper.last && def.read(helper.last) === null && def.id !== "fps" && def.id !== "frametime") await ev.action.showAlert();
		this.#draw(inst, helper.last, true);
	}

	override async onSendToPlugin(ev: SendToPluginEv): Promise<void> {
		const payload = ev.payload as { type?: string } | null;
		switch (payload?.type) {
			case "getStatus":
				await this.#sendStatus(true);
				break;
			case "installSensors":
			case "removeSensors": {
				const code = await runElevated(payload.type === "installSensors" ? "--install-task" : "--uninstall-task");
				helper.rescan();
				const message =
					code === 0 ? (payload.type === "installSensors" ? "Done. CPU temperature should appear within a few seconds." : "Removed.") : code === 1223 ? "Cancelled (UAC prompt declined)." : `Failed (exit code ${code}).`;
				await streamDeck.ui.sendToPropertyInspector({ type: "setupResult", ok: code === 0, message });
				break;
			}
		}
	}

	#updateInterval(): void {
		let min = Infinity;
		for (const inst of this.#instances.values()) min = Math.min(min, refreshOf(inst.settings));
		helper.setInterval(Number.isFinite(min) ? min : 2000);
		// Ping runs only while a ping / packet loss key is visible; the host of the last changed one is used.
		const pingKeys = [...this.#instances.values()].filter((i) => ["ping", "loss"].includes(metricOf(i.settings)));
		if (!pingKeys.length) helper.setPing(null);
		else {
			const host = (this.#pingHost || pingKeys.map((i) => i.settings.pingHost?.trim()).find(Boolean) || "1.1.1.1").trim();
			helper.setPing(host);
		}
	}

	#onSample(s: Sample | undefined): void {
		if (s) {
			for (const id of METRIC_ORDER) {
				const h = history.get(id)!;
				h.push(METRICS[id].read(s));
				if (h.length > HISTORY) h.shift();
			}
		}
		const now = Date.now();
		for (const inst of this.#instances.values()) {
			if (s && now - inst.lastDraw < refreshOf(inst.settings) - 100) continue;
			this.#draw(inst, s, false);
		}
		void this.#sendStatus(false);
	}

	#draw(inst: Instance, s: Sample | undefined, force: boolean): void {
		const id = metricOf(inst.settings);
		const def = METRICS[id];
		inst.lastDraw = Date.now();
		let image: string;
		if (!s) {
			image = renderIdle(def.label, "starting…");
		} else {
			const value = def.read(s);
			const h = history.get(id)!;
			const finite = h.filter((v): v is number => v !== null);
			let range: [number, number];
			if (def.range) range = def.range;
			else {
				const max = Math.max(def.minMax ?? 1, ...finite);
				range = [0, max * 1.1];
			}
			image = renderMetric({
				label: def.label,
				showLabel: inst.settings.showLabel !== false,
				text: def.format(value, s, inst.settings, finite),
				color: stateColor(def, inst.settings, value),
				history: h,
				range,
				graph: inst.settings.graph ?? "area",
			});
		}
		if (!force && image === inst.lastImage) return;
		inst.lastImage = image;
		inst.action.setImage(image).catch((err) => streamDeck.logger.error(`setImage: ${err}`));
	}

	async #sendStatus(force: boolean): Promise<void> {
		if (!streamDeck.ui.action) return;
		const payload = statusPayload(helper.last);
		const sig = JSON.stringify(payload);
		if (!force && sig === this.#lastStatus) return;
		this.#lastStatus = sig;
		await streamDeck.ui.sendToPropertyInspector(payload).catch(() => undefined);
	}
}
