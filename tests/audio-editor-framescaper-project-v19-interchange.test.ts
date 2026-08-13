/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	loadCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import { copyFutureScapeArchive } from '../src/common/editor/scape-archive-copy.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { importScapeProject } from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
	normalizeVideoClipComposition,
} from '../src/common/editor/video-clip-composition.ts';
import {
	prepareFramescaperVideoCompositionCrossProductCopyV19,
	restoreFramescaperVideoCompositionCrossProductCopyV19,
} from '../src/framescaper/editor-project-v19-interchange.ts';
import {
	FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v19.ts';
import { createFramescaperProjectStoreV19 } from '../src/framescaper/editor-project-store-v19.ts';
import { createFramescaperScapeNativeRuntimeV19 } from '../src/framescaper/editor-scape-native-v19.ts';
import { applyFramescaperProjectCommandV19 } from '../src/framescaper/editor-project-v19-commands.ts';
import { createFramescaperProjectV19 } from '../src/framescaper/editor-project-v19.ts';

const NOW = '2026-08-13T19:00:00.000Z';
const VIDEO_BYTES = new TextEncoder().encode('framescaper-v19-cross-product-video');
const VIDEO_SHA256 = digestScapeBytes(VIDEO_BYTES);
const COMPOSITION = normalizeVideoClipComposition({
	...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION),
	crop: { left: 0.125, top: 0.25, right: 0, bottom: 0 },
	transform: {
		...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION.transform),
		positionX: 0.75,
		positionY: 0.25,
		scaleX: 1.5,
		rotationDegrees: 22.5,
		flipHorizontal: true,
	},
	opacity: 0.625,
	blendMode: 'screen',
	compositingOrder: 3,
});
const BIN_COMPOSITION = normalizeVideoClipComposition({
	...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION),
	crop: { left: 0, top: 0, right: 0.2, bottom: 0.1 },
	transform: {
		...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION.transform),
		positionX: 0.4,
		scaleY: 0.75,
		flipVertical: true,
	},
	opacity: 0.8,
	blendMode: 'multiply',
	compositingOrder: -2,
});

test('V19 interchange authenticates its product owner before transfer traversal', () => {
	let projectReads = 0;
	const project = new Proxy({}, {
		get() { projectReads += 1; throw new Error('project getter'); },
		getPrototypeOf() { projectReads += 1; throw new Error('project prototype'); },
	});
	assert.throws(() => prepareFramescaperVideoCompositionCrossProductCopyV19(
		{},
		project,
		{ targetProduct: 'soundscaper', mode: 'copy-only-preservation' },
	), /exact Framescaper V19 runtime profile/iu);
	assert.throws(() => restoreFramescaperVideoCompositionCrossProductCopyV19({}, project),
		/exact Framescaper V19 runtime profile/iu);
	assert.equal(projectReads, 0);
});

test('V19 composition transfer is an exact copy-only contract and only V19 can restore it', () => {
	const project = compositionProject();
	const transfer = prepareFramescaperVideoCompositionCrossProductCopyV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		project,
		{ targetProduct: 'soundscaper', mode: 'copy-only-preservation' },
	);

	assert.deepEqual(transfer, {
		kind: 'framescaper-video-composition-cross-product-copy',
		targetProduct: 'soundscaper',
		mode: 'copy-only-preservation',
		activation: 'forbidden',
		editable: false,
		projectSha256: transfer.projectSha256,
		project,
	});
	assert.match(transfer.projectSha256, /^[a-f0-9]{64}$/u);
	assert.equal(Object.isFrozen(transfer), true);
	assert.notStrictEqual(transfer.project, project);
	assert.notStrictEqual(transfer.project.clips[0]?.videoComposition, project.clips[0]?.videoComposition);
	assert.notStrictEqual(
		transfer.project.projectBin.clips[0]?.videoComposition,
		project.projectBin.clips[0]?.videoComposition,
	);
	assert.deepEqual(loadCurrentAudioEditorProject(transfer.project), {
		project,
		readOnly: true,
		reason: 'newer-schema',
	});
	assert.throws(() => validateCurrentAudioEditorProject(transfer.project), /schema version|schemaVersion/iu);

	const restored = restoreFramescaperVideoCompositionCrossProductCopyV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		transfer,
	);
	assert.deepEqual(restored, project);
	assert.notStrictEqual(restored, transfer.project);
	assert.notStrictEqual(
		restored.clips[0]?.videoComposition,
		transfer.project.clips[0]?.videoComposition,
	);
	assert.deepEqual(restored.clips[0]?.videoComposition, COMPOSITION);
	assert.deepEqual(restored.projectBin.clips[0]?.videoComposition, BIN_COMPOSITION);
	assert.equal(JSON.stringify(restored), JSON.stringify(project));

	assert.throws(() => restoreFramescaperVideoCompositionCrossProductCopyV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		{ ...transfer, editable: true },
	), /editable.*false/iu);
	const changed = structuredClone(transfer);
	(changed.project as unknown as Record<string, unknown>).title = 'Soundscaper must not edit this copy';
	assert.throws(() => restoreFramescaperVideoCompositionCrossProductCopyV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		changed,
	), /changed during preservation/iu);
	assert.throws(() => prepareFramescaperVideoCompositionCrossProductCopyV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		project,
		{ targetProduct: 'framescaper', mode: 'copy-only-preservation' } as never,
	), /target Soundscaper/iu);
});

