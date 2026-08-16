/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The main-process owner of the native audio surface.
 *
 * The renderer never names a backend library, a device path, or a payload: it
 * asks for the inventory of a backend it was told exists and receives bounded,
 * re-validated status. Everything that could grant authority — which payload
 * runs, which backend is admitted, when the helper dies — stays here.
 *
 * The surface is off by default and degrades rather than fails. Disabled,
 * quarantined, unbuilt for this target, or crashed, it answers with a typed
 * status the UI can show, and Web Core audio is untouched in every case.
 */

import {
	HELPER_AUDIO_BACKENDS,
	type HelperAudioBackend,
} from './helper-job-grant.ts';
import { HelperSupervisionError, type HelperJobRequest } from './helper-supervisor.ts';
import type { NativeAddonAvailability } from './native-addon-payload.ts';
import {
	type HelperAudioDeviceInventoryResult,
	validateHelperAudioDeviceInventoryResult,
} from './native-helper-results.ts';

/** The reserved handle that asks a backend to describe itself. */
export const NATIVE_AUDIO_INVENTORY_HANDLE = 'inventory';

/**
 * The synthetic loopback backend is a proof surface, never a product one, so
 * the service refuses to publish it however the renderer asks.
 */
export const PUBLISHABLE_NATIVE_AUDIO_BACKENDS = Object.freeze(
	HELPER_AUDIO_BACKENDS.filter((backend) => backend !== 'synthetic'),
);

export type NativeAudioFailureCode =
	| 'helper-disabled'
	| 'helper-unavailable'
	| 'helper-quarantined'
	| 'unknown-backend'
	| 'helper-cancelled'
	| 'helper-failed';

export type NativeAudioInventoryOutcome =
	| Readonly<{ status: 'described'; inventory: HelperAudioDeviceInventoryResult }>
	| Readonly<{ status: 'failed'; code: NativeAudioFailureCode; message: string }>;

export interface NativeAudioAvailability {
	readonly enabled: boolean;
	readonly quarantined: boolean;
	readonly payload: Readonly<{ status: 'available' | 'unavailable'; reason: string | null; detail: string }>;
	readonly backends: readonly string[];
}

export interface NativeHelperSupervisorPort {
	runJob(request: HelperJobRequest<'audio-device'>): Promise<unknown>;
	snapshot(): Readonly<{ state: string; quarantined: boolean }>;
	clearQuarantine(): void;
	dispose(): void;
}

export interface DesktopNativeAudioServiceOptions {
	supervisor: NativeHelperSupervisorPort;
	isEnabled: () => boolean;
	describePayload: () => Promise<NativeAddonAvailability>;
}

export class DesktopNativeAudioService {
	readonly #supervisor: NativeHelperSupervisorPort;
	readonly #isEnabled: () => boolean;
	readonly #describePayload: () => Promise<NativeAddonAvailability>;
	readonly #owners = new Map<object, AbortController>();
	#queue: Promise<unknown> = Promise.resolve();
	#disposed = false;

	constructor(options: DesktopNativeAudioServiceOptions) {
		this.#supervisor = options.supervisor;
		this.#isEnabled = options.isEnabled;
		this.#describePayload = options.describePayload;
	}

	async availability(): Promise<NativeAudioAvailability> {
		const payload = await this.#describePayload();
		return Object.freeze({
			enabled: !this.#disposed && this.#isEnabled(),
			quarantined: this.#supervisor.snapshot().quarantined,
			payload: payload.status === 'available'
				? Object.freeze({ status: 'available' as const, reason: null, detail: '' })
				: Object.freeze({ status: 'unavailable' as const, reason: payload.reason, detail: payload.detail }),
			backends: PUBLISHABLE_NATIVE_AUDIO_BACKENDS,
		});
	}

	clearQuarantine(): void {
		this.#supervisor.clearQuarantine();
	}

	async describeBackend({ owner, backend }: Readonly<{ owner: object; backend: string }>): Promise<NativeAudioInventoryOutcome> {
		if (this.#disposed || !this.#isEnabled()) {
			return failure('helper-disabled', 'The native audio helper is disabled.');
		}
		if (!(PUBLISHABLE_NATIVE_AUDIO_BACKENDS as readonly string[]).includes(backend)) {
			// The synthetic proof backend lands here too, deliberately.
			return failure('unknown-backend', 'That audio backend is not offered by this build.');
		}
		if (this.#supervisor.snapshot().quarantined) {
			return failure('helper-quarantined', 'The native audio helper is quarantined after repeated faults.');
		}
		// The request is registered before the first await, not after it. An
		// owner that goes away while its payload is still being verified must
		// still be revoked, or the helper is spawned for a renderer that is
		// already gone.
		const controller = new AbortController();
		const previous = this.#owners.get(owner);
		previous?.abort(new HelperSupervisionError('cancelled', 'A newer inventory request replaced this one.'));
		this.#owners.set(owner, controller);
		try {
			const payload = await this.#describePayload();
			if (controller.signal.aborted) {
				return failure('helper-cancelled', 'The inventory request was cancelled before it began.');
			}
			if (payload.status !== 'available') {
				return failure('helper-unavailable', payload.detail);
			}
			const result = await this.#enqueue(() => this.#supervisor.runJob({
				kind: 'audio-device',
				grant: {
					backend: backend as HelperAudioBackend,
					deviceHandle: NATIVE_AUDIO_INVENTORY_HANDLE,
					direction: 'duplex',
					mode: 'shared',
				},
				signal: controller.signal,
				validateResult: (value) => validateHelperAudioDeviceInventoryResult(value),
			}));
			return Object.freeze({
				status: 'described' as const,
				inventory: result as HelperAudioDeviceInventoryResult,
			});
		} catch (error) {
			return failure(failureCode(error), error instanceof Error ? error.message : String(error));
		} finally {
			if (this.#owners.get(owner) === controller) this.#owners.delete(owner);
		}
	}

	revokeOwner(owner: object): void {
		const controller = this.#owners.get(owner);
		if (!controller) return;
		this.#owners.delete(owner);
		controller.abort(new HelperSupervisionError('cancelled', 'The inventory owner went away.'));
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const [owner, controller] of this.#owners) {
			this.#owners.delete(owner);
			controller.abort(new HelperSupervisionError('disposed', 'The native audio service is shutting down.'));
		}
		this.#supervisor.dispose();
	}

	/** Contract v1 admits one concurrent job, so inventory requests serialize. */
	#enqueue(operation: () => Promise<unknown>): Promise<unknown> {
		const next = this.#queue.then(operation, operation);
		this.#queue = next.catch(() => undefined);
		return next;
	}
}

function failure(code: NativeAudioFailureCode, message: string): NativeAudioInventoryOutcome {
	return Object.freeze({ status: 'failed' as const, code, message });
}

function failureCode(error: unknown): NativeAudioFailureCode {
	if (error instanceof HelperSupervisionError) {
		if (error.cause_ === 'cancelled' || error.cause_ === 'cancellation-timeout') return 'helper-cancelled';
		if (error.cause_ === 'quarantined') return 'helper-quarantined';
		if (error.cause_ === 'disposed') return 'helper-disabled';
		if (error.cause_ === 'binary-mismatch') return 'helper-unavailable';
	}
	return 'helper-failed';
}
