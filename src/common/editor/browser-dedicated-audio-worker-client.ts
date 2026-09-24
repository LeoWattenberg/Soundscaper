/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	DedicatedAudioDecodeRequest,
	DedicatedAudioDecodeResult,
	DedicatedAudioEncodeRequest,
} from './browser-dedicated-audio-codec.ts';
import { createNumericWorkerRequestBrokerBoundary } from './numeric-worker-request-broker-boundary.ts';
import { WorkerRequestBroker } from './worker-request-broker.ts';

type WorkerRequest = Readonly<{
	readonly id: number; readonly operation: 'encode'; readonly request: DedicatedAudioEncodeRequest;
}> | Readonly<{
	readonly id: number; readonly operation: 'decode'; readonly request: DedicatedAudioDecodeRequest;
}>;

type WorkerResponse = Readonly<{
	readonly id: number;
	readonly status: 'ok';
	readonly operation: 'encode';
	readonly bytes: ArrayBuffer;
}> | Readonly<{
	readonly id: number;
	readonly status: 'ok';
	readonly operation: 'decode';
	readonly bytes: ArrayBuffer;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
}> | Readonly<{
	readonly id: number;
	readonly status: 'error';
	readonly name: string;
	readonly message: string;
	readonly code?: string;
}>;

interface WorkerPort {
	postMessage(message: WorkerRequest, transfer: Transferable[]): void;
	terminate(): void;
	addEventListener(type: 'message', listener: (event: MessageEvent<WorkerResponse>) => void): void;
	addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
}

export interface BrowserDedicatedAudioWorkerClient {
	encode(request: DedicatedAudioEncodeRequest, options?: Readonly<{ signal?: AbortSignal }>): Promise<Uint8Array>;
	decode(request: DedicatedAudioDecodeRequest, options?: Readonly<{ signal?: AbortSignal }>): Promise<DedicatedAudioDecodeResult>;
	dispose(): void;
}

export interface BrowserDedicatedAudioWorkerClientOptions {
	readonly createWorker?: () => WorkerPort;
}

type Operation = Readonly<{
	readonly operation: 'encode'; readonly request: DedicatedAudioEncodeRequest;
}> | Readonly<{
	readonly operation: 'decode'; readonly request: DedicatedAudioDecodeRequest;
}>;

// A single bounded file encode or decode can take longer than a streamed packet.
const CODEC_REQUEST_TIMEOUT_MS = 10 * 60 * 1_000;

interface QueuedOperation {
	readonly id: number;
	readonly operation: Operation;
}

