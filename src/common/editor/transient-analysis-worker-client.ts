/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	DetectPcmTransientsOptions,
	TransientAnalysisResult,
} from './transient-analysis.ts';
import {
	TRANSIENT_ANALYSIS_WORKER_REQUEST,
	type TransientAnalysisWorkerResponse,
} from './transient-analysis-worker-runtime.ts';

type WorkerEvent = Readonly<{ data?: unknown; error?: unknown; message?: string }>;
type WorkerListener = (event: WorkerEvent) => void;

export interface TransientAnalysisWorkerPort {
	addEventListener(type: 'message' | 'messageerror' | 'error', listener: WorkerListener): void;
	removeEventListener(type: 'message' | 'messageerror' | 'error', listener: WorkerListener): void;
	postMessage(message: unknown, transfer?: readonly Transferable[]): void;
	terminate(): void;
}

export interface TransientAnalysisWorkerClientOptions {
	readonly signal?: AbortSignal;
	readonly pcmOwnership?: 'borrow' | 'transfer';
	readonly workerFactory?: () => TransientAnalysisWorkerPort;
}

let requestSequence = 0;

/** Run one detector job and terminate its dedicated worker at every terminal edge. */
export function detectPcmTransientsInWorker(
	channelsValue: readonly Float32Array[],
	options: Readonly<DetectPcmTransientsOptions> = {},
	clientOptions: Readonly<TransientAnalysisWorkerClientOptions> = {},
): Promise<Readonly<TransientAnalysisResult>> {
	const signal = clientOptions.signal;
	if (signal?.aborted) return Promise.reject(signal.reason);
	const ownership = clientOptions.pcmOwnership ?? 'borrow';
	const channels = prepareChannels(channelsValue, ownership);
	const transfer = channels.map((channel) => channel.buffer as ArrayBuffer);
	const requestId = `transient-${Date.now().toString(36)}-${(++requestSequence).toString(36)}`;
	const worker = (clientOptions.workerFactory ?? defaultWorkerFactory)();
	return new Promise<Readonly<TransientAnalysisResult>>((resolve, reject) => {
		let settled = false;
		const cleanup = (): void => {
			signal?.removeEventListener('abort', onAbort);
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
		const onAbort = (): void => settle(() => reject(signal?.reason));
		const onMessage = (event: WorkerEvent): void => {
			const response = event.data as Partial<TransientAnalysisWorkerResponse> | null;
			if (!response || response.requestId !== requestId) return;
			if (response.type === 'result' && 'result' in response) {
				settle(() => resolve(response.result as Readonly<TransientAnalysisResult>));
				return;
			}
			if (response.type === 'error' && 'error' in response) {
				settle(() => reject(workerError(response.error)));
			}
		};
		const onMessageError = (): void => settle(() => reject(new Error(
			'The transient analysis worker returned an unreadable response.',
		)));
		const onWorkerError = (event: WorkerEvent): void => settle(() => reject(
			event.error instanceof Error ? event.error : new Error(event.message || 'Transient analysis worker failed.'),
		));
		worker.addEventListener('message', onMessage);
		worker.addEventListener('messageerror', onMessageError);
		worker.addEventListener('error', onWorkerError);
		signal?.addEventListener('abort', onAbort, { once: true });
		if (signal?.aborted) {
			onAbort();
			return;
		}
		try {
			worker.postMessage({
				type: TRANSIENT_ANALYSIS_WORKER_REQUEST,
				requestId,
				channels,
				options,
			}, transfer);
		} catch (error) {
			settle(() => reject(error));
		}
	});
}

function prepareChannels(
	value: readonly Float32Array[],
	ownership: 'borrow' | 'transfer',
): Float32Array[] {
	if (!Array.isArray(value) || value.length < 1 || value.some((channel) => !(channel instanceof Float32Array))) {
		throw new TypeError('Transient analysis worker PCM must contain Float32Array channels.');
	}
	if (ownership === 'borrow') return value.map((channel) => channel.slice());
	const buffers = new Set<ArrayBuffer>();
	for (const channel of value) {
		if (!(channel.buffer instanceof ArrayBuffer)
			|| channel.byteOffset !== 0 || channel.byteLength !== channel.buffer.byteLength) {
			throw new TypeError('Transfer ownership requires exact-span PCM channels.');
		}
		if (buffers.has(channel.buffer)) {
			throw new TypeError('Transfer ownership requires unique backing buffers.');
		}
		buffers.add(channel.buffer);
	}
	return [...value];
}

function workerError(value: unknown): Error {
	const candidate = value as Readonly<{ name?: unknown; message?: unknown }> | null;
	const message = typeof candidate?.message === 'string' ? candidate.message : 'Transient analysis worker failed.';
	const error = new Error(message);
	if (candidate?.name === 'TypeError' || candidate?.name === 'RangeError' || candidate?.name === 'Error') {
		error.name = candidate.name;
	}
	return error;
}

function defaultWorkerFactory(): TransientAnalysisWorkerPort {
	if (typeof Worker !== 'function') throw new Error('Transient analysis requires Web Worker support.');
	return new Worker(new URL('./transient-analysis-worker-entry.ts', import.meta.url), {
		type: 'module',
		name: 'soundscaper-transient-analysis',
	}) as unknown as TransientAnalysisWorkerPort;
}
