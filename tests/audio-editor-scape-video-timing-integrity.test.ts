/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	SCAPE_FORMAT,
	SCAPE_FORMAT_VERSION,
	type ScapeArchiveEntry,
	type ScapeManifest,
} from '../src/common/editor/scape-archive-envelope.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import {
	PROJECT_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
} from '../src/common/editor/project-schema-identity.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import {
	createVideoTimingAssetPublication,
	VIDEO_TIMING_ASSET_ENCODING,
	VIDEO_TIMING_ASSET_MIME_TYPE,
	type VideoTimingAssetReference,
} from '../src/common/editor/video-timing-asset.ts';
import {
	createBaselineAudioEditorProject as createCurrentAudioEditorProject,
	importBaselineScapeProject as importScapeProject,
} from './helpers/baseline-scape-runtime.ts';

const TEXT_ENCODER = new TextEncoder();

test('Scape import rejects self-consistent malformed timing bytes before durable publication', async () => {
	const originalBytes = Uint8Array.of(1, 2, 3, 4);
	const sourceSha256 = digestScapeBytes(originalBytes);
	const valid = createVideoTimingAssetPublication(sourceSha256, {
		timescale: 1_000,
		presentationTicks: [0n, 40n],
		finalFrameDurationTicks: 40n,
	});
	const malformedBytes = new Uint8Array(valid.bytes.byteLength);
	const sha256 = digestScapeBytes(malformedBytes);
	const reference: VideoTimingAssetReference = Object.freeze({
		...valid.reference,
		storageKey: `video-timing-sha256:${sha256}`,
		sha256,
	});
	const fixture = syntheticTimingArchive({
		originalBytes,
		reference,
		timingBytes: malformedBytes,
	});
	const store = memoryStore('scape-malformed-timing');

	await assert.rejects(importScapeProject(new Blob(['synthetic']), store, {
		archiveReaderFactory: fixture.readerFactory,
	}), /timing|magic|codec/iu);
	assert.equal(await store.getMediaAssetMetadata(reference.storageKey), null);
	assert.equal(await store.getMediaAssetMetadata('video-source'), null);
	assert.deepEqual(await store.listProjects(), []);
});

test('Scape import rolls back committed timing media when original video verification fails', async () => {
	const originalBytes = Uint8Array.of(1, 2, 3, 4);
	const sourceSha256 = digestScapeBytes(originalBytes);
	const timing = createVideoTimingAssetPublication(sourceSha256, {
		timescale: 1_000,
		presentationTicks: [0n, 40n],
		finalFrameDurationTicks: 40n,
	});
	const fixture = syntheticTimingArchive({
		originalBytes,
		reference: timing.reference,
		timingBytes: timing.bytes,
		emittedOriginalBytes: Uint8Array.of(9, 9, 9, 9),
	});
	const store = memoryStore('scape-timing-rollback');

	await assert.rejects(importScapeProject(new Blob(['synthetic']), store, {
		archiveReaderFactory: fixture.readerFactory,
	}), /SHA-256 verification/iu);
	assert.equal(await store.getMediaAssetMetadata(timing.reference.storageKey), null);
	assert.equal(await store.getMediaAssetMetadata('video-source'), null);
	assert.deepEqual(await store.listProjects(), []);
});

function syntheticTimingArchive(options: Readonly<{
	originalBytes: Uint8Array;
	reference: Readonly<VideoTimingAssetReference>;
	timingBytes: Uint8Array;
	emittedOriginalBytes?: Uint8Array;
}>) {
	const project = createCurrentAudioEditorProject({
		id: 'scape-timing-integrity',
		sources: [{
			id: 'video-source',
			kind: 'video',
			storageKey: 'video-source',
			name: 'picture.mp4',
			mimeType: 'video/mp4',
			frameCount: 4_800,
			sampleRate: 48_000,
			width: 16,
			height: 16,
			frameRate: { num: 30, den: 1 },
			sourceFrameCount: options.reference.frameCount,
			contentSha256: options.reference.sourceSha256,
			timingAsset: options.reference,
		}],
	});
	const projectBytes = TEXT_ENCODER.encode(JSON.stringify(project));
	const originalEntry = 'media/video-source/original';
	const timingEntry = `timing/${options.reference.sha256}.scti`;
	const manifest: ScapeManifest = {
		format: SCAPE_FORMAT,
		formatVersion: SCAPE_FORMAT_VERSION,
		project: {
			entry: 'project.json',
			schemaFamily: SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
			schemaVersion: PROJECT_SCHEMA_VERSION,
			size: projectBytes.byteLength,
			sha256: digestScapeBytes(projectBytes),
		},
		assets: [{
			sourceId: 'video-source',
			kind: 'video',
			entry: originalEntry,
			encoding: 'original',
			mimeType: 'video/mp4',
			size: options.originalBytes.byteLength,
			sha256: digestScapeBytes(options.originalBytes),
		}, {
			sourceId: options.reference.storageKey,
			kind: 'video-timing',
			entry: timingEntry,
			encoding: VIDEO_TIMING_ASSET_ENCODING,
			mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
			size: options.timingBytes.byteLength,
			sha256: options.reference.sha256,
		}],
	};
	const manifestBytes = TEXT_ENCODER.encode(JSON.stringify(manifest));
	const entries: ScapeArchiveEntry[] = [
		byteEntry('manifest.json', manifestBytes),
		byteEntry('project.json', projectBytes),
		byteEntry(originalEntry, options.emittedOriginalBytes ?? options.originalBytes, options.originalBytes.byteLength),
		byteEntry(timingEntry, options.timingBytes),
	];
	return {
		readerFactory: () => ({
			async *getEntriesGenerator() {
				for (const entry of entries) yield entry;
				return false;
			},
			close: async () => undefined,
		}),
	};
}

function byteEntry(
	filename: string,
	bytes: Uint8Array,
	declaredBytes: number = bytes.byteLength,
): ScapeArchiveEntry {
	return {
		filename,
		directory: false,
		encrypted: false,
		compressionMethod: 0,
		compressedSize: declaredBytes,
		uncompressedSize: declaredBytes,
		async getData(writable, options) {
			if (options?.checkOverlappingEntryOnly) return;
			const output = writable.getWriter();
			await output.write(bytes);
			await output.close();
		},
	};
}

function memoryStore(prefix: string) {
	return createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `${prefix}-${crypto.randomUUID()}`,
	});
}
