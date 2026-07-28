/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	MEDIA_CONTENT_DIGEST_CHUNK_BYTES,
	canonicalMediaContentBlob,
	digestMediaContent,
} from '../src/common/editor/storage/media-content-digest.ts';

class ObservedBlob extends Blob {
	readonly slices: Array<Readonly<{ start: number; end: number }>> = [];
	readonly #afterRead?: (readCount: number) => void;

	constructor(parts: BlobPart[], afterRead?: (readCount: number) => void) {
		super(parts);
		this.#afterRead = afterRead;
	}

	override slice(start = 0, end = this.size, contentType = ''): Blob {
		this.slices.push(Object.freeze({ start, end }));
		const part = super.slice(start, end, contentType);
		const afterRead = this.#afterRead;
		const readCount = this.slices.length;
		return new class extends Blob {
			constructor() { super([part], { type: part.type }); }

			override async arrayBuffer(): Promise<ArrayBuffer> {
				const buffer = await part.arrayBuffer();
				afterRead?.(readCount);
				return buffer;
			}
		}();
	}
}

test('canonical media content bypasses Blob subclass byte and metadata overrides', async () => {
	class AdversarialBlob extends Blob {
		override get size(): number { return 1; }
		override get type(): string { return 'application/forged'; }

		override slice(): Blob {
			return new Blob(['forged-slice'], { type: this.type });
		}

		override async arrayBuffer(): Promise<ArrayBuffer> {
			return new TextEncoder().encode('forged-buffer').buffer;
		}
	}

	const genuineBytes = new TextEncoder().encode('genuine retained bytes');
	const adversarial = new AdversarialBlob([genuineBytes], { type: 'audio/genuine' });
	const canonical = canonicalMediaContentBlob(adversarial);

	assert.notEqual(canonical, adversarial);
	assert.equal(Object.getPrototypeOf(canonical), Blob.prototype);
	assert.equal(canonical.size, genuineBytes.byteLength);
	assert.equal(canonical.type, 'audio/genuine');
	assert.deepEqual(new Uint8Array(await canonical.arrayBuffer()), genuineBytes);
	assert.equal(
		await digestMediaContent(canonical, { chunkBytes: 5 }),
		createHash('sha256').update(genuineBytes).digest('hex'),
	);
});

test('canonical media content rejects structural Blob impostors', () => {
	assert.throws(
		() => canonicalMediaContentBlob({
			size: 4,
			type: 'audio/forged',
			slice: () => new Blob(['fake']),
			arrayBuffer: async () => new ArrayBuffer(4),
		}),
		{
			name: 'TypeError',
			message: 'Retained media content must be a genuine Blob or File.',
		},
	);
});

test('media content SHA-256 is incremental, lowercase, and bounded to Blob slices', async () => {
	const bytes = Uint8Array.from({ length: 23 }, (_, index) => (index * 29 + 7) & 0xff);
	const blob = new ObservedBlob([bytes]);
	const digest = await digestMediaContent(blob, { chunkBytes: 5 });

	assert.equal(digest, createHash('sha256').update(bytes).digest('hex'));
	assert.match(digest, /^[a-f0-9]{64}$/u);
	assert.deepEqual(blob.slices, [
		{ start: 0, end: 5 },
		{ start: 5, end: 10 },
		{ start: 10, end: 15 },
		{ start: 15, end: 20 },
		{ start: 20, end: 23 },
	]);
});

test('media content SHA-256 supports a zero-byte Blob without scheduling a read', async () => {
	const blob = new ObservedBlob([]);
	assert.equal(
		await digestMediaContent(blob),
		'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	);
	assert.deepEqual(blob.slices, []);
});

test('media content SHA-256 rejects a pre-aborted zero-byte operation with its exact reason', async () => {
	const controller = new AbortController();
	const reason = new Error('do not retain this empty original');
	controller.abort(reason);

	await assert.rejects(
		() => digestMediaContent(new Blob([]), { signal: controller.signal }),
		(error: unknown) => error === reason,
	);
});

test('media content SHA-256 checks cancellation after every awaited slice read', async () => {
	const controller = new AbortController();
	const reason = new Error('stop retaining this original');
	const blob = new ObservedBlob([Uint8Array.of(1, 2, 3, 4)], (readCount) => {
		if (readCount === 1) controller.abort(reason);
	});

	await assert.rejects(
		() => digestMediaContent(blob, { chunkBytes: 2, signal: controller.signal }),
		(error: unknown) => error === reason,
	);
	assert.deepEqual(blob.slices, [{ start: 0, end: 2 }]);
});

test('media content SHA-256 rejects unsafe Blob sizes and malformed chunk limits', async () => {
	const unsafeSize = new Blob([]);
	Object.defineProperty(unsafeSize, 'size', { value: Number.MAX_SAFE_INTEGER + 1 });

	await assert.rejects(() => digestMediaContent(unsafeSize), /Blob size.*safe integer/u);
	for (const chunkBytes of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
		await assert.rejects(
			() => digestMediaContent(new Blob([]), { chunkBytes }),
			/chunkBytes.*positive safe integer/u,
		);
	}
});

test('media content SHA-256 chunk memory cap cannot be raised by callers', async () => {
	await assert.rejects(
		() => digestMediaContent(new Blob([]), {
			chunkBytes: MEDIA_CONTENT_DIGEST_CHUNK_BYTES + 1,
		}),
		/chunkBytes.*hard limit/u,
	);
	assert.equal(
		await digestMediaContent(new Blob([Uint8Array.of(1)]), {
			chunkBytes: MEDIA_CONTENT_DIGEST_CHUNK_BYTES,
		}),
		createHash('sha256').update(Uint8Array.of(1)).digest('hex'),
	);
});

test('media content SHA-256 rejects truncated or oversized slice reads', async () => {
	class MalformedSliceBlob extends Blob {
		readonly #returnedBytes: number;

		constructor(returnedBytes: number) {
			super([Uint8Array.of(1, 2, 3, 4)]);
			this.#returnedBytes = returnedBytes;
		}

		override slice(): Blob {
			const returnedBytes = this.#returnedBytes;
			return new class extends Blob {
				override async arrayBuffer(): Promise<ArrayBuffer> {
					return new ArrayBuffer(returnedBytes);
				}
			}();
		}
	}

	await assert.rejects(
		() => digestMediaContent(new MalformedSliceBlob(3), { chunkBytes: 4 }),
		/slice returned 3 bytes; expected 4/u,
	);
	await assert.rejects(
		() => digestMediaContent(new MalformedSliceBlob(5), { chunkBytes: 4 }),
		/slice returned 5 bytes; expected 4/u,
	);
});
