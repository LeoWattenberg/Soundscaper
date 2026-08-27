/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	DedicatedAudioDecodeRequest,
	DedicatedAudioDecodeResult,
	DedicatedAudioEncodeRequest,
} from './browser-dedicated-audio-codec.ts';

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

interface PendingOperation {
	readonly resolve: (response: Extract<WorkerResponse, { readonly status: 'ok' }>) => void;
	readonly reject: (reason: unknown) => void;
}

export function createBrowserDedicatedAudioCodecClient(
	options: BrowserDedicatedAudioWorkerClientOptions = {},
): BrowserDedicatedAudioWorkerClient {
	const createWorker = options.createWorker ?? defaultWorker;
	const pending = new Map<number, PendingOperation>();
	let worker: WorkerPort | null = null;
	let queue = Promise.resolve();
	let nextId = 1;
	let disposed = false;

	return Object.freeze({
		encode(request: DedicatedAudioEncodeRequest, encodeOptions: Readonly<{ signal?: AbortSignal }> = {}) {
			const run = () => execute({ operation: 'encode', request }, encodeOptions.signal);
			const result = queue.then(run, run);
			queue = result.then(() => undefined, () => undefined);
			return result.then((response) => {
				if (response.operation !== 'encode') throw new Error('The dedicated audio worker confused encode and decode.');
				return new Uint8Array(response.bytes);
			});
		},
		decode(request: DedicatedAudioDecodeRequest, decodeOptions: Readonly<{ signal?: AbortSignal }> = {}) {
			const run = () => execute({ operation: 'decode', request }, decodeOptions.signal);
			const result = queue.then(run, run);
			queue = result.then(() => undefined, () => undefined);
			return result.then((response) => {
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
			terminate(new Error('The dedicated browser audio worker was disposed.'));
		},
	});

	function execute(
		operation: Readonly<{
			readonly operation: 'encode'; readonly request: DedicatedAudioEncodeRequest;
		}> | Readonly<{
			readonly operation: 'decode'; readonly request: DedicatedAudioDecodeRequest;
		}>,
		signal?: AbortSignal,
	): Promise<Extract<WorkerResponse, { readonly status: 'ok' }>> {
		if (disposed) return Promise.reject(new Error('The dedicated browser audio worker was disposed.'));
		if (signal?.aborted) return Promise.reject(signal.reason ?? abortError());
		const port = worker ??= createPort();
		const id = nextId++;
		const input = Uint8Array.from(operation.request.input);
		const transferred = Object.freeze({ ...operation.request, input });
		return new Promise<Extract<WorkerResponse, { readonly status: 'ok' }>>((resolve, reject) => {
			const onAbort = (): void => terminate(signal?.reason ?? abortError(), port);
			pending.set(id, {
				resolve(response) {
					signal?.removeEventListener('abort', onAbort);
					resolve(response);
				},
				reject(reason) {
					signal?.removeEventListener('abort', onAbort);
					reject(reason);
				},
			});
			signal?.addEventListener('abort', onAbort, { once: true });
			try {
				port.postMessage({ id, operation: operation.operation, request: transferred } as WorkerRequest, [input.buffer]);
			} catch (error) {
				pending.delete(id);
				signal?.removeEventListener('abort', onAbort);
				reject(error);
			}
		});
	}

	function createPort(): WorkerPort {
		const port = createWorker();
		if (!port || typeof port.postMessage !== 'function' || typeof port.terminate !== 'function'
			|| typeof port.addEventListener !== 'function') {
			throw new TypeError('The dedicated audio worker factory returned an invalid port.');
		}
		port.addEventListener('message', ({ data }) => {
			if (!data || typeof data !== 'object' || !Number.isSafeInteger(data.id)) {
				terminate(new Error('The dedicated audio worker returned a malformed response.'), port);
				return;
			}
			const operation = pending.get(data.id);
			if (!operation) return;
			pending.delete(data.id);
			if (data.status === 'ok' && data.bytes instanceof ArrayBuffer) {
				operation.resolve(data);
				return;
			}
			if (data.status === 'error') {
				operation.reject(workerError(data));
				return;
			}
			operation.reject(new Error('The dedicated audio worker returned an invalid result.'));
		});
		const fail = (): void => terminate(new Error('The dedicated audio worker failed.'), port);
		port.addEventListener('error', fail);
		port.addEventListener('messageerror', fail);
		return port;
	}

	function terminate(reason: unknown, expectedPort?: WorkerPort): void {
		const port = worker;
		if (expectedPort !== undefined && port !== expectedPort) return;
		worker = null;
		try { port?.terminate(); } catch { /* The original failure remains primary. */ }
		for (const operation of pending.values()) operation.reject(reason);
		pending.clear();
	}
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
