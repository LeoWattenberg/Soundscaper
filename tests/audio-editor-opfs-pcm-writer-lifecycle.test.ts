/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import { syncPcmWriter } from '../src/common/editor/storage/opfs-sync-writer-adapters.ts';
import type {
	OpfsSyncStoragePort,
	OpfsSyncWriter,
} from '../src/common/editor/storage/opfs-sync-worker-client.ts';
import { crc32, PCM_ENCODING_RAW_F32LE } from '../src/common/editor/wavpack/index.js';

interface PcmWriter {
	write(chunk: Record<string, unknown> & {
		readonly frames: number;
		readonly channelCount: number;
		readonly sampleRate: number;
		readonly chunkFrames: number;
	}): Promise<void>;
	close(): Promise<Record<string, unknown>>;
}

interface BlockedWriterHarness {
	readonly writer: PcmWriter;
	readonly writes: () => number;
	readonly closes: () => number;
	releasePayload(): void;
}

type WriterFactory = () => Promise<BlockedWriterHarness>;

const writerFactories: ReadonlyArray<readonly [string, WriterFactory]> = [
	['worker-backed', async () => {
		let writes = 0;
		let closes = 0;
		let releasePayload!: () => void;
		const payloadGate = new Promise<void>((resolve) => { releasePayload = resolve; });
		const backend: OpfsSyncWriter = {
			async write() {
				writes += 1;
				if (writes === 2) await payloadGate;
			},
			async close() { closes += 1; },
			async abort() {},
		};
		return {
			writer: syncPcmWriter(
				'worker-race.scpcm', backend, { sampleRate: 48_000, chunkFrames: 2 },
				() => undefined, async () => undefined,
			),
			writes: () => writes,
			closes: () => closes,
			releasePayload,
		};
	}],
	['async', async () => {
		let writes = 0;
		let closes = 0;
		let releasePayload!: () => void;
		const payloadGate = new Promise<void>((resolve) => { releasePayload = resolve; });
		const writable = {
			async write() {
				writes += 1;
				if (writes === 2) await payloadGate;
			},
			async close() { closes += 1; },
			async abort() {},
		};
		const directory = {
			async getFileHandle() {
				return { async createWritable() { return writable; } };
			},
			async removeEntry() {},
		} as unknown as FileSystemDirectoryHandle;
		const repository = new OpfsRepository({
			preferOpfs: true,
			opfsRoot: {
				async getDirectoryHandle() { return directory; },
			} as unknown as FileSystemDirectoryHandle,
			syncWorkerClient: unavailableSyncWorker(),
		});
		const writer = await repository.createPcmWriter(
			'async-race', { sampleRate: 48_000, chunkFrames: 2 },
		);
		assert.ok(writer);
		return { writer, writes: () => writes, closes: () => closes, releasePayload };
	}],
];

for (const [backendName, createWriter] of writerFactories) {
	test(`${backendName} PCM close waits for a started write and joins concurrent closes`, async () => {
		const harness = await createWriter();
		const writing = harness.writer.write(pcmChunk());
		await waitFor(() => harness.writes() === 2);
		const firstClose = harness.writer.close();
		const secondClose = harness.writer.close();
		await settleMicrotasks();
		const closesBeforeWriteSettled = harness.closes();

		harness.releasePayload();
		const [writeResult, firstCloseResult, secondCloseResult] = await Promise.allSettled([
			writing, firstClose, secondClose,
		]);

		assert.equal(closesBeforeWriteSettled, 0, 'the container must not finalize ahead of its active write');
		assert.equal(writeResult.status, 'fulfilled');
		assert.equal(firstCloseResult.status, 'fulfilled');
		assert.equal(secondCloseResult.status, 'fulfilled');
		assert.deepEqual(firstCloseResult, secondCloseResult);
		assert.equal(harness.closes(), 1, 'concurrent closes must share one backend close');
		await harness.writer.close();
		assert.equal(harness.closes(), 1, 'a finalized writer stays idempotently closed');
	});
}

function pcmChunk(): Record<string, unknown> & {
	readonly frames: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly chunkFrames: number;
} {
	const payload = new Float32Array([0.25, -0.5]);
	return {
		encoding: PCM_ENCODING_RAW_F32LE,
		payload: payload.buffer,
		pcmCrc32: crc32(new Uint8Array(payload.buffer)),
		frames: 2,
		channelCount: 1,
		sampleRate: 48_000,
		chunkFrames: 2,
	};
}

function unavailableSyncWorker(): OpfsSyncStoragePort {
	return {
		async initialize() { return false; },
		async read() { throw new Error('unavailable'); },
		async snapshot() { throw new Error('unavailable'); },
		async openWriter() { throw new Error('unavailable'); },
		async remove() { throw new Error('unavailable'); },
		close() {},
	};
}

async function settleMicrotasks(): Promise<void> {
	for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20 && !predicate(); attempt += 1) await Promise.resolve();
	assert.equal(predicate(), true, 'expected the PCM write to reach its backend');
}
