import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import streamDeck from "@elgato/streamdeck";

/** Audio session (grouped by executable) as returned by AudioHelper.exe. */
export type AudioSession = {
	/** Key: lowercase executable name without ".exe" (e.g. "spotify"); "system" = system sounds. */
	name: string;
	/** Human readable name (description of the .exe file). */
	label: string;
	pid: number;
	/** Volume 0-100. */
	volume: number;
	muted: boolean;
	/** true if the session is playing audio right now. */
	active: boolean;
	path: string | null;
};

type Pending = { resolve: (value: any) => void; reject: (err: Error) => void; timer: NodeJS.Timeout };

/**
 * Client for AudioHelper.exe: a persistent process, text commands on stdin,
 * JSON replies on stdout (one per line) matched by id.
 * If the helper exits it is restarted on the next command.
 */
export class AudioHelper {
	readonly #exe = join(dirname(fileURLToPath(import.meta.url)), "AudioHelper.exe");
	#proc: ChildProcessWithoutNullStreams | undefined;
	#nextId = 1;
	readonly #pending = new Map<string, Pending>();

	#ensure(): ChildProcessWithoutNullStreams {
		if (this.#proc && this.#proc.exitCode === null && !this.#proc.killed) return this.#proc;

		const proc = spawn(this.#exe, [], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
		proc.stdin.setDefaultEncoding("utf8");
		createInterface({ input: proc.stdout }).on("line", (line) => this.#onLine(line));
		proc.stderr.on("data", (d) => streamDeck.logger.warn(`AudioHelper stderr: ${d}`));
		proc.on("error", (err) => {
			streamDeck.logger.error(`AudioHelper could not be started (${this.#exe}): ${err.message}`);
			this.#failAll(err);
		});
		proc.on("exit", (code) => {
			streamDeck.logger.warn(`AudioHelper exited (code ${code})`);
			if (this.#proc === proc) this.#proc = undefined;
			this.#failAll(new Error("AudioHelper exited"));
		});
		this.#proc = proc;
		return proc;
	}

	#onLine(line: string): void {
		let msg: any;
		try {
			msg = JSON.parse(line);
		} catch {
			streamDeck.logger.warn(`AudioHelper: invalid line: ${line.slice(0, 200)}`);
			return;
		}
		const pending = msg.id !== undefined ? this.#pending.get(String(msg.id)) : undefined;
		if (!pending) return;
		this.#pending.delete(String(msg.id));
		clearTimeout(pending.timer);
		if (msg.type === "error") pending.reject(new Error(msg.message));
		else pending.resolve(msg);
	}

	#failAll(err: Error): void {
		for (const [id, p] of this.#pending) {
			clearTimeout(p.timer);
			p.reject(err);
			this.#pending.delete(id);
		}
	}

	#send<T>(command: string, timeoutMs = 5000): Promise<T> {
		const proc = this.#ensure();
		const id = String(this.#nextId++);
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				reject(new Error(`AudioHelper: timeout on "${command}"`));
			}, timeoutMs);
			this.#pending.set(id, { resolve, reject, timer });
			proc.stdin.write(`#${id} ${command}\n`);
		});
	}

	async list(): Promise<AudioSession[]> {
		const res = await this.#send<{ sessions: AudioSession[] }>("list");
		return res.sessions;
	}

	/** Executable icon as base64 PNG (without the data: prefix), or null. */
	async icon(name: string): Promise<string | null> {
		const res = await this.#send<{ png: string | null }>(`icon ${name}`);
		return res.png;
	}

	async setVolume(name: string, volume: number): Promise<void> {
		await this.#send(`set ${name} ${Math.round(Math.max(0, Math.min(100, volume)))}`);
	}

	async setMute(name: string, muted: boolean): Promise<void> {
		await this.#send(`mute ${name} ${muted ? 1 : 0}`);
	}

	dispose(): void {
		if (this.#proc) {
			this.#proc.stdin.write("quit\n");
			this.#proc.kill();
		}
	}
}
