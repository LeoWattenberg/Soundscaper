/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createBaselineAudioEditorProject, importBaselineScapeProject } from './helpers/baseline-scape-runtime.ts';
import { attachExternalMedia, externalMediaForSource, consolidateExternalMediaCommands, type ExternalMedia } from '../src/common/editor/desktop-external-media.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { prepareExternalMediaConsolidation } from '../src/common/editor/controller/document/internal/native-project/consolidate-external-media.ts';
import { packPlanarFloat32 } from '../src/common/editor/wavpack/index.js';
import { prepareScapeExport } from '../src/common/editor/scape-export-plan.ts';

const original = new Blob(['external audio'], { type: 'audio/mpeg' });
const channels = [new Float32Array([0.25, -0.5, 0.75, 0])];
const pcm = new Uint8Array(20);
new DataView(pcm.buffer).setUint32(0, 4, true);
pcm.set(new Uint8Array(packPlanarFloat32(channels)), 4);
const reference = { reference: 'opaque-native-file-reference', byteLength: original.size,
	sha256: digestScapeBytes(new TextEncoder().encode('external audio')) };

async function fixture() {
	const store = memoryStore();
	const source = attachExternalMedia({ kind: 'audio', id: 'external-audio', storageKey: 'external-audio',
		name: 'original.mp3', mimeType: 'audio/mpeg', frameCount: 4, channelCount: 1,
		contentSha256: digestScapeBytes(pcm),
		sampleRate: 48_000, originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 4,
		opaqueExtensions: {} }, reference, 'audio');
	const project = createBaselineAudioEditorProject({ title: 'External media', sources: [source],
		clips: [{ kind: 'audio', id: 'clip', sourceId: source.id, timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4 }],
		tracks: [{ type: 'audio', id: 'track', name: 'Audio', clipIds: ['clip'] }] });
	const writer = await store.beginSourceWrite(source.id, source);
	await writer.write(channels);
	await writer.commit();
	return { project, store };
}

test('desktop saves reference imported media while browser saves embed it', async () => {
	const { project, store } = await fixture();
	try {
		const desktop = await exportScapeProject(project, store, { externalMedia: true });
		assert.equal(desktop.manifest.assets[0]?.encoding, 'external-file-v1');
		const browser = await exportScapeProject(project, store);
		assert.equal(browser.manifest.assets[0]?.encoding, 'audio-f32le-chunks-v1');
		assert.equal(externalMediaForSource(project.sources[0])?.reference, reference.reference);
	} finally { await store.close(); }
});

test('external archives reopen from the verified original into a fresh store', async () => {
	const { project, store } = await fixture();
	const target = memoryStore();
	try {
		const exported = await exportScapeProject(project, store, { externalMedia: true });
		const imported = await importBaselineScapeProject(exported.blob, target, {
			resolveExternalMedia: async () => original,
			decodeExternalAudio: async () => channels,
		});
		assert.equal(externalMediaForSource(imported.project.sources[0])?.reference, reference.reference, JSON.stringify(imported.project.sources[0]));
		assert.equal((await target.getSourceMetadata(imported.project.sources[0]!.id))?.frameCount, 4);
		await assert.rejects(importBaselineScapeProject(exported.blob, target), /desktop|external/i);
		await assert.rejects(importBaselineScapeProject(exported.blob, target, {
			resolveExternalMedia: async () => new Blob(['changed']), decodeExternalAudio: async () => channels,
		}), /changed|digest|match/i);
		await assert.rejects(importBaselineScapeProject(exported.blob, target, {
			resolveExternalMedia: async () => original,
			decodeExternalAudio: async () => [new Float32Array(4)],
		}), /different samples/i);
	} finally { await store.close(); await target.close(); }
});

test('a missing external source releases grants and rolls back earlier restored media', async () => {
	const { project, store } = await fixture();
	const target = memoryStore();
	let released = 0;
	try {
		const second = { ...project.sources[0]!, id: 'second', storageKey: 'second' };
		const exported = await exportScapeProject({ ...project, sources: [...project.sources, second] }, store, { externalMedia: true });
		await assert.rejects(importBaselineScapeProject(exported.blob, target, {
			resolveExternalMedia: async (_reference: ExternalMedia, sourceId: string) => {
				if (sourceId === 'second') throw new Error('The second original is unavailable.');
				return { file: original, async release() { released += 1; } };
			},
			decodeExternalAudio: async () => channels,
		}), /second original is unavailable/u);
		assert.equal(released, 1);
		assert.equal(await target.getSourceMetadata('external-audio'), null);
	} finally { await store.close(); await target.close(); }
});

