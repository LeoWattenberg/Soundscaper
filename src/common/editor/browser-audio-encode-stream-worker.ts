/* SPDX-License-Identifier: AGPL-3.0-only */
import { openDedicatedAudioEncodeSession, type DedicatedAudioEncodeSession } from './dedicated-audio-encode-session.ts';
import type { AudioEncodeStreamRequest } from './browser-audio-encode-stream-client.ts';
interface WorkerScope {
	addEventListener(type: 'message', listener: (event: MessageEvent<AudioEncodeStreamRequest>) => void): void;
	postMessage(message: unknown, transfer: Transferable[]): void;
}
const scope = globalThis as unknown as WorkerScope;
let session: DedicatedAudioEncodeSession | null = null;
let queue = Promise.resolve();
scope.addEventListener('message', ({ data }) => {
	queue = queue.then(() => execute(data));
});

async function execute(message: AudioEncodeStreamRequest): Promise<void> {
	const id = message?.id;
	try {
		if (!Number.isSafeInteger(id)) throw new TypeError('The incremental encoder request ID is invalid.');
		let bytes = new Uint8Array(new ArrayBuffer(0));
		let prefixPatch: Uint8Array<ArrayBuffer> | undefined;
		if (message.operation === 'open') {
			if (session) throw new Error('The incremental encoder is already open.');
			session = await openDedicatedAudioEncodeSession(message.request);
		} else if (message.operation === 'write' && session) {
			bytes = session.write(message.bytes, message.frames);
		} else if (message.operation === 'finish' && session) {
			({ bytes, prefixPatch } = session.finish());
		} else throw new Error('The incremental encoder is not open.');
		scope.postMessage({ id, status: 'ok', bytes: bytes.buffer,
			...(prefixPatch ? { prefixPatch: prefixPatch.buffer } : {}),
		}, [bytes.buffer, ...(prefixPatch ? [prefixPatch.buffer] : [])]);
	} catch (error) {
		session?.close(); session = null;
		scope.postMessage({ id, status: 'error', message: error instanceof Error ? error.message : String(error) }, []);
	}
}
