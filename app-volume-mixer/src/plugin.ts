import streamDeck from "@elgato/streamdeck";
import { AppSlotAction } from "./actions/app-slot.js";
import { AutoAction, BackAction, NextPageAction, PrevPageAction } from "./actions/auto.js";
import { SliderAction } from "./actions/slider.js";
import { sendSessionsToInspector } from "./inspector.js";
import { mixer } from "./mixer.js";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new AppSlotAction());
streamDeck.actions.registerAction(new SliderAction());
streamDeck.actions.registerAction(new AutoAction());
streamDeck.actions.registerAction(new BackAction());
streamDeck.actions.registerAction(new NextPageAction());
streamDeck.actions.registerAction(new PrevPageAction());

// Keeps the list in the Property Inspector up to date when processes appear/disappear.
mixer.subscribe(() => void sendSessionsToInspector(false).catch(() => undefined));

process.on("exit", () => mixer.stop());

await streamDeck.connect();
await mixer.start();