function memoryStore() {
	return createProjectStore({ databaseName: `external-media-${crypto.randomUUID()}`, indexedDB: null,
		storageManager: null, opfsRoot: null, memoryFallback: true });
}

test('consolidating removes references and the next desktop save embeds media', async () => {
	const { project, store } = await fixture();
	try {
		const commands = await prepareExternalMediaConsolidation(project, store, () => {});
		assert.equal(commands.length, 1);
		const source = project.sources[0]!;
		Object.assign(source, commands[0]!.changes);
		assert.equal(externalMediaForSource(source), null);
		const exported = await exportScapeProject(project, store, { externalMedia: true });
		assert.equal(exported.manifest.assets[0]?.encoding, 'audio-f32le-chunks-v1');
	} finally { await store.close(); }
});

test('external descriptor entries retain the export planner collision guard', async () => {
	const { project, store } = await fixture();
	try {
		await assert.rejects(prepareScapeExport(project, store, { output: 'blob', externalMedia: true,
			additionalAssets: [{ source: { id: 'extra', kind: 'attachment' }, sourceId: 'extra',
				kind: 'attachment', storageKey: 'extra', entry: 'references/external-audio.json',
				encoding: 'original', mimeType: 'application/octet-stream', size: 1, expectedSha256: 'a'.repeat(64) }],
		}), /Duplicate Scape archive entry/u);
	} finally { await store.close(); }
});

test('processing an imported source cannot save a reference that restores its original samples', async () => {
	const { project, store } = await fixture();
	try {
		const processed = { ...project.sources[0]!, contentSha256: 'f'.repeat(64) };
		assert.equal(externalMediaForSource(processed), null);
		const exported = await exportScapeProject({ ...project, sources: [processed] }, store, { externalMedia: true });
		assert.equal(exported.manifest.assets[0]?.encoding, 'audio-f32le-chunks-v1');
		assert.equal(externalMediaForSource({ ...project.sources[0]!, sampleRate: 44_100 }), null);
		assert.equal(consolidateExternalMediaCommands([processed], new Set([processed.id])).length, 0);
	} finally { await store.close(); }
});

test('external video reopens and a consolidated copy opens without its original', async () => {
	const video = new Blob(['external video'], { type: 'video/mp4' });
	const digest = digestScapeBytes(new TextEncoder().encode('external video'));
	const source = attachExternalMedia({ kind: 'video', id: 'video', storageKey: 'video', name: 'original.mp4',
		mimeType: 'video/mp4', contentSha256: digest, frameCount: 48_000, sampleRate: 48_000,
		width: 16, height: 16, frameRate: 30, videoCodec: 'h264', audioCodec: null, hasAudio: false },
	{ reference: 'native-video-original', byteLength: video.size, sha256: digest }, 'video');
	const project = createBaselineAudioEditorProject({ sources: [source], clips: [{ kind: 'video',
		id: 'video-clip', sourceId: 'video', timelineStartFrame: 0, sourceStartFrame: 0,
		sourceDurationFrames: 48_000, durationFrames: 48_000 }],
	tracks: [{ type: 'video', id: 'video-track', name: 'Video', clipIds: ['video-clip'] }] });
	const store = memoryStore(), fresh = memoryStore();
	try {
		const exported = await exportScapeProject(project, store, { externalMedia: true });
		assert.equal(exported.manifest.assets[0]?.encoding, 'external-file-v1');
		const imported = await importBaselineScapeProject(exported.blob, store, { resolveExternalMedia: async () => video });
		const commands = await prepareExternalMediaConsolidation(imported.project, store, () => {});
		assert.equal(commands.length, 1);
		Object.assign(imported.project.sources[0]!, commands[0]!.changes);
		const consolidated = await exportScapeProject(imported.project, store, { externalMedia: true });
		assert.equal(consolidated.manifest.assets[0]?.encoding, 'original');
		const restored = await importBaselineScapeProject(consolidated.blob, fresh);
		const body = await fresh.loadMediaAsset(restored.project.sources[0]!.id);
		assert.ok(body);
		assert.equal(new TextDecoder().decode(await body.slice(0, body.size).arrayBuffer()), 'external video');
	} finally { await store.close(); await fresh.close(); }
});
