import type { AudioSession } from "./audio-helper.js";

const SIZE = 144;

function esc(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function truncate(s: string, max: number): string {
	return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function svg(body: string): string {
	const doc =
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
		body +
		`</svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(doc, "utf8").toString("base64")}`;
}

/** Generic speaker icon, used when the icon of the executable cannot be extracted. */
function fallbackIcon(x: number, y: number, s: number): string {
	const k = s / 64;
	return (
		`<g transform="translate(${x} ${y}) scale(${k})" fill="#9aa4b2">` +
		`<path d="M8 24h12l16-14v44L20 40H8z"/>` +
		`<path d="M44 20c6 6 6 18 0 24" stroke="#9aa4b2" stroke-width="5" fill="none" stroke-linecap="round"/>` +
		`<path d="M51 13c10 10 10 28 0 38" stroke="#9aa4b2" stroke-width="5" fill="none" stroke-linecap="round"/>` +
		`</g>`
	);
}

function iconMarkup(icon: string | null | undefined, x: number, y: number, s: number, opacity = 1): string {
	if (!icon) return `<g opacity="${opacity}">${fallbackIcon(x, y, s)}</g>`;
	return `<image x="${x}" y="${y}" width="${s}" height="${s}" opacity="${opacity}" xlink:href="data:image/png;base64,${icon}" href="data:image/png;base64,${icon}"/>`;
}

export type KeyView = {
	session: AudioSession | undefined;
	/** Name to show when the session is not running (fixed process mode). */
	fallbackName?: string;
	icon: string | null | undefined;
};

/** Key image: process icon plus the volume percentage ("MUTE" when muted). */
export function renderKey(view: KeyView): string {
	const { session } = view;
	if (!session && !view.fallbackName) {
		return svg(`<rect width="144" height="144" fill="#111"/><text x="72" y="82" font-family="Segoe UI, Arial" font-size="30" fill="#333" text-anchor="middle">—</text>`);
	}

	const name = truncate(session?.label ?? view.fallbackName ?? "", 13);
	const parts: string[] = [];
	const muted = session?.muted ?? false;
	parts.push(`<rect width="144" height="144" fill="${muted ? "#3a1214" : "#141414"}"/>`);

	if (!session) {
		parts.push(iconMarkup(view.icon, 42, 10, 60, 0.35));
		parts.push(`<text x="72" y="96" font-family="Segoe UI, Arial" font-size="17" fill="#777" text-anchor="middle">${esc(name)}</text>`);
		parts.push(`<text x="72" y="124" font-family="Segoe UI, Arial" font-size="17" fill="#666" text-anchor="middle">inactive</text>`);
		return svg(parts.join(""));
	}

	// just a big icon plus the percentage (or "MUTE" when the app is muted)
	parts.push(iconMarkup(view.icon, 41, 17, 62, muted ? 0.45 : 1));
	if (muted) {
		parts.push(`<line x1="42" y1="78" x2="102" y2="18" stroke="#ff4d4f" stroke-width="6" stroke-linecap="round"/>`);
	}
	parts.push(
		`<text x="72" y="118" font-family="Segoe UI, Arial" font-size="${muted ? 22 : 24}" font-weight="bold" fill="${muted ? "#ff6b6b" : "#ffffff"}" text-anchor="middle">${muted ? "MUTE" : `${session.volume}%`}</text>`,
	);
	return svg(parts.join(""));
}

type Pt = [number, number];

/** Outline (polygon) of a rectangle with rounded corners only at the top and/or bottom, sampled in segments. */
function trackPolygon(x: number, w: number, top: number, bottom: number, rTop: number, rBot: number): Pt[] {
	const N = 12;
	const pts: Pt[] = [];
	const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
		for (let k = 0; k <= N; k++) {
			const a = ((a0 + ((a1 - a0) * k) / N) * Math.PI) / 180;
			pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
		}
	};
	arc(x + w - rTop, top + rTop, rTop, -90, 0); // top right
	arc(x + w - rBot, bottom - rBot, rBot, 0, 90); // bottom right
	arc(x + rBot, bottom - rBot, rBot, 90, 180); // bottom left
	arc(x + rTop, top + rTop, rTop, 180, 270); // top left
	return pts;
}

/** Keeps only the part of the polygon with y >= yMin (Sutherland-Hodgman against a single half-plane). */
function clipBelow(pts: Pt[], yMin: number): Pt[] {
	const out: Pt[] = [];
	for (let k = 0; k < pts.length; k++) {
		const a = pts[k];
		const b = pts[(k + 1) % pts.length];
		const ai = a[1] >= yMin;
		const bi = b[1] >= yMin;
		if (ai) out.push(a);
		if (ai !== bi) {
			const f = (yMin - a[1]) / (b[1] - a[1]);
			out.push([a[0] + f * (b[0] - a[0]), yMin]);
		}
	}
	return out;
}

const polyAttr = (pts: Pt[]) => pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ");

/**
 * Segment of the vertical slider: `fill` (0-1) is the filled part of THIS key, `edge` tells whether it is the
 * top or bottom key of the stack. Shapes are drawn as polygons (no clipPath, which the Stream Deck renderer
 * may ignore), so the rounded corners always show up.
 */
export function renderSliderKey(fill: number, muted: boolean, active: boolean, edge: "top" | "bottom" | "middle" | "single", symbol?: "+" | "−"): string {
	const isTop = edge === "top" || edge === "single";
	const isBottom = edge === "bottom" || edge === "single";
	const trackTop = isTop ? 20 : 0;
	const trackBottom = isBottom ? 124 : 144;
	const x = 44;
	const w = 56;
	const r = 28; // half the width: fully rounded ends
	const color = !active ? "#444" : muted ? "#8a2d30" : "#2f9bff";
	const track = trackPolygon(x, w, trackTop, trackBottom, isTop ? r : 0, isBottom ? r : 0);
	const filled = Math.max(0, Math.min(1, fill));
	const yFill = trackBottom - (trackBottom - trackTop) * filled;
	const fillPoly = filled > 0 ? clipBelow(track, yFill) : [];
	return svg(
		`<rect width="144" height="144" fill="#141414"/>` +
			`<polygon points="${polyAttr(track)}" fill="#2a2a2a"/>` +
			(fillPoly.length > 2 ? `<polygon points="${polyAttr(fillPoly)}" fill="${color}"/>` : "") +
			(symbol
				? `<path d="${symbol === "+" ? "M58 72h28M72 58v28" : "M58 72h28"}" stroke="#fff" stroke-width="9" stroke-linecap="round" fill="none" opacity="0.9"/>`
				: ""),
	);
}

/** Navigation keys of the Auto profile: "back" (previous profile), "next" / "prev" (pages). */
export function renderNavKey(kind: "back" | "next" | "prev", enabled: boolean, page = 0, pages = 1): string {
	if (!enabled) return svg(`<rect width="144" height="144" fill="#101010"/>`);
	const stroke = `stroke="#e6e6e6" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
	const label = (t: string) => `<text x="72" y="128" font-family="Segoe UI, Arial" font-size="20" fill="#9aa4b2" text-anchor="middle">${esc(t)}</text>`;
	let body: string;
	if (kind === "next") body = `<path d="M54 26 L90 62 L54 98" ${stroke}/>` + label(`${page + 1}/${pages}`);
	else if (kind === "prev") body = `<path d="M90 26 L54 62 L90 98" ${stroke}/>` + label(`${page + 1}/${pages}`);
	else body = `<path d="M96 36 H58 a22 22 0 0 0 0 44 H84 M72 24 L96 36 L72 48" ${stroke}/>` + label("Back");
	return svg(`<rect width="144" height="144" fill="#141414"/>${body}`);
}
