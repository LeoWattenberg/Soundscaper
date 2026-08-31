/* SPDX-License-Identifier: AGPL-3.0-only */

/** Cache execution verification against one exact external-FFmpeg admission. */

import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
	createDesktopExternalFfmpegVideoCapabilities,
	type DesktopExternalFfmpegVideoCapabilities,
	type DesktopVideoCodecFormat,
} from './desktop-video-codec-operation-contract.js';
import type {
	ExternalFfmpegPreferenceService,
	ExternalFfmpegRuntimeAdmission,
} from './external-ffmpeg-preference-service.js';
import {
	ExternalFfmpegVideoVerificationIdentityError,
	verifyExternalFfmpegVideoAdmission,
} from './external-ffmpeg-video-verification.js';
import type { ExternalFfmpegVideoSpawn } from './external-ffmpeg-video-process.js';

export type DesktopVideoCodecProductId = 'soundscaper' | 'framescaper';
export type ExternalFfmpegVideoVerifier = (
	admission: ExternalFfmpegRuntimeAdmission,
	signal: AbortSignal,
) => Promise<DesktopExternalFfmpegVideoCapabilities>;

export interface ExternalFfmpegVideoVerifiedCapabilitiesOptions {
	readonly productId: DesktopVideoCodecProductId;
	readonly scratchRoot: string;
	readonly preferences: Pick<ExternalFfmpegPreferenceService, 'admission' | 'invalidateAdmission'>;
	readonly digestExecutable: (path: string) => Promise<string>;
	readonly spawn?: ExternalFfmpegVideoSpawn;
	readonly environment: Readonly<Record<string, string | undefined>>;
	readonly verify?: ExternalFfmpegVideoVerifier;
}

export interface ExternalFfmpegVideoVerifiedCapabilities {
	capabilities(): Promise<DesktopExternalFfmpegVideoCapabilities>;
	admission(format: DesktopVideoCodecFormat): Promise<ExternalFfmpegRuntimeAdmission>;
	dispose(): Promise<void>;
}

export interface ExternalFfmpegVideoBeginGate<Owner extends object> {
	reserve(owner: Owner): object;
	assertCurrent(token: object, disposed: boolean): void;
	release(token: object): void;
	revoke(owner: Owner): Promise<boolean>;
	dispose(): Promise<void>;
}

export class ExternalFfmpegVideoCapabilityError extends Error {
	constructor(readonly reason: string, message: string) {
		super(message); this.name = 'ExternalFfmpegVideoCapabilityError';
	}
}

export function createExternalFfmpegVideoVerifiedCapabilities(
	options: ExternalFfmpegVideoVerifiedCapabilitiesOptions,
): ExternalFfmpegVideoVerifiedCapabilities {
	assertProduct(options.productId);
	const controller = new AbortController();
	const verify = options.verify ?? ((admission, signal) => verifyExternalFfmpegVideoAdmission({
		scratchRoot: join(options.scratchRoot, 'verification'), admission,
		digestExecutable: options.digestExecutable,
		...(options.spawn ? { spawn: options.spawn } : {}),
		environment: options.environment, signal,
	}));
	const cached = new WeakMap<ExternalFfmpegRuntimeAdmission, Promise<DesktopExternalFfmpegVideoCapabilities>>();
	const pending = new Set<Promise<DesktopExternalFfmpegVideoCapabilities>>();
	let disposal: Promise<void> | null = null;
	const verifyExact = (admission: ExternalFfmpegRuntimeAdmission) => {
		assertOpen(disposal);
		const prior = cached.get(admission);
		if (prior) return prior;
		const task = Promise.resolve().then(() => verify(admission, controller.signal)).catch(async (error: unknown) => {
			if (!(error instanceof ExternalFfmpegVideoVerificationIdentityError)) throw error;
			await options.preferences.invalidateAdmission(admission, error.reason);
			return createDesktopExternalFfmpegVideoCapabilities(null);
		});
		const result = task.finally(() => { pending.delete(result); });
		pending.add(result);
		cached.set(admission, result);
		return result;
	};
	return Object.freeze({
		async capabilities() {
			assertOpen(disposal);
			assertProduct(options.productId);
			const admission = options.preferences.admission();
			if (!admission) return createDesktopExternalFfmpegVideoCapabilities(null);
			const capabilities = await verifyExact(admission);
			if (options.preferences.admission() !== admission) {
				return createDesktopExternalFfmpegVideoCapabilities(null);
			}
			return capabilities;
		},
		async admission(format: DesktopVideoCodecFormat) {
			assertOpen(disposal);
			assertProduct(options.productId);
			const admission = options.preferences.admission();
			if (!admission) throw unavailable(format, createDesktopExternalFfmpegVideoCapabilities(null));
			const capabilities = await verifyExact(admission);
			if (options.preferences.admission() !== admission) {
				throw new ExternalFfmpegVideoCapabilityError(
					'stale-admission', 'The external FFmpeg admission changed during video verification.',
				);
			}
			if (!capabilities.formats[format].available) throw unavailable(format, capabilities);
			return admission;
		},
		dispose() {
			if (disposal) return disposal;
			controller.abort(new DOMException('Video verification service stopped.', 'AbortError'));
			disposal = Promise.allSettled([...pending]).then(async () => {
				await rm(join(options.scratchRoot, 'verification'), { recursive: true, force: true });
			});
			return disposal;
		},
	});
}

