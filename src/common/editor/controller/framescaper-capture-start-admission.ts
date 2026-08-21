/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperCaptureAdminInterlockLease } from './framescaper-capture-admin-interlock.ts';
import type { FramescaperCaptureOriginBinding } from './framescaper-capture-origin-guard.ts';
import type {
	FramescaperCaptureProjectFence,
	FramescaperCaptureSessionOrigin,
} from './framescaper-capture-session-types.ts';

export interface FramescaperCaptureStartOrigin {
	readonly projectFence: Readonly<FramescaperCaptureProjectFence>;
	readonly origin: Readonly<FramescaperCaptureSessionOrigin>;
}

export interface FramescaperCaptureStartAdmissionSnapshot {
	readonly generation: number;
	readonly origin: Readonly<FramescaperCaptureOriginBinding>;
}

export interface FramescaperCaptureStartAdmissionLease {
	readonly captured: Readonly<FramescaperCaptureStartOrigin>;
	prepare(): Promise<void>;
	release(): boolean;
}

export interface FramescaperCaptureStartAdmissionPort {
	readonly snapshot: Readonly<FramescaperCaptureStartAdmissionSnapshot> | null;
	begin(mode?: 'foreground' | 'background'): Readonly<FramescaperCaptureStartAdmissionLease>;
	captureOrigin(): Readonly<FramescaperCaptureStartOrigin>;
	settled(): Promise<void>;
	dispose(): void;
}

export interface FramescaperCaptureStartAdmissionOptions {
	captureOrigin(): Readonly<FramescaperCaptureStartOrigin>;
	beginCaptureAdmission(projectId: string): Readonly<FramescaperCaptureAdminInterlockLease>;
	prepareCaptureStart(): PromiseLike<void> | void;
	readonly onChange?: () => void;
}

interface ActiveAdmission {
	readonly generation: number;
	readonly captured: Readonly<FramescaperCaptureStartOrigin>;
	readonly exposed: Readonly<FramescaperCaptureStartAdmissionSnapshot>;
	readonly interlock: Readonly<FramescaperCaptureAdminInterlockLease>;
}

/** Freezes one app origin before asynchronous capture admission without opening media. */
export function createFramescaperCaptureStartAdmissionCoordinator(
	options: FramescaperCaptureStartAdmissionOptions,
): Readonly<FramescaperCaptureStartAdmissionPort> {
	let generation = 0;
	let active: Readonly<ActiveAdmission> | null = null;
	let disposed = false;
	let activeSettled: Promise<void> | null = null;
	let resolveActive: (() => void) | null = null;

	function begin(mode: 'foreground' | 'background' = 'foreground'): Readonly<FramescaperCaptureStartAdmissionLease> {
		if (disposed) throw new Error('Framescaper capture start admission is disposed.');
		if (mode !== 'foreground' && mode !== 'background') {
			throw new TypeError('Framescaper capture start admission mode is invalid.');
		}
		const captured = freezeOrigin(options.captureOrigin());
		const nextGeneration = generation + 1;
		if (!Number.isSafeInteger(nextGeneration)) {
			throw new RangeError('Framescaper capture start admission generation is exhausted.');
		}
		const interlock = options.beginCaptureAdmission(captured.projectFence.projectId);
		generation = nextGeneration;
		const current = Object.freeze({
			generation,
			captured,
			exposed: Object.freeze({ generation, origin: exposedOrigin(captured) }),
			interlock,
		});
		active = current;
		activeSettled = new Promise<void>((resolve) => { resolveActive = resolve; });
		const preparation = prepareReserved(current, mode);
		notify();
		let released = false;
		return Object.freeze({
			captured,
			prepare() {
				if (released || active !== current) {
					return Promise.reject(new Error('Framescaper capture start admission is no longer current.'));
				}
				return preparation;
			},
			release() {
				if (released) return false;
				released = true;
				if (active === current) active = null;
				const result = interlock.release();
				resolveActive?.();
				resolveActive = null;
				activeSettled = null;
				notify();
				return result;
			},
		});
	}

	async function prepareReserved(
		current: Readonly<ActiveAdmission>,
		mode: 'foreground' | 'background',
	): Promise<void> {
		await options.prepareCaptureStart();
		if (disposed) throw new Error('Framescaper capture was disposed during start admission.');
		if (active !== current) throw new Error('Framescaper capture start admission is no longer current.');
		current.interlock.assertCurrent();
		if (mode === 'foreground'
			&& !sameCaptureOrigin(current.captured, freezeOrigin(options.captureOrigin()))) {
			throw new Error('Framescaper capture origin changed during start admission.');
		}
	}

	function captureOrigin(): Readonly<FramescaperCaptureStartOrigin> {
		return active?.captured ?? freezeOrigin(options.captureOrigin());
	}

	function notify(): void {
		try { options.onChange?.(); } catch { /* Admission observers cannot own capture. */ }
	}

	return Object.freeze({
		get snapshot() { return active?.exposed ?? null; },
		begin,
		captureOrigin,
		settled: () => activeSettled ?? Promise.resolve(),
		dispose() { disposed = true; },
	});
}

function freezeOrigin(
	value: Readonly<FramescaperCaptureStartOrigin>,
): Readonly<FramescaperCaptureStartOrigin> {
	return Object.freeze({
		projectFence: Object.freeze({ ...value.projectFence }),
		origin: Object.freeze({ ...value.origin }),
	});
}

function exposedOrigin(
	value: Readonly<FramescaperCaptureStartOrigin>,
): Readonly<FramescaperCaptureOriginBinding> {
	return Object.freeze({
		...value.projectFence,
		sequenceId: value.origin.sequenceId,
		playheadMicroseconds: value.origin.playheadMicroseconds,
	});
}

function sameCaptureOrigin(
	left: Readonly<FramescaperCaptureStartOrigin>,
	right: Readonly<FramescaperCaptureStartOrigin>,
): boolean {
	return left.projectFence.projectId === right.projectFence.projectId
		&& left.projectFence.baseRevision === right.projectFence.baseRevision
		&& left.projectFence.baseSha256 === right.projectFence.baseSha256
		&& left.origin.sequenceId === right.origin.sequenceId
		&& left.origin.playheadMicroseconds === right.origin.playheadMicroseconds
		&& left.origin.destination === right.origin.destination;
}