test('Soundscaper copies a V19 Scape byte-for-byte without publication before V19 reopens it', async (context) => {
	const sender = memoryStore(context, 'sender');
	const soundscaper = memoryStore(context, 'soundscaper');
	const framescaper = createFramescaperProjectStoreV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		{ indexedDB: null },
	);
	const runtime = createFramescaperScapeNativeRuntimeV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
	);
	context.after(async () => {
		await Promise.all([sender.close(), soundscaper.close(), framescaper.close()]);
	});
	await sender.writeMediaAsset(
		'video-source',
		new Blob([VIDEO_BYTES], { type: 'video/mp4' }),
		{ name: 'Cross product.mp4', mimeType: 'video/mp4' },
	);
	const project = compositionProject();
	const exported = await runtime.exportScapeProject(project, sender);
	assert.ok(exported.blob);

	const preserved = await importScapeProject(exported.blob, soundscaper);
	assert.equal(preserved.readOnly, true);
	assert.equal(preserved.reason, 'newer-schema');
	assert.equal(preserved.collision, null);
	assert.deepEqual(
		(preserved.project.clips as ReadonlyArray<{ readonly videoComposition?: unknown }>)[0]
			?.videoComposition,
		COMPOSITION,
	);
	assert.deepEqual(
		((preserved.project.projectBin as Readonly<{ readonly clips: ReadonlyArray<{
			readonly videoComposition?: unknown;
		}> }>).clips)[0]?.videoComposition,
		BIN_COMPOSITION,
	);
	assert.equal(await soundscaper.loadProject(project.id), null);
	assert.equal(await soundscaper.getMediaAssetMetadata('video-source'), null);

	const chunks: Uint8Array[] = [];
	const copied = await copyFutureScapeArchive(
		exported.blob,
		(bytes) => { chunks.push(bytes.slice()); },
	);
	const copiedBytes = join(chunks);
	assert.deepEqual(copied, { byteLength: exported.blob.size, schemaVersion: 19 });
	assert.deepEqual(copiedBytes, new Uint8Array(await exported.blob.arrayBuffer()));

	const returned = await runtime.importScapeProject(
		new Blob([copiedBytes], { type: 'application/x-scape-project' }),
		framescaper,
	);
	assert.equal(returned.readOnly, false);
	assert.deepEqual(returned.project, project);
	assert.notStrictEqual(
		returned.project.clips[0]?.videoComposition,
		project.clips[0]?.videoComposition,
	);
	assert.deepEqual(returned.project.clips[0]?.videoComposition, COMPOSITION);
	assert.deepEqual(returned.project.projectBin.clips[0]?.videoComposition, BIN_COMPOSITION);
	const reopened = await framescaper.loadProject(project.id);
	assert.ok(reopened);
	assert.deepEqual(
		(reopened.clips as ReadonlyArray<{ readonly videoComposition?: unknown }>)[0]
			?.videoComposition,
		COMPOSITION,
	);
	assert.deepEqual(
		((reopened.projectBin as Readonly<{ readonly clips: ReadonlyArray<{
			readonly videoComposition?: unknown;
		}> }>).clips)[0]?.videoComposition,
		BIN_COMPOSITION,
	);
	const reopenedMedia = await framescaper.loadMediaAsset('video-source');
	assert.ok(reopenedMedia);
	assert.deepEqual(new Uint8Array(await reopenedMedia.arrayBuffer()), VIDEO_BYTES);
});

function compositionProject() {
	const project = createFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, {
		id: 'framescaper-v19-cross-product',
		title: 'Framescaper V19 cross product',
		now: NOW,
		sources: [createVideoSourceV10({
			id: 'video-source', name: 'Cross product.mp4', storageKey: 'video-source',
			mimeType: 'video/mp4', contentSha256: VIDEO_SHA256,
			frameCount: 48_000, sampleFrameCount: 48_000, sourceFrameCount: 10,
			frameRate: { num: 10, den: 1 }, width: 1_920, height: 1_080,
		})],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'Video',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
		}],
		projectBin: {
			clips: [{
				kind: 'video', id: 'bin-video', sourceId: 'video-source', title: 'Bin video',
				sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
				sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null, binItemId: 'bin-video',
			}],
		},
		tracks: [createVideoTrackV10({
			id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: false,
		})],
		sequences: [{
			id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track'],
		}],
		primarySequenceId: 'main-sequence',
	});
	const timelineComposition = applyFramescaperProjectCommandV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		project,
		{
			type: 'video-composition/set',
			clipId: 'video-clip',
			expectedComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
			composition: COMPOSITION,
		},
		{ now: NOW },
	);
	return applyFramescaperProjectCommandV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		timelineComposition,
		{
			type: 'video-composition/set',
			clipId: 'bin-video',
			expectedComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
			composition: BIN_COMPOSITION,
		},
		{ now: NOW },
	);
}

function memoryStore(context: TestContext, label: string) {
	return createProjectStore({
		databaseName: `framescaper-v19-cross-product-${label}-${context.name.replace(/\W+/gu, '-')}-${Date.now()}`,
	});
}

function join(chunks: readonly Uint8Array[]): Uint8Array {
	const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
	const bytes = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}
