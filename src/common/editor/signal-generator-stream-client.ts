/* SPDX-License-Identifier: AGPL-3.0-only */

import type { OneShotWorkerPort } from './one-shot-worker-task.ts';
import type { WaveformPeakPyramid } from './waveform-peak-builder.ts';

export interface GeneratedSignalStream {
	readonly type: string;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	chunks(): AsyncIterable<readonly Float32Array[]>;
	finish(): Promise<WaveformPeakPyramid>;
	close(): void;
}

/** A next request is sent only after the preceding block has been persisted. */
export async function generateAudioEditorSignalStream(
	type: string,
	options: Readonly<Record<string, unknown>>,
	client: Readonly<{ signal?: AbortSignal; workerFactory?: () => OneShotWorkerPort }> = {},
): Promise<GeneratedSignalStream> {
	if (client.signal?.aborted) throw client.signal.reason;
	const worker = (client.workerFactory ?? defaultWorkerFactory)();
	let sequence = 0;
	let closed = false;
	let started = false;
	let complete = false;
	let pending: { id: string; resolve(value: unknown): void; reject(error: unknown): void } | null = null;
	const onMessage: Parameters<OneShotWorkerPort['addEventListener']>[1] = event => {
		const data = event.data as Readonly<{ requestId?: string; type?: string; result?: unknown; error?: { name: string; message: string } }> | null;
		if (!pending || data?.requestId !== pending.id) return;
		const current = pending; pending = null;
		if (data.type === 'result') current.resolve(data.result);
		else { const error = new Error(data.error?.message || 'Generator stream failed.'); error.name = data.error?.name || 'Error'; current.reject(error); close(); }
	};
	const onError: Parameters<OneShotWorkerPort['addEventListener']>[1] = event => close(new Error(event.message || 'Generator stream failed.'));
	const onAbort = (): void => close(client.signal?.reason);
	worker.addEventListener('message', onMessage);
	worker.addEventListener('error', onError);
	worker.addEventListener('messageerror', onError);
	client.signal?.addEventListener('abort', onAbort, { once: true });
	if (client.signal?.aborted) onAbort();
	function close(reason: unknown = new DOMException('Generator stream closed.', 'AbortError')): void {
		if (closed) return;
		closed = true;
		const current = pending; pending = null; current?.reject(reason);
		client.signal?.removeEventListener('abort', onAbort);
		worker.removeEventListener('message', onMessage);
		worker.removeEventListener('error', onError);
		worker.removeEventListener('messageerror', onError);
		worker.terminate();
	}
	function call<Result>(request: Readonly<Record<string, unknown>>): Promise<Result> {
		if (closed) return Promise.reject(client.signal?.reason ?? new DOMException('Generator stream closed.', 'AbortError'));
		if (pending) return Promise.reject(new Error('A generator request is already in flight.'));
		return new Promise((resolve, reject) => {
			const id = `generator-block-${++sequence}`;
			pending = { id, resolve: value => resolve(value as Result), reject };
			try { worker.postMessage({ ...request, requestId: id }); } catch (error) { close(error); }
		});
	}
	try {
		const metadata = await call<Omit<GeneratedSignalStream, 'chunks' | 'finish' | 'close'>>({ operation: 'start', generator: type, options });
		if (!Number.isSafeInteger(metadata.frameCount) || metadata.frameCount < 1
			|| !Number.isSafeInteger(metadata.channelCount) || metadata.channelCount < 1 || metadata.channelCount > 32) throw new TypeError('Invalid generator stream metadata.');
		return Object.freeze({ ...metadata, close,
			async *chunks(): AsyncGenerator<readonly Float32Array[]> {
				if (started) throw new Error('Generator blocks can be consumed only once.');
				started = true;
				let frames = 0;
				try {
					while (true) {
						const { channels } = await call<{ channels: Float32Array[] | null }>({ operation: 'next' });
						if (channels === null) break;
						const length = channels[0]?.length ?? 0;
						if (channels.length !== metadata.channelCount || length < 1 || length > 65_536
							|| channels.some(channel => !(channel instanceof Float32Array) || channel.length !== length)) throw new TypeError('Invalid generator block geometry.');
						frames += length;
						if (frames > metadata.frameCount) throw new RangeError('Generator stream exceeds its admitted length.');
						yield channels;
					}
					if (frames !== metadata.frameCount) throw new RangeError('Generator stream is incomplete.');
					complete = true;
				} finally { if (!complete) close(); }
			},
			async finish(): Promise<WaveformPeakPyramid> {
				if (!complete) throw new Error('Generator stream is incomplete.');
				try { return await call<WaveformPeakPyramid>({ operation: 'finish' }); } finally { close(); }
			},
		});
	} catch (error) { close(); throw error; }
}

function defaultWorkerFactory(): OneShotWorkerPort {
	return new Worker(new URL('./signal-generator-stream-entry.ts', import.meta.url), { type: 'module', name: 'soundscaper-generator-stream' }) as unknown as OneShotWorkerPort;
}
