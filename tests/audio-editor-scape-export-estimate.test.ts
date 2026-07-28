/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BlobWriter,
	Uint8ArrayReader,
	ZipWriter,
} from '@zip.js/zip.js';

import {
	SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES,
	maximumScapeStoreArchiveBytes,
} from '../src/common/editor/scape-export-estimate.ts';
import { scapeAudioSourceLayout } from '../src/common/editor/scape-archive-media.ts';
import { createAudioEditorProjectV6 } from '../src/common/editor/project-v6.ts';
import { exportScapeProject, inspectScapeProject } from '../src/common/editor/scape-project.js';

const TEXT_ENCODER = new TextEncoder();

test('Scape audio layout accounts exact PCM and per-chunk framing with checked arithmetic', () => {
	assert.deepEqual(scapeAudioSourceLayout({
		id: 'audio',
		frameCount: 5,
		channelCount: 2,
		chunkFrames: 2,
	}), {
		frameCount: 5,
		channelCount: 2,
		chunkFrames: 2,
		chunkCount: 3,
		rawPcmBytes: 40,
		archiveBytes: 52,
	});
	assert.deepEqual(scapeAudioSourceLayout({
		id: 'empty',
		frameCount: 0,
		channelCount: 1,
		chunkFrames: 1,
	}), {
		frameCount: 0,
		channelCount: 1,
		chunkFrames: 1,
		chunkCount: 0,
		rawPcmBytes: 0,
		archiveBytes: 0,
	});
	assert.throws(
		() => scapeAudioSourceLayout({
			id: 'unsafe',
			frameCount: Number.MAX_SAFE_INTEGER,
			channelCount: 64,
			chunkFrames: 65_536,
		}),
		/safe integer range/iu,
	);
});

test('STORE/Zip64 estimate bounds the pinned writer profile and UTF-8 filenames', async () => {
	const entries = [
		{ filename: 'project.json', payload: new Uint8Array(13) },
		{ filename: 'média/ß.bin', payload: new Uint8Array(5) },
	];
	const estimate = maximumScapeStoreArchiveBytes(entries.map((entry) => ({
		filename: entry.filename,
		payloadBytes: entry.payload.byteLength,
	})));
	const expected = 98 + entries.reduce((total, entry) => total
		+ entry.payload.byteLength
		+ 238
		+ 2 * TEXT_ENCODER.encode(entry.filename).byteLength, 0);
	assert.equal(estimate, expected);

	const writer = new ZipWriter(new BlobWriter('application/zip'), {
		dataDescriptor: true,
		dataDescriptorSignature: true,
		extendedTimestamp: true,
		zip64: true,
		level: 0,
		useWebWorkers: false,
	});
	for (const entry of entries) {
		await writer.add(entry.filename, new Uint8ArrayReader(entry.payload), {
			zip64: true,
			level: 0,
		});
	}
	const blob = await writer.close(undefined, { zip64: true });
	assert.ok(blob instanceof Blob);
	assert.equal(estimate - blob.size, entries.length * 8);

	assert.throws(
		() => maximumScapeStoreArchiveBytes([{ filename: 'x', payloadBytes: -1 }]),
		/safe non-negative integer/iu,
	);
	assert.throws(
		() => maximumScapeStoreArchiveBytes([{
			filename: 'x'.repeat(65_536),
			payloadBytes: 0,
		}]),
		/filename.*65.?535/iu,
	);
	assert.throws(
		() => maximumScapeStoreArchiveBytes(Array.from(
			{ length: 4_097 },
			(_, index) => ({ filename: `entry-${String(index)}`, payloadBytes: 0 }),
		)),
		/too many entries/iu,
	);
});

test('Blob admission rejects declared audio before PCM reads and cannot be raised', async () => {
	let pcmReads = 0;
	const store = {
		async getMediaAssetMetadata() { return null; },
		async loadMediaAsset() { return null; },
		readSourceChunks() {
			pcmReads += 1;
			return (async function* () { yield [Float32Array.of(0)]; })();
		},
	};
	const project = audioProject('audio-blob-admission', 1, 1);

	await assert.rejects(
		exportScapeProject(project, store, { maximumBlobBytes: 1 }),
		/final Blob assembly limit/iu,
	);
	assert.equal(pcmReads, 0);
	await assert.rejects(
		exportScapeProject(project, store, {
			maximumBlobBytes: SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES + 1,
		}),
		/cannot exceed the hard limit/iu,
	);
	assert.equal(pcmReads, 0);
});

test('video admission uses scalar metadata and rejects size drift before payload streaming', async () => {
	let metadataReads = 0;
	let mediaLoads = 0;
	let streamReads = 0;
	const project = videoProject('video-blob-admission');
	const oversizedStore = {
		async getMediaAssetMetadata() { metadataReads += 1; return { size: 1_024 }; },
		async loadMediaAsset() { mediaLoads += 1; return new Blob([new Uint8Array(1_024)]); },
		readSourceChunks() { return (async function* () {})(); },
	};

	await assert.rejects(
		exportScapeProject(project, oversizedStore, { maximumBlobBytes: 1 }),
		/final Blob assembly limit/iu,
	);
	assert.equal(metadataReads, 1);
	assert.equal(mediaLoads, 0);

	class TrackedBlob extends Blob {
		override stream() {
			streamReads += 1;
			return super.stream();
		}
	}
	const driftStore = {
		async getMediaAssetMetadata() { return { size: 1 }; },
		async loadMediaAsset() { return new TrackedBlob(['two']); },
		readSourceChunks() { return (async function* () {})(); },
	};
	await assert.rejects(
		exportScapeProject(project, driftStore),
		/changed since archive admission/iu,
	);
	assert.equal(streamReads, 0);
});

