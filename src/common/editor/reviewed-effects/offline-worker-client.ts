/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveReviewedEffectCatalogEntry } from './catalog.ts';
import { ReviewedEffectError, reviewedEffectError } from './errors.ts';
import { reviewedEffectPackageKey } from './manifest.ts';
import { REVIEWED_EFFECT_WORKER_REQUEST } from './offline-worker-runtime.ts';
import {
	admitReviewedEffectProcess,
	deserializeReviewedEffectError,
	type ReviewedEffectProcessRequest,
} from './runtime.ts';

type WorkerEvent = Readonly<{ data?: unknown; error?: unknown; message?: string }>;
type WorkerListener = (event: WorkerEvent) => void;
type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

export interface ReviewedEffectWorkerPort {
	addEventListener(type: 'message' | 'messageerror' | 'error', listener: WorkerListener): void;
	removeEventListener(type: 'message' | 'messageerror' | 'error', listener: WorkerListener): void;
	postMessage(message: unknown, transfer?: readonly Transferable[]): void;
	terminate(): void;
}

export interface ReviewedEffectOfflineOptions {
	readonly signal?: AbortSignal;
	/** A worker-compatible port seam for non-browser hosts and deterministic tests. */
	readonly workerFactory?: () => ReviewedEffectWorkerPort;
}

let requestSequence = 0;

/** Process one block in a terminating dedicated worker with catalog-fixed limits. */
export function processReviewedEffectOffline(
	packageReference: unknown,
	request: ReviewedEffectProcessRequest,
	options: ReviewedEffectOfflineOptions = {},
): Promise<readonly Float32Array[]> {
	const descriptor = resolveReviewedEffectCatalogEntry(packageReference);
	const admitted = admitReviewedEffectProcess(descriptor.manifest, request);
	if (options.signal?.aborted) {
		return Promise.reject(reviewedEffectError('REQUEST_ABORTED', 'Reviewed effect request was aborted.', options.signal.reason));
	}
	const channels = admitted.channels.map((channel) => channel.slice());
	const parameters = Object.fromEntries(descriptor.manifest.parameters.map((parameter) => [
		parameter.id,
		admitted.parameterValues[parameter.index]!,
	]));
	const transfer = channels.map((channel) => channel.buffer as ArrayBuffer);
	const requestId = `reviewed-effect-${(++requestSequence).toString(36)}`;
	let worker: ReviewedEffectWorkerPort;
	try {
		worker = (options.workerFactory ?? defaultWorkerFactory)();
	} catch (error) {
		return Promise.reject(error);
	}
	return new Promise<readonly Float32Array[]>((resolve, reject) => {
		let settled = false;
		let timer: TimerHandle | null = null;
		const cleanup = (): void => {
			if (timer != null) globalThis.clearTimeout(timer);
			options.signal?.removeEventListener('abort', onAbort);
			worker.removeEventListener('message', onMessage);
			worker.removeEventListener('messageerror', onMessageError);
			worker.removeEventListener('error', onWorkerError);
			worker.terminate();
		};
		const settle = (operation: () => void): void => {
			if (settled) return;
			settled = true;
			cleanup();
			operation();
		};
		const onAbort = (): void => settle(() => reject(reviewedEffectError(
			'REQUEST_ABORTED',
			'Reviewed effect request was aborted.',
			options.signal?.reason,
		)));
		const onMessage = (event: WorkerEvent): void => {
			const response = event.data as Readonly<Record<string, unknown>> | null;
			if (!response || response.requestId !== requestId) return;
			if (response.type === 'error') {
				settle(() => reject(deserializeReviewedEffectError(response.error)));
				return;
			}
			if (response.type !== 'result') {
				settle(() => reject(reviewedEffectError('WORKER_PROTOCOL', 'Reviewed effect worker response type is invalid.')));
				return;
			}
			try {
				const result = validateResult(
					response,
					reviewedEffectPackageKey(descriptor.manifest),
					admitted.channels.length,
					admitted.frameCount,
					descriptor.manifest.resources.maximumOutputBytes,
				);
				settle(() => resolve(result));
			} catch (error) {
				settle(() => reject(error));
			}
		};
		const onMessageError = (): void => settle(() => reject(reviewedEffectError(
			'WORKER_PROTOCOL',
			'Reviewed effect worker returned an unreadable response.',
		)));
		const onWorkerError = (event: WorkerEvent): void => settle(() => reject(reviewedEffectError(
			'PROCESSING_FAILED',
			event.error instanceof Error
				? event.error.message
				: event.message || 'Reviewed effect worker failed.',
			event.error,
		)));
		worker.addEventListener('message', onMessage);
		worker.addEventListener('messageerror', onMessageError);
		worker.addEventListener('error', onWorkerError);
		options.signal?.addEventListener('abort', onAbort, { once: true });
		timer = globalThis.setTimeout(() => settle(() => reject(reviewedEffectError(
			'TIMEOUT',
			`Reviewed effect exceeded its ${String(descriptor.manifest.resources.processingTimeoutMs)} ms deadline.`,
		))), descriptor.manifest.resources.processingTimeoutMs);
		unrefTimer(timer);
		if (options.signal?.aborted) {
			onAbort();
			return;
		}
		try {
			worker.postMessage({
				type: REVIEWED_EFFECT_WORKER_REQUEST,
				requestId,
				package: {
					id: descriptor.manifest.id,
					version: descriptor.manifest.version,
				},
				sampleRate: admitted.sampleRate,
				channels,
				parameters,
			}, transfer);
		} catch (error) {
			settle(() => reject(error));
		}
	});
}

