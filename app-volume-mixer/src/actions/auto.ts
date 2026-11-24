import streamDeck, { action, type KeyAction, type KeyDownEvent, SingletonAction, type WillAppearEvent } from "@elgato/streamdeck";
import { autoPage, autoPageCount } from "../layout.js";
import { mixer } from "../mixer.js";
import { renderNavKey } from "../render.js";

/** Name of the profile bundled with the plugin: must match `Profiles[].Name` in the manifest (path without extension). */
export const AUTO_PROFILE = "App Mixer Auto";

type NoSettings = Record<string, never>;

/** "Auto" key: switches to the Auto profile (every app that is playing audio, with pages). */
@action({ UUID: "dev.appmixer.volume.auto" })
export class AutoAction extends SingletonAction<NoSettings> {
	override async onKeyDown(ev: KeyDownEvent<NoSettings>): Promise<void> {
		mixer.setPage(ev.action.device.id, 0);
		try {
			await streamDeck.profiles.switchToProfile(ev.action.device.id, AUTO_PROFILE);
		} catch (err) {
			streamDeck.logger.error(`Profile switch failed: ${err}`);
			await ev.action.showAlert();
		}
	}
}

/** Base of the three navigation keys in the left column of the Auto profile. */
abstract class NavAction extends SingletonAction<NoSettings> {
	abstract readonly kind: "back" | "next" | "prev";
	readonly #rendered = new Map<string, string>();

	constructor() {
		super();
		mixer.subscribe(() => this.renderAll());
	}

	override onWillAppear(ev: WillAppearEvent<NoSettings>): void {
		this.#rendered.delete(ev.action.id);
		if (ev.action.isKey()) void ev.action.setTitle("");
		this.renderAll();
	}

	override async onKeyDown(ev: KeyDownEvent<NoSettings>): Promise<void> {
		const device = ev.action.device.id;
		if (this.kind === "back") {
			await streamDeck.profiles.switchToProfile(device); // no name: goes back to the previous profile
			return;
		}
		const page = autoPage(device);
		const pages = autoPageCount(device);
		if (this.kind === "next" && page < pages - 1) mixer.setPage(device, page + 1);
		else if (this.kind === "prev" && page > 0) mixer.setPage(device, page - 1);
		else await ev.action.showAlert();
	}

	renderAll(): void {
		for (const a of this.actions) {
			if (!a.isKey()) continue;
			const key = a as KeyAction<NoSettings>;
			const device = key.device.id;
			const page = autoPage(device);
			const pages = autoPageCount(device);
			// "next" only if another page exists, "previous" only if we are not on the first one
			const enabled = this.kind === "back" || (this.kind === "next" ? page < pages - 1 : page > 0);
			const image = renderNavKey(this.kind, enabled, page, pages);
			if (this.#rendered.get(key.id) === image) continue;
			this.#rendered.set(key.id, image);
			key.setImage(image).catch((err) => streamDeck.logger.error(`setImage: ${err}`));
		}
	}
}

@action({ UUID: "dev.appmixer.volume.back" })
export class BackAction extends NavAction {
	readonly kind = "back" as const;
}

@action({ UUID: "dev.appmixer.volume.next-page" })
export class NextPageAction extends NavAction {
	readonly kind = "next" as const;
}

@action({ UUID: "dev.appmixer.volume.prev-page" })
export class PrevPageAction extends NavAction {
	readonly kind = "prev" as const;
}