/** Reserve global and renderer capacity across asynchronous verification and scratch setup. */
export function createExternalFfmpegVideoBeginGate<Owner extends object>(options: Readonly<{
	readonly activeCount: () => number;
	readonly hasActiveOwner: (owner: Owner) => boolean;
	readonly maximum: number;
	readonly error: (reason: string, message: string) => Error;
}>): ExternalFfmpegVideoBeginGate<Owner> {
	const owners = new Map<Owner, object>();
	const states = new WeakMap<object, {
		owner: Owner; active: boolean; completion: Promise<void>; settle(): void;
	}>();
	const cancel = (token: object): Promise<void> => {
		const state = states.get(token)!; state.active = false;
		if (owners.get(state.owner) === token) owners.delete(state.owner);
		return state.completion;
	};
	return Object.freeze({
		reserve(owner: Owner) {
			if (owners.has(owner) || options.hasActiveOwner(owner)
				|| owners.size + options.activeCount() >= options.maximum) {
				throw options.error('busy', 'A desktop video session is already active.');
			}
			let settle!: () => void;
			const completion = new Promise<void>((resolve) => { settle = resolve; });
			const token = Object.freeze({});
			states.set(token, { owner, active: true, completion, settle }); owners.set(owner, token);
			return token;
		},
		assertCurrent(token: object, disposed: boolean) {
			const state = states.get(token);
			if (disposed || !state?.active || owners.get(state.owner) !== token) {
				throw options.error('cancelled', 'The desktop video session request was revoked.');
			}
		},
		release(token: object) {
			const state = states.get(token);
			if (!state) return;
			state.active = false;
			if (owners.get(state.owner) === token) owners.delete(state.owner);
			state.settle(); states.delete(token);
		},
		async revoke(owner: Owner) {
			const token = owners.get(owner);
			if (!token) return false;
			await cancel(token); return true;
		},
		async dispose() {
			const tokens = [...owners.values()];
			await Promise.all(tokens.map(cancel));
		},
	});
}

function unavailable(
	format: DesktopVideoCodecFormat,
	capabilities: DesktopExternalFfmpegVideoCapabilities,
): ExternalFfmpegVideoCapabilityError {
	return new ExternalFfmpegVideoCapabilityError(
		'capability-unavailable',
		capabilities.formats[format].reason ?? 'Desktop video export is unavailable.',
	);
}

function assertOpen(disposal: Promise<void> | null): void {
	if (disposal) throw new ExternalFfmpegVideoCapabilityError(
		'disposed', 'The external FFmpeg video verification service is disposed.',
	);
}

function assertProduct(value: unknown): asserts value is DesktopVideoCodecProductId {
	if (value !== 'soundscaper' && value !== 'framescaper') {
		throw new ExternalFfmpegVideoCapabilityError(
			'product-unavailable', 'This desktop product has no admitted external video provider.',
		);
	}
}
