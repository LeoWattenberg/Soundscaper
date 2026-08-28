/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	ProjectReimportRequiredError,
} from '../src/common/editor/project-schema-identity.ts';
import { buildClipSchedulePlans } from '../src/common/editor/engine/clip-schedule-plan.ts';
import type { EngineChunkSource, EngineProject } from '../src/common/editor/engine/types.ts';
import { PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS } from
	'../src/common/editor/project-feature-audio-rendered-fallback.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from
	'../src/common/editor/project-feature-capabilities.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { editorProjectStorageProfileNames } from
	'../src/common/editor/storage/project-storage-profile.ts';
import {
	FRAMESCAPER_BASELINE_ENTRY_MODULES,
	FRAMESCAPER_BASELINE_VERSIONED_BOUNDARIES,
} from '../src/framescaper/baseline-versioned-boundaries.ts';
import {
	applyFramescaperProjectCommand,
} from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_HANDSHAKE } from
	'../src/framescaper/desktop-project-library-renderer-contract.ts';
import { connectFramescaperDesktopProjectLibraryRenderer } from
	'../src/framescaper/desktop-project-library-renderer.ts';
import {
	createFramescaperProjectHistory,
	executeFramescaperProjectCommand,
	undoFramescaperProjectCommand,
} from '../src/framescaper/editor-project-history.ts';
import {
	framescaperProjectForRuntimeConsumers,
} from '../src/framescaper/editor-project-runtime.ts';
import { createFramescaperPlaybackProjectService } from
	'../src/framescaper/editor-project-playback.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from
	'../src/framescaper/editor-project-runtime-profile.ts';
import { createEditorProjectRuntimeSelection } from
	'../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_STORAGE_PROFILE } from
	'../src/framescaper/editor-project-storage-profile.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import {
	cloneFramescaperProject,
	createFramescaperProject,
	loadFramescaperProject,
	validateFramescaperProject,
	type FramescaperProject,
} from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PRODUCT_ROUTE } from '../src/framescaper/product-route.ts';
import { createFramescaperBaselineImageFixture } from
	'./helpers/framescaper-baseline-image-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('Framescaper baseline creates one exact family-qualified v1 authority', () => {
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		id: 'framescaper-baseline', title: 'Framescaper baseline', now: '2026-08-28T00:00:00.000Z',
	});
	assert.equal(project.schemaFamily, 'framescaper');
	assert.equal(project.schemaVersion, 1);
	assert.equal(validateFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, project), true);
	const cloned = cloneFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, project);
	assert.deepEqual(cloned, project);
	assert.notEqual(cloned, project);
	assert.throws(() => validateFramescaperProject(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
		Object.defineProperty({ ...project }, 'schemaFamily', {
			enumerable: true, get: () => 'framescaper',
		}),
	), /own enumerable data property/iu);
});

test('Framescaper desktop renderer admits the exact preload v1 tuple and catalog row', async () => {
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		id: 'framescaper-desktop-baseline', title: 'Framescaper desktop baseline',
		now: '2026-08-28T00:00:00.000Z',
	});
	const document = JSON.stringify(project);
	const sha256 = createHash('sha256').update(document).digest('hex');
	const handshake = Object.freeze({
		kind: 'framescaper-project-library-handshake' as const,
		version: 1 as const,
		owner: 'framescaper' as const,
		schemaFamily: 'framescaper' as const,
		schemaVersion: 1 as const,
		scapeFormatVersions: Object.freeze([1] as const),
		attachedScapeFormatVersion: 1 as const,
		storageDatabaseName: 'kw-media-framescaper-editor-v1' as const,
		desktopLibrarySchemaVersion: 1 as const,
		desktopDatabaseUserVersion: 1 as const,
		desktopLibraryScope: Object.freeze([
			'kw.media', 'framescaper-project-library', 'v1',
		] as const),
	});
	assert.deepEqual(FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_HANDSHAKE, handshake);
	const projectLibrary = Object.freeze({
		connect: async () => handshake,
		handshakeState: () => 'admitted',
		listProjects: async () => ({
			metadataRevision: 1,
			projects: [{
				id: project.id, title: project.title, revision: project.revision,
				updatedAt: '2026-08-28T00:00:00.000Z',
			}],
		}),
		readProjectBundle: async () => ({
			metadataRevision: 1,
			project: {
				id: 'opaque-entry-id', projectId: project.id, name: project.title,
				metadataFile: `opaque-entry-id/0-${sha256}.json`, preferredProduct: 'framescaper',
				updatedAtMs: 1, schemaFamily: 'framescaper', schemaVersion: 1,
				projectRevision: project.revision, byteLength: Buffer.byteLength(document), sha256,
			},
			document,
			bodies: [],
		}),
		readBodyChunk: async () => new Uint8Array(),
		beginPublication: async () => { throw new Error('unexpected publication'); },
		writePublicationChunk: async () => { throw new Error('unexpected publication body'); },
		finishPublication: async () => { throw new Error('unexpected publication finish'); },
		abortPublication: async () => false,
		deleteProject: async () => { throw new Error('unexpected deletion'); },
		duplicateProject: async () => { throw new Error('unexpected duplication'); },
	});
	const store = createFramescaperProjectStore(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		indexedDB: createInstrumentedIndexedDB(),
		preferOpfs: false,
		storageManager: persistentStorage(),
	});
	await store.ready();
	Object.defineProperty(globalThis, 'framescaperDesktop', {
		configurable: true,
		enumerable: true,
		value: Object.freeze({ v1: Object.freeze({ projectLibrary }) }),
	});
	try {
		const renderer = await connectFramescaperDesktopProjectLibraryRenderer(
			FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
			store,
		);
		assert.ok(renderer);
		assert.deepEqual(await renderer.listProjects(), [{
			id: project.id, title: project.title, revision: project.revision,
			updatedAt: '2026-08-28T00:00:00.000Z',
		}]);
		assert.deepEqual(await renderer.readProject(String(project.id)), project);
	} finally {
		Reflect.deleteProperty(globalThis, 'framescaperDesktop');
		await store.close();
	}
});

