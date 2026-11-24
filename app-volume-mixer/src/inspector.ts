import streamDeck from "@elgato/streamdeck";
import { mixer } from "./mixer.js";

let lastSent = "";

/**
 * Sends the Property Inspector the list of ALL detected processes (including hidden ones), plus the ones
 * mentioned in the global settings that are not running right now, so they can be shown again.
 * With `force` = false it only sends when the list (names/labels/icons) has changed.
 */
export async function sendSessionsToInspector(force: boolean): Promise<void> {
	if (!streamDeck.ui.action) return;
	const g = mixer.global;
	const items = mixer.sessions.map((s) => ({ name: s.name, label: s.label, running: true, icon: mixer.icon(s.name) ?? null }));
	const known = new Set(items.map((i) => i.name));
	for (const name of [...(g.hidden ?? []), ...(g.allowed ?? []), ...(g.order ?? [])]) {
		if (known.has(name)) continue;
		known.add(name);
		items.push({ name, label: name === "system" ? "System sounds" : name, running: false, icon: mixer.icon(name) ?? null });
	}
	const sig = JSON.stringify(items.map((i) => [i.name, i.label, i.running, i.icon ? i.icon.length : 0]));
	if (!force && sig === lastSent) return;
	lastSent = sig;
	await streamDeck.ui.sendToPropertyInspector({ type: "sessions", sessions: items });
}
