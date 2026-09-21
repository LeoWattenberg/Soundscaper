/* SPDX-License-Identifier: AGPL-3.0-only */
import type { DedicatedAudioEncodeSessionRequest } from './dedicated-audio-encode-session.ts';
import { createNumericWorkerRequestBrokerBoundary } from './numeric-worker-request-broker-boundary.ts';
import { WorkerRequestBroker } from './worker-request-broker.ts';

export type AudioEncodeStreamRequest = Readonly<{ id: number; operation: 'open'; request: DedicatedAudioEncodeSessionRequest }>
	| Readonly<{ id: number; operation: 'write'; bytes: Uint8Array<ArrayBuffer>; frames: number }>
	| Readonly<{ id: number; operation: 'finish' }>;
export type AudioEncodeStreamResponse = Readonly<{ id: number; status: 'ok'; bytes: ArrayBuffer; prefixPatch?: ArrayBuffer }>
	| Readonly<{ id: number; status: 'error'; message: string }>;
export interface AudioEncodeStreamWorkerPort {
	postMessage(message: AudioEncodeStreamRequest, transfer: Transferable[]): void;
	terminate(): void;
	addEventListener(type: 'message', listener: (event: MessageEvent<AudioEncodeStreamResponse>) => void): void;
	addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
}
export interface BrowserAudioEncodeStreamSession {
	write(bytes: Uint8Array, frames: number): Promise<Uint8Array<ArrayBuffer>>;
	finish(): Promise<Readonly<{ bytes: Uint8Array<ArrayBuffer>; prefixPatch: Uint8Array<ArrayBuffer> }>>;
	close(): void;
}

/** A worker owns one uninterrupted encoder; each write awaits its output before the next packet. */
export async function openBrowserAudioEncodeStreamSession(
	request: DedicatedAudioEncodeSessionRequest,
	options: Readonly<{ signal?: AbortSignal; createWorker?: () => AudioEncodeStreamWorkerPort }> = {},
): Promise<BrowserAudioEncodeStreamSession> {
	const signal = options.signal;
	if (signal?.aborted) throw signal.reason ?? abortError();
	const port = (options.createWorker ?? defaultWorker)();
	const requests = new WorkerRequestBroker();
	const numericRequests = createNumericWorkerRequestBrokerBoundary(requests);
	let nextId = 1;
	let closed = false;
	let busy = false;
	let pendingId: number | null = null;
	const onAbort = (): void => close(signal?.reason ?? abortError());
	signal?.addEventListener('abort', onAbort, { once: true });
	port.addEventListener('message', ({ data }) => {
		if (closed || pendingId === null) return;
		if (!isRecord(data) || typeof data.id !== 'number' || !Number.isSafeInteger(data.id)) {
			close(new Error('The incremental encoder returned malformed output.'));
			return;
		}
		if (data.id !== pendingId) {
			close(new Error('The incremental encoder returned an unexpected response id.'));
			return;
		}
		if (data.status === 'ok' && data.bytes instanceof ArrayBuffer && data.bytes.byteLength <= 1024 ** 2
			&& (data.prefixPatch === undefined || data.prefixPatch instanceof ArrayBuffer && data.prefixPatch.byteLength <= 1024 ** 2)) {
			pendingId = null;
			numericRequests.resolve(data.id, data);
			return;
		}
		if (data.status === 'error' && typeof data.message === 'string') {
			close(new Error(data.message));
			return;
		}
		close(new Error('The incremental encoder returned malformed output.'));
	});
	const fail = (): void => close(new Error('The incremental audio encoder worker failed.'));
	port.addEventListener('error', fail); port.addEventListener('messageerror', fail);
	if (signal?.aborted) {
		const reason = signal.reason instanceof Error ? signal.reason : abortError();
		close(reason);
		throw reason;
	}
	try { await execute({ id: nextId++, operation: 'open', request }, []); }
	catch (error) { close(error); throw error; }
	return Object.freeze({
		async write(bytes: Uint8Array, frames: number) {
			if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(frames) || frames < 1 || frames > 16_384
				|| bytes.byteLength !== frames * request.channelCount * 4) throw new RangeError('The streaming PCM packet geometry is invalid.');
			const owned = Uint8Array.from(bytes);
			const response = await execute({ id: nextId++, operation: 'write', bytes: owned, frames }, [owned.buffer]);
			return new Uint8Array(response.bytes);
		},
		async finish() {
			const response = await execute({ id: nextId++, operation: 'finish' }, []);
			return Object.freeze({ bytes: new Uint8Array(response.bytes), prefixPatch: new Uint8Array(response.prefixPatch ?? new ArrayBuffer(0)) });
		},
		close: () => close(new Error('The incremental audio encoder session was closed.')),
	});
	async function execute(message: AudioEncodeStreamRequest, transfer: Transferable[]) {
		if (closed || busy) throw new Error('Incremental audio encoder writes must be awaited in order.');
		if (signal?.aborted) throw signal.reason ?? abortError();
		busy = true;
		try {
			pendingId = message.id;
			try {
				return await numericRequests.request<Extract<AudioEncodeStreamResponse, { status: 'ok' }>>({
					id: message.id,
					armOnRequest: false,
					post: () => port.postMessage(message, transfer),
				});
			} catch (error) {
				close(error);
				throw error;
			}
		} finally {
			pendingId = null;
			busy = false;
		}
	}
	function close(reason: unknown): void {
		if (closed) return;
		closed = true;
		signal?.removeEventListener('abort', onAbort);
		pendingId = null;
		requests.dispose(errorFrom(reason));
		try { port.terminate(); } catch { /* The initiating failure remains primary. */ }
	}
}

function defaultWorker(): AudioEncodeStreamWorkerPort {
	return new Worker(new URL('./browser-audio-encode-stream-worker.ts', import.meta.url), {
		type: 'module', name: 'soundscaper-incremental-audio-encoder',
	}) as unknown as AudioEncodeStreamWorkerPort;
}
function abortError(): Error { return new DOMException('The incremental audio export was cancelled.', 'AbortError'); }

function errorFrom(reason: unknown): Error {
	return reason instanceof Error ? reason : new Error(String(reason));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object';
}