test('Framescaper v1 keeps an oversized whole-mix fallback attached to chunk playback', () => {
	const fallbackDigest = 'ab'.repeat(32);
	const originalSource = createAudioSource({
		id: 'original-source', storageKey: 'original-source', frameCount: 48_000,
		channelCount: 2, sampleRate: 48_000,
	});
	const fallbackSource = createAudioSource({
		id: 'fallback-source', storageKey: 'fallback-source',
		frameCount: 32 * 1024 * 1024 / (2 * Float32Array.BYTES_PER_ELEMENT) + 1,
		channelCount: 2, sampleRate: 48_000, contentSha256: fallbackDigest,
	});
	const originalClip = createAudioClip({
		id: 'original-clip', sourceId: originalSource.id, durationFrames: 48_000,
	});
	const originalTrack = createAudioTrack({
		id: 'original-track', clipIds: [originalClip.id], effectsActive: true,
		effects: [{ id: 'unsupported-effect', type: 'audacity-invert', enabled: true, params: {} }],
	});
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		id: 'framescaper-streamed-fallback', title: 'Framescaper streamed fallback',
		now: '2026-08-28T00:00:00.000Z', sampleRate: 48_000,
		sources: [originalSource, fallbackSource], clips: [originalClip], tracks: [originalTrack],
		featureRequirements: { schemaVersion: 2, requirements: [{
			id: 'publisher-audio-render',
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
			displayName: 'Audio effects',
			disposition: 'rendered-fallback',
			fallback: {
				role: 'project-audio-mix-v1', kind: 'audio',
				sourceId: fallbackSource.id, sha256: fallbackDigest,
			},
		}] },
	});
	const playback = createFramescaperPlaybackProjectService(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const admission = playback.projectForActivationAdmission!(project);
	const projection = playback.projectForPlayback(project);
	const projectedProject = projection.project as FramescaperProject;
	const projectedTracks = records(projectedProject.tracks);
	const projectedClips = records(projectedProject.clips);

	assert.deepEqual(admission.requiredAudioSourceIds, [fallbackSource.id]);
	assert.deepEqual(projection.requiredAudioSourceIds, admission.requiredAudioSourceIds);
	assert.equal(projection.audioRenderedFallback?.sourceId, fallbackSource.id);
	assert.equal(projectedProject.schemaFamily, 'framescaper');
	assert.equal(projectedProject.schemaVersion, 1);
	assert.equal(
		projectedTracks[0]?.id,
		PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track,
	);
	assert.equal(
		projectedClips[0]?.id,
		PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip,
	);
	assert.equal(projectedClips[0]?.sourceId, fallbackSource.id);

	const provider: EngineChunkSource = Object.freeze({
		channelCount: 2,
		frameCount: fallbackSource.frameCount,
		chunkFrames: 65_536,
		sampleRate: 48_000,
		readStorageChunk: () => Object.freeze([new Float32Array(1), new Float32Array(1)]),
	});
	const plans = buildClipSchedulePlans({
		project: projectedProject as unknown as EngineProject,
		sources: new Map(),
		chunkSources: new Map([[fallbackSource.id, provider]]),
		trackInputs: new Map([[PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track, {} as AudioNode]]),
		fromFrame: 0,
		toFrame: 1_024,
		sampleRate: 48_000,
	});
	assert.equal(plans.length, 1);
	assert.equal(plans[0]?.clip.id, PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip);
	assert.strictEqual(plans[0]?.chunkSource, provider);
	assert.equal(plans[0]?.originalBuffer, null);
});

test('Framescaper rejects pre-release numeric identity and classifies foreign/future before traversal', () => {
	assert.throws(
		() => loadFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
			schemaVersion: 31,
		}),
		ProjectReimportRequiredError,
	);
	let traversed = false;
	const foreign = {
		schemaFamily: 'soundscaper', schemaVersion: 1, id: 'foreign', title: 'Foreign', sampleRate: 48_000,
		get sources() { traversed = true; throw new Error('foreign domain traversed'); },
	};
	const held = loadFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, foreign);
	assert.equal(held.readOnly, true);
	assert.equal(held.reason, 'foreign-family');
	assert.equal(held.project, foreign);
	assert.equal(traversed, false);
	const future = loadFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		schemaFamily: 'framescaper', schemaVersion: 2,
	});
	assert.equal(future.readOnly, true);
	assert.equal(future.reason, 'newer-schema');
});

