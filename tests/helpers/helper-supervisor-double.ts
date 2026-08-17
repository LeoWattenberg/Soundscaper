/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The in-process helper channel and clock the supervision suites drive.
 *
 * Every supervision rule is a timing rule — handshake, heartbeat, cancellation
 * budget, quarantine window — so the suite owns the clock rather than waiting on
 * one. The channel stands in for an Electron utility process without platform
 * authority, which is what lets the fault paths be exercised at all: a real
 * helper cannot be asked to answer out of phase.
 */

import { HELPER_CONTRACT_VERSION, type HelperHostMessage } from '../../desktop/helper-contract.ts';
import {
	HelperSupervisionError,
	HelperSupervisor,
	type HelperChannel,
} from '../../desktop/helper-supervisor.ts';

export const JOB_KIND = 'probe-video-source' as const;

export const GRANT = Object.freeze({
	mediaPath: '/media/example.mp4',
	mediaBytes: 2_048,
	identity: Object.freeze({ dev: 3, ino: 42 }),
});

export class FakeTimers {
	now = 0;
	#timers = new Map<number, { at: number; handler: () => void }>();
	#sequence = 0;

	setTimeout = (handler: () => void, delayMs: number) => {
		this.#sequence += 1;
		this.#timers.set(this.#sequence, { at: this.now + delayMs, handler });
		return this.#sequence as unknown as ReturnType<typeof setTimeout>;
	};

	clearTimeout = (timer: unknown) => {
		this.#timers.delete(timer as number);
	};

	advance(byMs: number): void {
		const target = this.now + byMs;
		for (;;) {
			const due = [...this.#timers.entries()]
				.filter(([, entry]) => entry.at <= target)
				.sort(([, left], [, right]) => left.at - right.at)[0];
			if (!due) break;
			this.now = due[1].at;
			this.#timers.delete(due[0]);
			due[1].handler();
		}
		this.now = target;
	}
}

export class FakeChannel implements HelperChannel {
	readonly posted: HelperHostMessage[] = [];
	killed = 0;
	autoHello = true;
	kinds: readonly string[] = [JOB_KIND];
	throwOnPost = false;
	#messageListener: ((message: unknown) => void) | null = null;
	#exitListener: ((code: number | null) => void) | null = null;

	postMessage(message: HelperHostMessage): void {
		if (this.throwOnPost) throw new Error('channel closed');
		this.posted.push(message);
	}

	onMessage(listener: (message: unknown) => void): void {
		this.#messageListener = listener;
		// A real utility process cannot deliver messages before the listener
		// exists; the double greets as soon as supervision starts listening.
		if (this.autoHello) queueMicrotask(() => this.hello());
	}

	onExit(listener: (code: number | null) => void): void {
		this.#exitListener = listener;
	}

	kill(): void {
		this.killed += 1;
	}

	receive(message: unknown): void {
		this.#messageListener?.(message);
	}

	hello(): void {
		this.receive({ contractVersion: HELPER_CONTRACT_VERSION, type: 'hello', kinds: [...this.kinds] });
	}

	exit(code: number | null): void {
		this.#exitListener?.(code);
	}
}

export function createHarness(options: Readonly<{
	verifyBinary?: () => Promise<void>;
	sampleRss?: () => number | null;
	quarantineCrashLimit?: number;
	autoHello?: boolean;
	kinds?: readonly string[];
	completeSpawn?: (channel: FakeChannel) => HelperChannel | Promise<HelperChannel>;
}> = {}) {
	const timers = new FakeTimers();
	const channels: FakeChannel[] = [];
	let jobSequence = 0;
	const supervisor = new HelperSupervisor({
		spawn: () => {
			const channel = new FakeChannel();
			channel.autoHello = options.autoHello ?? true;
			if (options.kinds) channel.kinds = options.kinds;
			channels.push(channel);
			return options.completeSpawn?.(channel) ?? channel;
		},
		verifyBinary: options.verifyBinary ?? (async () => {}),
		mintJobId: () => (++jobSequence).toString(16).padStart(40, '0'),
		sampleRss: options.sampleRss,
		quarantineCrashLimit: options.quarantineCrashLimit,
		now: () => timers.now,
		setTimeoutImpl: timers.setTimeout as typeof setTimeout,
		clearTimeoutImpl: timers.clearTimeout as typeof clearTimeout,
	});
	return { supervisor, timers, channels, latest: () => channels.at(-1)! };
}

export function supervisionCause(error: unknown): string | null {
	return error instanceof HelperSupervisionError ? error.cause_ : null;
}

export function settled(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}
