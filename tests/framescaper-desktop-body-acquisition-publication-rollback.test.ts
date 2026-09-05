/* SPDX-License-Identifier: AGPL-3.0-only */

// A publication that fails its descriptor assertion is already a committed body. Acquisition must
// roll it back with every earlier publication instead of leaving it to abort(), which the write
// repository answers as a no-op once the writer has committed — the asset would stay retained.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { OwnedMediaAssetWriter } from '../src/common/editor/storage/media-asset-write-contract.ts';
import { acquireFramescaperDesktopBodies } from '../src/framescaper/desktop-project-library-body-transfer.ts';
import { acquireFramescaperDesktopCoreBodies } from '../src/framescaper/desktop-project-library-core-body-transfer.ts';
import type { FramescaperProject } from '../src/framescaper/editor-project.ts';

type Data = Record<string, unknown>;

interface StoreLog {
	readonly begun: string[]; readonly committed: string[];
	readonly aborted: string[]; readonly discarded: string[];
}

const UTF8 = new TextEncoder();
const PROJECT_SHA256 = 'ab'.repeat(32);
const MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;
const FIRST_BYTES = UTF8.encode('framescaper first managed original body');
const SECOND_BYTES = UTF8.encode('framescaper second managed original body');

function digestOf(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

/** The one descriptor shape both acquisition entry points admit for a plain managed original. */
function descriptorOf(bytes: Uint8Array): Data {
	const sha256 = digestOf(bytes);
	const storageKey = `media-sha256:${sha256}`;
	return {
		kind: 'video-original', encoding: 'framescaper-video-original-v1',
		sourceId: storageKey, storageKey, mimeType: 'video/mp4',
		byteLength: bytes.byteLength, sha256,
	};
}

function sourceOf(bytes: Uint8Array, index: number): Data {
	const descriptor = descriptorOf(bytes);
	return {
		kind: 'video', id: `video-${String(index)}`, name: `take ${String(index)}`, imageSequence: null,
		storageKey: descriptor.storageKey, mimeType: 'video/mp4', contentSha256: descriptor.sha256,
		timingAsset: null, proxyAttachment: null,
	};
}

function projectOf(...bodies: readonly Uint8Array[]): FramescaperProject {
	return {
		sources: bodies.map(sourceOf), videoFreezeFallbacks: [], videoFinishingPresets: [],
		videoProcessorStacks: [], videoMotionAnalyses: [], videoVisualPresentations: [],
		assistanceAssets: [],
	} as unknown as FramescaperProject;
}

function emptyLog(): StoreLog {
	return { begun: [], committed: [], aborted: [], discarded: [] };
}

function chunkBridge(bodies: readonly Uint8Array[]) {
	const bytesByKey = new Map(bodies.map((bytes) => [descriptorOf(bytes).storageKey as string, bytes]));
	return {
		async readBodyChunk({ body, offset, length }: Readonly<{
			body: Readonly<{ storageKey: string }>; offset: number; length: number;
		}>): Promise<unknown> {
			return bytesByKey.get(body.storageKey)?.slice(offset, offset + length) ?? new Uint8Array();
		},
	};
}

/**
 * A store that retains nothing up front, records every publication, and misreports the size of the
 * one publication named by `failingKey`. `retained` mirrors the repository: abort() after a commit
 * returns early and leaves the asset in place, so only discardIfCurrent() can remove it.
 */
function acquisitionStore(log: StoreLog, failingKey: string) {
	const retained = new Set<string>();
	const store = {
		getMediaAssetMetadata: () => null,
		loadMediaAsset(key: string): never { throw new Error(`${key} is not retained.`); },
		beginMediaAssetWrite(
			key: string,
			metadata: Readonly<Record<string, unknown>>,
			options: Readonly<{ expectedBytes: number; expectedSha256: string }>,
		): Promise<OwnedMediaAssetWriter> {
			log.begun.push(key);
			const published = {
				sourceId: key, mimeType: metadata.mimeType as string,
				size: options.expectedBytes, sha256: options.expectedSha256,
			};
			let committed = false;
			return Promise.resolve({
				maximumChunkBytes: MAXIMUM_CHUNK_BYTES, bytesWritten: 0,
				async write() { /* the acquisition digests the bytes itself */ },
				async commit() { throw new Error('An owned publication is required.'); },
				async commitOwned() {
					committed = true;
					retained.add(key);
					log.committed.push(key);
					return {
						metadata: key === failingKey ? { ...published, size: published.size + 1 } : published,
						async discardIfCurrent() { log.discarded.push(key); return retained.delete(key); },
					};
				},
				async abort() {
					log.aborted.push(key);
					if (!committed) retained.delete(key);
				},
			} satisfies OwnedMediaAssetWriter);
		},
	};
	return { store, retained };
}

test('core acquisition discards the publication whose descriptor assertion failed', async () => {
	const [first, second] = [descriptorOf(FIRST_BYTES), descriptorOf(SECOND_BYTES)];
	const log = emptyLog();
	const { store, retained } = acquisitionStore(log, second.storageKey as string);
	await assert.rejects(acquireFramescaperDesktopCoreBodies(
		projectOf(FIRST_BYTES, SECOND_BYTES), PROJECT_SHA256, [first, second],
		chunkBridge([FIRST_BYTES, SECOND_BYTES]), store,
	), /video-original publication changed its descriptor/u);
	assert.deepEqual(log.committed, [first.storageKey, second.storageKey]);
	assert.deepEqual(log.discarded, [second.storageKey, first.storageKey]);
	assert.deepEqual(log.aborted, []);
	assert.deepEqual([...retained], []);
});

test('baseline acquisition discards the publication whose descriptor assertion failed', async () => {
	const [first, second] = [descriptorOf(FIRST_BYTES), descriptorOf(SECOND_BYTES)];
	const log = emptyLog();
	const { store, retained } = acquisitionStore(log, second.storageKey as string);
	await assert.rejects(acquireFramescaperDesktopBodies(
		projectOf(FIRST_BYTES, SECOND_BYTES), PROJECT_SHA256, [first, second],
		chunkBridge([FIRST_BYTES, SECOND_BYTES]), store,
	), /video-original publication changed its descriptor/u);
	assert.deepEqual(log.committed, [first.storageKey, second.storageKey]);
	assert.deepEqual(log.discarded, [second.storageKey, first.storageKey]);
	assert.deepEqual(log.aborted, []);
	assert.deepEqual([...retained], []);
});
