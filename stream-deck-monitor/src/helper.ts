import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import streamDeck from "@elgato/streamdeck";

/** One sample as printed by SensorHelper.exe (null = not available). */
export type Sample = {
	cpu: number | null;
	ram: number | null;
	ramUsed: number | null;
	ramTotal: number | null;
	gpu: number | null;
	vram: number | null;
	vramUsed: number | null;
	vramTotal: number | null;
	disk: number | null;
	diskRead: number | null;
	diskWrite: number | null;
	netDown: number | null;
	netUp: number | null;
	/** Round-trip time of the last ping in ms (null = timed out / disabled). */
	ping: number | null;
	/** Packet loss over the last 60 pings, %. */
	loss: number | null;
	pingHost: string;
	fps: number | null;
	fpsApp: string | null;
	/** ok | idle (RTSS running, no game rendering) | no-rtss */
	fpsState: string;
	cpuTemp: number | null;
	gpuTemp: number | null;
	/** ok | not-installed | starting | no-driver | unsupported | no-lib */
	tempStatus: string;
	tempDetail: string | null;
	pawnio: boolean;
};

type Listener = (sample: Sample) => void;

const exePath = join(dirname(fileURLToPath(import.meta.url)), "SensorHelper.exe");

/**
 * Client for SensorHelper.exe: a persistent process that prints one JSON sample per line.
 * It is restarted automatically if it exits.
 */
export class SensorHelper {
	#proc: ChildProcessWithoutNullStreams | undefined;
	#listeners = new Set<Listener>();
	#interval = 1000;
	#stopped = false;
	#restartTimer: NodeJS.Timeout | undefined;
	#last: Sample | undefined;
	#pingCmd = "ping off";

	get last(): Sample | undefined {
		return this.#last;
	}

	get running(): boolean {
		return !!this.#proc && this.#proc.exitCode === null;
	}

	subscribe(listener: Listener): void {
		this.#listeners.add(listener);
	}

	start(): void {
		this.#stopped = false;
		if (this.running) return;
		const proc = spawn(exePath, [], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
		proc.stdin.setDefaultEncoding("utf8");
		proc.stdin.on("error", () => undefined);
		createInterface({ input: proc.stdout }).on("line", (line) => this.#onLine(line));
		proc.stderr.on("data", (d) => streamDeck.logger.warn(`SensorHelper stderr: ${d}`));
		proc.on("error", (err) => streamDeck.logger.error(`SensorHelper could not be started (${exePath}): ${err.message}`));
		proc.on("exit", (code) => {
			streamDeck.logger.warn(`SensorHelper exited (code ${code})`);
			if (this.#proc === proc) this.#proc = undefined;
			this.#last = undefined;
			for (const l of this.#listeners) l(undefined as unknown as Sample);
			if (!this.#stopped) this.#restartTimer = setTimeout(() => this.start(), 3000);
		});
		this.#proc = proc;
		this.#send(`interval ${this.#interval}`);
		this.#send(this.#pingCmd);
	}

	stop(): void {
		this.#stopped = true;
		clearTimeout(this.#restartTimer);
		if (this.#proc) {
			this.#send("quit");
			this.#proc.kill();
		}
	}

	/** Sampling interval in ms (the helper clamps it to 250-10000). */
	setInterval(ms: number): void {
		if (ms === this.#interval) return;
		this.#interval = ms;
		this.#send(`interval ${ms}`);
	}

	/** Enables the ping to host (null = disabled; no traffic is sent). */
	setPing(host: string | null): void {
		this.#pingCmd = host ? `ping on ${host}` : "ping off";
		this.#send(this.#pingCmd);
	}

	/** Makes the helper look again for the scheduled task (after the one-time setup). */
	rescan(): void {
		this.#send("rescan");
	}

	#send(cmd: string): void {
		if (this.running) this.#proc!.stdin.write(`${cmd}\n`);
	}

	#onLine(line: string): void {
		let msg: any;
		try {
			msg = JSON.parse(line);
		} catch {
			streamDeck.logger.warn(`SensorHelper: invalid line: ${line.slice(0, 200)}`);
			return;
		}
		if (msg.type === "sample") {
			this.#last = msg as Sample;
			for (const l of this.#listeners) l(this.#last);
		} else if (msg.type === "error") {
			streamDeck.logger.warn(`SensorHelper error: ${msg.message}`);
		}
	}
}

export const helper = new SensorHelper();

/**
 * Runs `SensorHelper.exe <arg>` elevated (one UAC prompt) and resolves with its exit code.
 * Exit codes: 0 = ok, 1223 = the user cancelled the UAC prompt, anything else = failure.
 */
export function runElevated(arg: "--install-task" | "--uninstall-task"): Promise<number> {
	return new Promise((resolve) => {
		const quoted = exePath.replace(/'/g, "''");
		const script =
			`try { $p = Start-Process -FilePath '${quoted}' -ArgumentList '${arg}' -Verb RunAs -WindowStyle Hidden -PassThru -Wait; exit $p.ExitCode } ` +
			`catch { exit 1223 }`;
		const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
		ps.on("error", () => resolve(1));
		ps.on("exit", (code) => resolve(code ?? 1));
	});
}