export function createBrowserDedicatedAudioCodecClient(
	options: BrowserDedicatedAudioWorkerClientOptions = {},
): BrowserDedicatedAudioWorkerClient {
	const createWorker = options.createWorker ?? defaultWorker;
	const requests = new WorkerRequestBroker({ timeoutMs: CODEC_REQUEST_TIMEOUT_MS });
	const numericRequests = createNumericWorkerRequestBrokerBoundary(requests);
	const queued: QueuedOperation[] = [];
	let worker: WorkerPort | null = null;
	let active: QueuedOperation | null = null;
	let nextId = 1;
	let disposed = false;
	let pumping = false;

	return Object.freeze({
		encode(request: DedicatedAudioEncodeRequest, encodeOptions: Readonly<{ signal?: AbortSignal }> = {}) {
			return enqueue({ operation: 'encode', request }, encodeOptions.signal).then((response) => {
				if (response.operation !== 'encode') throw new Error('The dedicated audio worker confused encode and decode.');
				return new Uint8Array(response.bytes);
			});
		},
		decode(request: DedicatedAudioDecodeRequest, decodeOptions: Readonly<{ signal?: AbortSignal }> = {}) {
			return enqueue({ operation: 'decode', request }, decodeOptions.signal).then((response) => {
				if (response.operation !== 'decode') throw new Error('The dedicated audio worker confused decode and encode.');
				return Object.freeze({
					interleaved: new Uint8Array(response.bytes),
					frameCount: response.frameCount,
					channelCount: response.channelCount,
					sampleRate: response.sampleRate,
				});
			});
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			queued.length = 0;
			active = null;
			const port = worker;
			worker = null;
			terminatePort(port);
			requests.dispose(disposedError());
		},
	});

	function enqueue(
		operation: Operation,
		signal?: AbortSignal,
	): Promise<Extract<WorkerResponse, { readonly status: 'ok' }>> {
		if (disposed) return Promise.reject(disposedError());
		const id = nextId++;
		const item: QueuedOperation = { id, operation };
		const result = numericRequests.request<Extract<WorkerResponse, { readonly status: 'ok' }>, QueuedOperation>({
			id: item.id,
			context: item,
			signal,
			armOnRequest: false,
			abortError: () => signal?.reason instanceof Error ? signal.reason : abortError(),
			onAbort: () => cancel(item),
			onTimeout: () => cancel(item),
		});
		if (numericRequests.has(item.id)) {
			queued.push(item);
			pump();
		}
		return result;
	}

	function pump(): void {
		if (pumping || disposed || active) return;
		pumping = true;
		try {
			while (!disposed && !active) {
				const item = queued.shift();
				if (!item) break;
				if (!numericRequests.has(item.id)) continue;
				active = item;
				let port: WorkerPort | null = null;
				try {
					port = acquirePort(item);
					if (!port) continue;
					const input = Uint8Array.from(item.operation.request.input);
					const transferred = Object.freeze({ ...item.operation.request, input });
					port.postMessage({
						id: item.id,
						operation: item.operation.operation,
						request: transferred,
					} as WorkerRequest, [input.buffer]);
				} catch (error) {
					if (active === item) {
						active = null;
						numericRequests.reject(item.id, error);
					}
				}
				if (active === item && numericRequests.has(item.id)) {
					numericRequests.touch(item.id);
					break;
				}
			}
		} finally {
			pumping = false;
		}
		if (!active && queued.length && !disposed) pump();
	}

	function acquirePort(item: QueuedOperation): WorkerPort | null {
		if (worker) return worker;
		const candidate = createPort();
		if (disposed || active !== item || !numericRequests.has(item.id)) {
			terminatePort(candidate);
			return null;
		}
		worker = candidate;
		return candidate;
	}

	function createPort(): WorkerPort {
		const port: WorkerPort = createWorker();
		if (!port || typeof port.postMessage !== 'function' || typeof port.terminate !== 'function'
			|| typeof port.addEventListener !== 'function') {
			throw new TypeError('The dedicated audio worker factory returned an invalid port.');
		}
		port.addEventListener('message', ({ data }) => {
			if (port !== worker) return;
			if (!isRecord(data) || typeof data.id !== 'number' || !Number.isSafeInteger(data.id)) {
				failPort(new Error('The dedicated audio worker returned a malformed response.'), port);
				return;
			}
			const item = active;
			if (!item || data.id !== item.id) {
				failPort(new Error('The dedicated audio worker returned an unexpected response id.'), port);
				return;
			}
			if (data.status === 'ok' && data.bytes instanceof ArrayBuffer
				&& (data.operation === 'encode' || data.operation === 'decode')) {
				settle(item, data as Extract<WorkerResponse, { readonly status: 'ok' }>);
				return;
			}
			if (data.status === 'error' && typeof data.name === 'string' && typeof data.message === 'string'
				&& (data.code === undefined || typeof data.code === 'string')) {
				settle(item, workerError(data as Extract<WorkerResponse, { readonly status: 'error' }>));
				return;
			}
			failPort(new Error('The dedicated audio worker returned an invalid result.'), port);
		});
		const fail = (): void => failPort(new Error('The dedicated audio worker failed.'), port);
		port.addEventListener('error', fail);
		port.addEventListener('messageerror', fail);
		return port;
	}

	function settle(
		item: QueuedOperation,
		result: Extract<WorkerResponse, { readonly status: 'ok' }> | Error,
	): void {
		if (active !== item) return;
		active = null;
		if (result instanceof Error) numericRequests.reject(item.id, result);
		else numericRequests.resolve(item.id, result);
		pump();
	}

	function cancel(item: QueuedOperation): void {
		const index = queued.indexOf(item);
		if (index >= 0) queued.splice(index, 1);
		if (active !== item) return;
		active = null;
		const port = worker;
		worker = null;
		terminatePort(port);
		pump();
	}

	function failPort(reason: Error, port: WorkerPort): void {
		if (port !== worker) return;
		worker = null;
		terminatePort(port);
		const item = active;
		active = null;
		if (item) numericRequests.reject(item.id, reason);
		pump();
	}
}

function terminatePort(port: WorkerPort | null): void {
	try { port?.terminate(); } catch { /* The original failure remains primary. */ }
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object';
}

function defaultWorker(): WorkerPort {
	return new Worker(new URL('./browser-dedicated-audio-worker.ts', import.meta.url), {
		type: 'module',
		name: 'soundscaper-dedicated-audio-codecs',
	}) as unknown as WorkerPort;
}

function workerError(response: Extract<WorkerResponse, { readonly status: 'error' }>): Error {
	const error = new Error(response.message);
	error.name = response.name;
	if (response.code !== undefined) Object.defineProperty(error, 'code', { value: response.code, enumerable: true });
	return error;
}

function abortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The dedicated browser audio operation was aborted.', 'AbortError')
		: Object.assign(new Error('The dedicated browser audio operation was aborted.'), { name: 'AbortError' });
}

function disposedError(): Error {
	return new Error('The dedicated browser audio worker was disposed.');
}
