import streamDeck from "@elgato/streamdeck";
import { BackAction, DashboardAction } from "./actions/dashboard.js";
import { MetricAction } from "./actions/metric.js";
import { helper } from "./helper.js";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new MetricAction());
streamDeck.actions.registerAction(new DashboardAction());
streamDeck.actions.registerAction(new BackAction());

process.on("exit", () => helper.stop());

await streamDeck.connect();
helper.start();
