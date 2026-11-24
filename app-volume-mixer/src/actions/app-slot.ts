import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import { sendSessionsToInspector } from "../inspector.js";
import { resolveSession, slots, type AppSettings, type SlotAction } from "../layout.js";
import { mixer } from "../mixer.js";
import { renderKey } from "../render.js";

type SendToPluginEv = Parameters<NonNullable<SingletonAction<AppSettings>["onSendToPlugin"]>>[0];

/**
 * "App" key: shows the icon and volume (or "MUTE") of an audio process; pressing it mutes / unmutes the app.
 * Volume slider keys placed below it in the same column act on this app.
 */
@action({ UUID: "dev.appmixer.volume.app" })
export class AppSlotAction extends SingletonAction<AppSettings> {
	/** Last image sent per instance, to avoid redrawing needlessly. */
	readonly #rendered = new Map<string, string>();

	constructor() {
		super();
		mixer.subscribe(() => this.renderAll());
	}

	override onWillAppear(ev: WillAppearEvent<AppSettings>): void {
		if (!ev.action.isKey() || ev.action.isInMultiAction()) return;
		slots.set(ev.action.id, { action: ev.action as SlotAction, settings: ev.payload.settings ?? {} });
		this.#rendered.delete(ev.action.id);
		void ev.action.setTitle("");
		mixer.notify(); // the number of keys changed => positions change
	}

	override onWillDisappear(ev: WillDisappearEvent<AppSettings>): void {
		slots.delete(ev.action.id);
		this.#rendered.delete(ev.action.id);
		mixer.notify();
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<AppSettings>): void {
		const entry = slots.get(ev.action.id);
		if (entry) entry.settings = ev.payload.settings ?? {};
		mixer.notify();
	}

	override async onKeyDown(ev: KeyDownEvent<AppSettings>): Promise<void> {
		const entry = slots.get(ev.action.id);
		const session = entry ? resolveSession(entry).session : undefined;
		if (session) await mixer.toggleMute(session.name);
		else await ev.action.showAlert();
	}

	override async onSendToPlugin(ev: SendToPluginEv): Promise<void> {
		const payload = ev.payload as { type?: string } | null;
		if (payload?.type === "getSessions") await sendSessionsToInspector(true);
	}

	renderAll(): void {
		for (const entry of slots.values()) {
			const { session, name } = resolveSession(entry);
			const icon = name ? mixer.icon(name) : undefined;
			const image = renderKey({ session, icon, fallbackName: entry.settings.mode === "fixed" ? name : undefined });
			const a = entry.action;
			if (this.#rendered.get(a.id) === image) continue;
			this.#rendered.set(a.id, image);
			a.setImage(image).catch((err) => streamDeck.logger.error(`setImage: ${err}`));
		}
	}
}
