import type { Formatted } from "./metrics.js";

const SIZE = 144;
const FONT = "Segoe UI, Arial, sans-serif";

export const HISTORY = 60;

function esc(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function svg(body: string): string {
	const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${body}</svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(doc, "utf8").toString("base64")}`;
}

export type MetricView = {
	label: string;
	showLabel: boolean;
	text: Formatted;
	color: string;
	/** Sparkline samples, oldest first; null = no data at that moment. */
	history: Array<number | null>;
	range: [number, number];
	graph: "area" | "line" | "bars" | "off";
};

const GRAPH = { x: 6, y: 104, w: 132, h: 32 };

/** Sparkline as polygons / polylines (no clipPath: the Stream Deck renderer may ignore it). */
function sparkline(view: MetricView): string {
	const { x, y, w, h } = GRAPH;
	const [lo, hi] = view.range;
	const span = Math.max(1e-9, hi - lo);
	const data = view.history;
	const parts: string[] = [`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#1b1d22"/>`];
	// faint guide at 50%
	parts.push(`<line x1="${x}" y1="${y + h / 2}" x2="${x + w}" y2="${y + h / 2}" stroke="#2a2d34" stroke-width="1"/>`);
	if (view.graph === "off" || data.length < 2) return parts.join("");

	const step = w / (HISTORY - 1);
	const x0 = x + w - (data.length - 1) * step; // newest sample on the right edge
	const yOf = (v: number) => y + h - Math.max(0, Math.min(1, (v - lo) / span)) * (h - 2) - 1;

	if (view.graph === "bars") {
		const bw = Math.max(1, step - 0.6);
		data.forEach((v, i) => {
			if (v === null) return;
			const top = yOf(v);
			parts.push(`<rect x="${(x0 + i * step - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${(y + h - top).toFixed(1)}" fill="${view.color}" opacity="0.85"/>`);
		});
		return parts.join("");
	}

	// continuous runs of samples (a null breaks the line)
	let run: Array<[number, number]> = [];
	const flush = () => {
		if (run.length >= 2) {
			const pts = run.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
			if (view.graph === "area") {
				const first = run[0][0].toFixed(1);
				const last = run[run.length - 1][0].toFixed(1);
				parts.push(`<polygon points="${first},${y + h} ${pts} ${last},${y + h}" fill="${view.color}" opacity="0.30"/>`);
			}
			parts.push(`<polyline points="${pts}" fill="none" stroke="${view.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
		}
		run = [];
	};
	data.forEach((v, i) => {
		if (v === null) flush();
		else run.push([x0 + i * step, yOf(v)]);
	});
	flush();
	return parts.join("");
}

/** Key image: label, big value, second line and sparkline. */
export function renderMetric(view: MetricView): string {
	const { text } = view;
	const parts: string[] = [`<rect width="${SIZE}" height="${SIZE}" fill="#101114"/>`];
	if (view.showLabel) {
		parts.push(`<text x="72" y="22" font-family="${FONT}" font-size="17" font-weight="600" fill="#9aa4b2" text-anchor="middle">${esc(view.label)}</text>`);
	}
	const valueY = view.showLabel ? 68 : 60;
	const bigColor = text.na ? "#6b7280" : view.color;
	const len = text.big.length + (text.suffix ? 1 : 0);
	const size = len <= 3 ? 46 : len === 4 ? 38 : len === 5 ? 32 : 26;
	if (text.suffix) {
		parts.push(
			`<text x="72" y="${valueY}" font-family="${FONT}" text-anchor="middle" fill="${bigColor}">` +
				`<tspan font-size="${size}" font-weight="700">${esc(text.big)}</tspan><tspan font-size="${Math.round(size * 0.45)}" font-weight="600" dx="2">${esc(text.suffix)}</tspan></text>`,
		);
	} else {
		parts.push(`<text x="72" y="${valueY}" font-family="${FONT}" font-size="${size}" font-weight="700" fill="${bigColor}" text-anchor="middle">${esc(text.big)}</text>`);
	}
	if (text.sub) {
		const subSize = text.sub.length > 12 ? 13 : 15;
		parts.push(`<text x="72" y="${valueY + 26}" font-family="${FONT}" font-size="${subSize}" fill="#b8c0cc" text-anchor="middle">${esc(text.sub)}</text>`);
	}
	if (!text.na) parts.push(sparkline(view));
	else parts.push(sparkline({ ...view, history: [], graph: "off" }));
	return svg(parts.join(""));
}

/** Key shown while the helper is not delivering data. */
export function renderIdle(label: string, message: string): string {
	return svg(
		`<rect width="${SIZE}" height="${SIZE}" fill="#101114"/>` +
			`<text x="72" y="22" font-family="${FONT}" font-size="17" font-weight="600" fill="#9aa4b2" text-anchor="middle">${esc(label)}</text>` +
			`<text x="72" y="76" font-family="${FONT}" font-size="26" font-weight="700" fill="#4b5563" text-anchor="middle">…</text>` +
			`<text x="72" y="104" font-family="${FONT}" font-size="14" fill="#6b7280" text-anchor="middle">${esc(message)}</text>`,
	);
}

/** "Back" key of the dashboard profile. */
export function renderBackKey(): string {
	const stroke = `stroke="#e6e6e6" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
	return svg(
		`<rect width="144" height="144" fill="#141414"/><path d="M96 36 H58 a22 22 0 0 0 0 44 H84 M72 24 L96 36 L72 48" ${stroke}/>` +
			`<text x="72" y="128" font-family="${FONT}" font-size="20" fill="#9aa4b2" text-anchor="middle">Back</text>`,
	);
}