function validateResult(
	response: Readonly<Record<string, unknown>>,
	expectedPackageKey: string,
	channelCount: number,
	frameCount: number,
	maximumOutputBytes: number,
): readonly Float32Array[] {
	if (response.packageKey !== expectedPackageKey || !Array.isArray(response.channels)) {
		if (response.packageKey !== expectedPackageKey) {
			throw reviewedEffectError('CATALOG_MISMATCH', 'Reviewed effect worker returned a different catalog package.');
		}
		throw reviewedEffectError('WORKER_PROTOCOL', 'Reviewed effect worker returned an invalid channel value.');
	}
	const channels = response.channels;
	let outputBytes = 0;
	for (const channel of channels) {
		if (!(channel instanceof Float32Array)) {
			throw reviewedEffectError('WORKER_PROTOCOL', 'Reviewed effect output must contain Float32Array channels.');
		}
		outputBytes += channel.byteLength;
		if (outputBytes > maximumOutputBytes) {
			throw reviewedEffectError('OUTPUT_LIMIT', 'Reviewed effect worker output exceeds its declared byte limit.');
		}
	}
	if (channels.length !== channelCount || channels.some((channel) => channel.length !== frameCount)) {
		throw reviewedEffectError('WORKER_PROTOCOL', 'Reviewed effect worker output shape does not match its input.');
	}
	for (const channel of channels) {
		for (const sample of channel) {
			if (!Number.isFinite(sample)) {
				throw reviewedEffectError('PROCESSING_FAILED', 'Reviewed effect worker returned non-finite audio.');
			}
		}
	}
	return Object.freeze([...channels]);
}

function defaultWorkerFactory(): ReviewedEffectWorkerPort {
	if (typeof Worker !== 'function') throw new Error('Reviewed effects require dedicated Web Worker support.');
	return new Worker(new URL('./offline-worker-entry.ts', import.meta.url), {
		type: 'module',
		name: 'soundscaper-reviewed-effect',
	}) as unknown as ReviewedEffectWorkerPort;
}

function unrefTimer(timer: TimerHandle): void {
	const candidate: unknown = timer;
	if (!candidate || typeof candidate !== 'object' || !('unref' in candidate)) return;
	const unref = (candidate as { readonly unref?: unknown }).unref;
	if (typeof unref === 'function') unref.call(candidate);
}

export function isReviewedEffectError(error: unknown, code: ReviewedEffectError['code']): boolean {
	return error instanceof ReviewedEffectError && error.code === code;
}
