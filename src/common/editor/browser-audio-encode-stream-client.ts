/* SPDX-License-Identifier: AGPL-3.0-only */
import type { DedicatedAudioEncodeSessionRequest } from './dedicated-audio-encode-session.ts';

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
	let nextId = 1;
	let closed = false;
	let busy = false;
	let pending: Readonly<{ id: number; resolve: (value: Extract<AudioEncodeStreamResponse, { status: 'ok' }>) => void; reject: (reason: unknown) => void }> | null = null;
	const onAbort = (): void => close(signal?.reason ?? abortError());
	signal?.addEventListener('abort', onAbort, { once: true });
	port.addEventListener('message', ({ data }) => {
		if (!pending || data?.id !== pending.id) return;
		if (data.status === 'ok' && data.bytes instanceof ArrayBuffer && data.bytes.byteLength <= 1024 ** 2
			&& (data.prefixPatch === undefined || data.prefixPatch instanceof ArrayBuffer && data.prefixPatch.byteLength <= 1024 ** 2)) {
			pending.resolve(data);
		} else pending.reject(new Error(data.status === 'error' ? data.message : 'The incremental encoder returned malformed output.'));
		pending = null;
	});
	const fail = (): void => close(new Error('The incremental audio encoder worker failed.'));
	port.addEventListener('error', fail); port.addEventListener('messageerror', fail);
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
			return await new Promise<Extract<AudioEncodeStreamResponse, { status: 'ok' }>>((resolve, reject) => {
				pending = { id: message.id, resolve, reject };
				try { port.postMessage(message, transfer); } catch (error) { pending = null; reject(error); }
			});
		} finally { busy = false; }
	}
	function close(reason: unknown): void {
		if (closed) return;
		closed = true;
		signal?.removeEventListener('abort', onAbort);
		port.terminate(); pending?.reject(reason); pending = null;
	}
}

function defaultWorker(): AudioEncodeStreamWorkerPort {
	return new Worker(new URL('./browser-audio-encode-stream-worker.ts', import.meta.url), {
		type: 'module', name: 'soundscaper-incremental-audio-encoder',
	}) as unknown as AudioEncodeStreamWorkerPort;
}
function abortError(): Error { return new DOMException('The incremental audio export was cancelled.', 'AbortError'); }
