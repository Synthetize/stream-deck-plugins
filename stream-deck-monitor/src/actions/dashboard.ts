import streamDeck, { action, type KeyDownEvent, SingletonAction, type WillAppearEvent } from "@elgato/streamdeck";
import { renderBackKey } from "../render.js";

/** Name of the bundled profile: must match `Profiles[].Name` in the manifest (path without extension). */
export const DASHBOARD_PROFILE = "Monitor Dashboard";

type NoSettings = Record<string, never>;

/** Key that switches to the bundled "Monitor Dashboard" profile (all metrics on a 15-key Stream Deck). */
@action({ UUID: "dev.sdmonitor.dashboard" })
export class DashboardAction extends SingletonAction<NoSettings> {
	override async onKeyDown(ev: KeyDownEvent<NoSettings>): Promise<void> {
		try {
			await streamDeck.profiles.switchToProfile(ev.action.device.id, DASHBOARD_PROFILE);
		} catch (err) {
			streamDeck.logger.error(`Profile switch failed: ${err}`);
			await ev.action.showAlert();
		}
	}
}

/** Key that goes back to the previous profile (placed in the dashboard profile). */
@action({ UUID: "dev.sdmonitor.back" })
export class BackAction extends SingletonAction<NoSettings> {
	override onWillAppear(ev: WillAppearEvent<NoSettings>): void {
		if (!ev.action.isKey()) return;
		void ev.action.setTitle("");
		void ev.action.setImage(renderBackKey());
	}

	override async onKeyDown(ev: KeyDownEvent<NoSettings>): Promise<void> {
		await streamDeck.profiles.switchToProfile(ev.action.device.id); // no name: back to the previous profile
	}
}