test('Framescaper baseline retains selected image commands, runtime projection, and history', () => {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const project = fixture.project as FramescaperProject;
	assert.equal(validateFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, project), true);
	const track = records(project.tracks).find(({ clipIds }) => (
		Array.isArray(clipIds) && clipIds.includes(fixture.clip.id)
	));
	assert.ok(track);
	const command = {
		type: 'image-clip/set' as const,
		clipId: fixture.clip.id,
		expectedClip: fixture.clip,
		expectedPlacement: { scope: 'timeline' as const, trackId: String(track.id) },
		clip: fixture.clip,
		placement: { scope: 'project-bin' as const },
	};
	const moved = applyFramescaperProjectCommand(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
		project,
		command,
		{ now: '2026-08-28T12:00:00.000Z' },
	);
	assert.deepEqual([moved.schemaFamily, moved.schemaVersion], ['framescaper', 1]);
	assert.equal(records(moved.tracks).some(({ clipIds }) => (
		Array.isArray(clipIds) && clipIds.includes(fixture.clip.id)
	)), false);
	assert.equal(records(record(moved.projectBin).clips).some(({ id }) => id === fixture.clip.id), true);
	const runtime = framescaperProjectForRuntimeConsumers(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, moved);
	assert.deepEqual([runtime.schemaFamily, runtime.schemaVersion], ['framescaper', 1]);
	assert.equal(records(runtime.sources).some(({ id, kind }) => (
		id === fixture.source.id && kind === 'image'
	)), true);
	const executed = executeFramescaperProjectCommand(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
		createFramescaperProjectHistory(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, project),
		command,
		{ now: '2026-08-28T12:00:00.000Z' },
	);
	const undone = undoFramescaperProjectCommand(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
		executed,
		{ now: '2026-08-28T12:01:00.000Z' },
	);
	assert.equal(records(undone.present.tracks).some(({ clipIds }) => (
		Array.isArray(clipIds) && clipIds.includes(fixture.clip.id)
	)), true);
});

test('Framescaper baseline runtime exposes no pre-release reimport or cross-product handoff route', async () => {
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	assert.equal(Object.hasOwn(runtime, 'reimportProject'), false);
	assert.deepEqual(runtime.createProject().schemaFamily, 'framescaper');
	assert.deepEqual(editorProjectStorageProfileNames(FRAMESCAPER_PROJECT_STORAGE_PROFILE), {
		databaseName: 'kw-media-framescaper-editor-v1',
		opfsDirectoryName: 'framescaper-editor-v1-sources',
		opfsWorkerName: 'framescaper-editor-v1-opfs-storage',
		projectLockPrefix: 'kw-media-framescaper-editor-v1-lock:',
	});
	assert.equal(FRAMESCAPER_PRODUCT_ROUTE.schemaFamily, 'framescaper');
	assert.equal(FRAMESCAPER_PRODUCT_ROUTE.schemaVersion, 1);
	assert.equal(FRAMESCAPER_PRODUCT_ROUTE.bootstrapModule, './ui/FramescaperAudioEditorBootstrap.tsx');
	const bootstrap = await readFile(new URL(
		'../src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx', import.meta.url,
	), 'utf8');
	assert.match(bootstrap, /crossProductHandoffAvailable=\{false\}/u);
	assert.doesNotMatch(bootstrap, /crossProductHandoffAvailable=\{runtime\.fileService\.isDesktop\}/u);
});

test('Framescaper selected entry modules have a closed versioned-boundary inventory', async () => {
	const allowed = new Set<string>(FRAMESCAPER_BASELINE_VERSIONED_BOUNDARIES.map(({ module }) => module));
	assert.equal(FRAMESCAPER_BASELINE_VERSIONED_BOUNDARIES.every(({ reason }) => reason.length >= 16), true);
	for (const file of FRAMESCAPER_BASELINE_ENTRY_MODULES) {
		const source = await readFile(new URL(`../src/framescaper/${file}`, import.meta.url), 'utf8');
		for (const match of source.matchAll(/(?:from\s+|import\()['"](\.\/[^'"]*-v\d+[^'"]*)['"]/gu)) {
			assert.equal(allowed.has(match[1]!), true, `${file} imports unregistered ${match[1]}`);
		}
	}
});

function record(value: unknown): Readonly<Record<string, unknown>> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	return value as Readonly<Record<string, unknown>>;
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	assert.ok(Array.isArray(value));
	return value.map(record);
}

function persistentStorage(): StorageManager {
	return {
		estimate: async () => ({ usage: 0, quota: 1024 * 1024 * 1024 }),
		persisted: async () => true,
		persist: async () => true,
	} as unknown as StorageManager;
}