test('save admission snapshots source geometry before awaited metadata work', async () => {
	const audio = {
		kind: 'audio',
		id: 'captured-audio',
		storageKey: 'captured-audio',
		name: 'captured.wav',
		mimeType: 'audio/wav',
		frameCount: 1,
		channelCount: 1,
		sampleRate: 48_000,
		chunkFrames: 1,
	};
	const project = {
		...projectOnly('source-snapshot'),
		sources: [videoProject('source-snapshot').sources[0], audio],
	};
	const store = {
		async getMediaAssetMetadata() {
			audio.frameCount = 2;
			return { size: 0 };
		},
		async loadMediaAsset() { return new Blob(); },
		readSourceChunks() {
			return (async function* () { yield [Float32Array.of(0)]; })();
		},
	};

	const exported = await exportScapeProject(project, store);
	assert.equal(audio.frameCount, 2);
	assert.equal(exported.manifest.assets.find(({ sourceId }) => sourceId === audio.id)?.size, 8);
});

test('generated source entry segments remain safe for the Scape importer', async () => {
	const project = createAudioEditorProjectV6({
		id: 'safe-entry-id',
		title: 'Safe entry ID',
		sources: [{
			kind: 'video',
			id: '..',
			storageKey: '..',
			name: 'video.mp4',
			mimeType: 'video/mp4',
			frameCount: 1,
			sampleRate: 48_000,
			width: 1,
			height: 1,
			frameRate: 30,
			videoCodec: 'h264',
			audioCodec: null,
			hasAudio: false,
		}],
	});
	const store = {
		async getMediaAssetMetadata() { return { size: 1 }; },
		async loadMediaAsset() { return new Blob(['x']); },
		readSourceChunks() { return (async function* () {})(); },
	};

	const exported = await exportScapeProject(project, store);
	assert.ok(exported.blob instanceof Blob);
	const inspected = await inspectScapeProject(exported.blob);
	assert.equal(inspected.manifest.assets[0].entry, 'media/_2E_2E/original');
});

test('streamed Scape output is exempt from final-Blob admission', async () => {
	const chunks: Uint8Array[] = [];
	const destination = new WritableStream<Uint8Array>({
		write(chunk) { chunks.push(chunk.slice()); },
	});
	const result = await exportScapeProject(projectOnly('streamed-admission'), emptyStore(), {
		maximumBlobBytes: 1,
		writable: destination,
	});
	assert.equal(result.blob, null);
	assert.ok(chunks.reduce((total, chunk) => total + chunk.byteLength, 0) > 1);
});

test('save admission snapshots its destination classification before awaited metadata', async () => {
	let releaseMetadata: (value: { size: number }) => void = () => undefined;
	const metadata = new Promise<{ size: number }>((resolve) => { releaseMetadata = resolve; });
	const chunks: Uint8Array[] = [];
	const options: {
		maximumBlobBytes: number;
		writable?: WritableStream<Uint8Array>;
	} = {
		maximumBlobBytes: 1,
		writable: new WritableStream<Uint8Array>({
			write(chunk) { chunks.push(chunk.slice()); },
		}),
	};
	const store = {
		getMediaAssetMetadata() { return metadata; },
		async loadMediaAsset() { return new Blob(['x']); },
		readSourceChunks() { return (async function* () {})(); },
	};

	const exporting = exportScapeProject(videoProject('destination-snapshot'), store, options);
	options.writable = undefined;
	releaseMetadata({ size: 1 });
	const exported = await exporting;
	assert.equal(exported.blob, null);
	assert.ok(chunks.length > 0);
});

function projectOnly(id: string) {
	return { schemaVersion: 6, id, title: id, sources: [], clips: [], tracks: [] };
}

function audioProject(id: string, frameCount: number, chunkFrames: number) {
	return {
		...projectOnly(id),
		sources: [{
			kind: 'audio',
			id: 'audio-source',
			storageKey: 'audio-source',
			name: 'audio.wav',
			mimeType: 'audio/wav',
			frameCount,
			channelCount: 1,
			sampleRate: 48_000,
			chunkFrames,
		}],
	};
}

function videoProject(id: string) {
	return {
		...projectOnly(id),
		sources: [{
			kind: 'video',
			id: 'video-source',
			storageKey: 'video-source',
			name: 'video.mp4',
			mimeType: 'video/mp4',
			frameCount: 1,
			sampleRate: 48_000,
		}],
	};
}

function emptyStore() {
	return {
		async getMediaAssetMetadata() { return null; },
		async loadMediaAsset() { return null; },
		readSourceChunks() { return (async function* () {})(); },
	};
}
