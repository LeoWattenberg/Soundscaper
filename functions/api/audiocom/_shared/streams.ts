/* SPDX-License-Identifier: AGPL-3.0-only */
import { OAuthHttpError } from './oauth-http.ts';

/** Pull one chunk at a time, enforcing the declared size without buffering audio. */
export function exactUploadStream(source: ReadableStream<Uint8Array> | null, expected: number): Readonly<{
	body: ReadableStream<Uint8Array>;
	completed: Promise<void>;
}> {
	if (source === null) throw new OAuthHttpError(400, 'invalid_upload', 'Choose an audio file.');
	const reader = source.getReader();
	let length = 0;
	let finish: () => void = () => {};
	let fail: (reason: unknown) => void = () => {};
	const completed = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
	// Failed fetches may skip awaiting completion; the consumer still receives errors.
	void completed.catch(() => {});
	const checked = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const next = await reader.read();
				if (next.done) {
					if (length !== expected) throw new OAuthHttpError(400, 'invalid_upload', 'The upload size does not match.');
					finish();
					controller.close();
					return;
				}
				length += next.value.byteLength;
				if (length > expected) {
					await reader.cancel('Upload exceeds declared size.');
					throw new OAuthHttpError(400, 'invalid_upload', 'The upload size does not match.');
				}
				controller.enqueue(next.value);
			} catch (error) {
				fail(error);
				controller.error(error);
			}
		},
		async cancel(reason: unknown) { fail(reason); await reader.cancel(reason); },
	});
	const FixedLength = (globalThis as typeof globalThis & {
		FixedLengthStream?: new (length: number) => ReadableWritablePair<Uint8Array, Uint8Array>;
	}).FixedLengthStream;
	if (!FixedLength) return { body: checked, completed };
	const target = new FixedLength(expected);
	void checked.pipeTo(target.writable).catch(fail);
	return { body: target.readable, completed };
}
export function limitedPreviewStream(source: ReadableStream<Uint8Array>, maximum: number): ReadableStream<Uint8Array> {
	let length = 0;
	return source.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			length += chunk.byteLength;
			if (length > maximum) { controller.error(new Error('audio.com preview exceeded its limit.')); return; }
			controller.enqueue(chunk);
		},
	}));
}
