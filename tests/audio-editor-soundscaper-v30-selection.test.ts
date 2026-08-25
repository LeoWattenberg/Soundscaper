/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { editorProjectRuntimeProfileDefinition } from '../src/common/editor/project-runtime-profile.ts';
import { editorProjectRuntimeProfilePrerequisiteDefinition } from '../src/common/editor/project-runtime-profile-prerequisite.ts';
import { editorProjectFeatureCapabilityProfileDefinition } from '../src/common/editor/project-feature-capability-profile.ts';
import { editorProjectStorageProfileNames } from '../src/common/editor/storage/project-storage-profile.ts';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import {
	ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1,
} from '../src/common/editor/assistance/assistance-asset-reference-v1.ts';
import { SOUNDSCAPER_PROFILE } from '../src/soundscaper/product.js';
import {
	assertSoundscaperProductionProfile,
	soundscaperProductionProjectClone,
} from '../src/soundscaper/editor-project-production-profile.ts';
import {
	applySoundscaperProjectCommandV30,
} from '../src/soundscaper/editor-project-v30-commands.ts';
import {
	createSoundscaperProjectHistoryV30,
	executeSoundscaperProjectCommandV30,
	redoSoundscaperProjectCommandV30,
	undoSoundscaperProjectCommandV30,
} from '../src/soundscaper/editor-project-v30-history.ts';
import {
	createSoundscaperProjectRuntimeV30Selection,
} from '../src/soundscaper/editor-project-runtime-v30-selection.ts';
import { SoundscaperProjectRepositoryV30 } from '../src/soundscaper/editor-project-repository-v30.ts';
import {
	createSoundscaperProjectV30,
	validateSoundscaperProjectV30,
} from '../src/soundscaper/editor-project-v30.ts';
import {
	createSoundscaperPlaybackProjectServiceV30,
} from '../src/soundscaper/editor-project-playback-v30.ts';
import {
	embedSoundscaperNativePluginStatesInAup4V30,
	recoverSoundscaperNativePluginStatesFromAup4V30,
} from '../src/soundscaper/editor-native-plugin-state-aup4-v30.ts';
import {
	createSoundscaperNativePluginStateScapeExtensionV30,
} from '../src/soundscaper/editor-native-plugin-state-scape-v30.ts';
import {
	rebindSoundscaperProjectFreezeSourceIdentitiesV30,
} from '../src/soundscaper/editor-project-feature-requirements-v30.ts';
import {
	createSoundscaperTrackDuplicateClipboardV8,
} from '../src/soundscaper/editor-session-clipboard-v8.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const NOW = '2026-08-25T12:00:00.000Z';
const SOURCE_SHA256 = 'ab'.repeat(32);
const BODY_SHA256 = 'cd'.repeat(32);

function source() {
	return createAudioSource({
		id: 'voice-source', name: 'Voice', storageKey: 'owned:voice-source',
		contentSha256: SOURCE_SHA256, frameCount: 96_000, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
}

function assistanceAsset() {
	return {
		id: 'transcript-01', kind: 'transcript-v1', sourceId: 'voice-source',
		sourceSha256: SOURCE_SHA256, sourceStartFrame: 0, sourceEndFrame: 48_000,
		sourceVideoTimingSha256: null, recipeId: 'speech-transcript', recipeVersion: 1,
		modelArtifactSha256s: ['12'.repeat(32)],
		body: {
			storageKey: `assistance-transcript-sha256:${BODY_SHA256}`,
			mimeType: ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1,
			byteLength: 256, sha256: BODY_SHA256,
		},
	};
}

function project() {
	return createSoundscaperProjectV30({
		id: 'selected-v30', title: 'Selected V30', now: NOW,
		sources: [source()],
		tracks: [{ type: 'audio', id: 'voice-track', name: 'Voice' }],
		assistanceAssets: [assistanceAsset()],
	} as never);
}

test('selected V30 profiles isolate storage while retaining the V29 desktop library', () => {
	const selected = createSoundscaperProjectRuntimeV30Selection();
	const runtime = editorProjectRuntimeProfileDefinition(selected.runtimeProfile);
	const prerequisite = editorProjectRuntimeProfilePrerequisiteDefinition(runtime.prerequisite);
	assert.equal(prerequisite.projectSchemaVersion, 30);
	assert.equal(prerequisite.desktopProjectSchemaVersion, 30);
	assert.equal(prerequisite.desktopLibrarySchemaVersion, 11);
	assert.equal(prerequisite.desktopDatabaseUserVersion, 13);
	assert.deepEqual(prerequisite.desktopLibraryScope,
		['kw.media', 'soundscaper-project-library', 'v11']);
	for (const value of Object.values(editorProjectStorageProfileNames(selected.storageProfile))) {
		assert.match(value, /v30/u);
	}
	assert.equal(editorProjectFeatureCapabilityProfileDefinition(runtime.capabilityProfile).registrations.find(
		({ key }) => key === 'assistanceAssets',
	)?.available, true);
	assert.doesNotThrow(() => assertSoundscaperProductionProfile(selected.runtimeProfile));
	assert.equal(SOUNDSCAPER_PROFILE.capabilities.assistanceAssets, true);
});

test('V30 commands and history preserve exact assistance custody through inherited edits', () => {
	const initial = project();
	const renamed = applySoundscaperProjectCommandV30(initial, {
		type: 'project/rename', title: 'Renamed V30',
	}, { now: NOW });
	assert.equal(renamed.title, 'Renamed V30');
	assert.deepEqual(renamed.assistanceAssets, initial.assistanceAssets);
	assert.notEqual(renamed.assistanceAssets, initial.assistanceAssets);
	const history = executeSoundscaperProjectCommandV30(
		createSoundscaperProjectHistoryV30(initial),
		{ type: 'project/rename', title: 'History V30' },
		{ now: NOW },
	);
	assert.deepEqual(history.present.assistanceAssets, initial.assistanceAssets);
	const undone = undoSoundscaperProjectCommandV30(history);
	assert.equal(undone.present.title, initial.title);
	assert.deepEqual(undone.present.assistanceAssets, initial.assistanceAssets);
	const redone = redoSoundscaperProjectCommandV30(undone);
	assert.deepEqual(redone.present.assistanceAssets, initial.assistanceAssets);
	assert.equal(validateSoundscaperProjectV30(redone.present), true);
});

test('selected V30 repository and session round-trip assistance references exactly', async (context) => {
	const selected = createSoundscaperProjectRuntimeV30Selection();
	const store = selected.createProjectStore({
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		preferOpfs: false,
	});
	context.after(() => store.close());
	await store.ready();
	const held = project();
	const delegate = repositoryDelegate();
	const repository = new SoundscaperProjectRepositoryV30(delegate);
	const loaded = await repository.save(held);
	assert.deepEqual(loaded, held);
	assert.notEqual(loaded, held);
	const migrated = selected.migrateProject(held);
	assert.equal(migrated.migrated, false);
	assert.deepEqual(migrated.project, held);
	assert.deepEqual(soundscaperProductionProjectClone(selected.runtimeProfile, held), held);
});

function repositoryDelegate() {
	let saved: unknown = null;
	return {
		createIfAbsent: async (value: unknown) => value,
		createForScapeImportIfAbsent: async (value: unknown) => value,
		save: async (value: unknown) => { saved = structuredClone(value); return saved; },
		saveIfCurrent: async (_expected: unknown, value: unknown) => value,
		load: async () => saved,
		list: async () => saved ? [saved] : [],
		listRevisions: async () => [],
		delete: async () => {},
	};
}

test('playback and clipboard projections admit V30 without dropping assistance references', () => {
	const held = project();
	const playback = createSoundscaperPlaybackProjectServiceV30().projectForPlayback(held);
	assert.deepEqual((playback.project as typeof held).assistanceAssets, held.assistanceAssets);
	const carrier = createSoundscaperTrackDuplicateClipboardV8(held, 'voice-track');
	assert.equal(carrier.originProjectId, held.id);
	assert.equal(carrier.originRevision, held.revision);
});

test('native, AUP4 and Scape seams preserve V30 assistance custody', async () => {
	const bytes = Uint8Array.from([0, 7, 13, 255]);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const nativeState = {
		instanceId: 'native-instance-01', format: 'clap', stablePluginId: 'org.example.delay',
		binarySha256: '34'.repeat(32),
		stateBody: {
			kind: 'native-plugin-state', bodyId: `native-plugin-state:${sha256}`,
			byteLength: bytes.byteLength, sha256,
		},
		enabled: true, bypassed: false, continuity: 'live', latencySamples: 32,
	};
	const held = createSoundscaperProjectV30({
		id: 'portable-v30', title: 'Portable V30', now: NOW,
		sources: [source()], assistanceAssets: [assistanceAsset()],
		nativePluginStates: [nativeState],
	} as never);
	const embedded = await embedSoundscaperNativePluginStatesInAup4V30(held, {
		loadNativePluginStateBody: () => bytes,
	});
	assert.deepEqual(embedded.assistanceAssets, held.assistanceAssets);
	const recovered = await recoverSoundscaperNativePluginStatesFromAup4V30(embedded, {
		persistNativePluginStateBody: (_value, expected) => expected,
	});
	assert.deepEqual(recovered.nativePluginStates, held.nativePluginStates);
	assert.deepEqual(recovered.assistanceAssets, held.assistanceAssets);
	const extension = createSoundscaperNativePluginStateScapeExtensionV30();
	const planned = await extension.planExportAssets!({
		project: held,
		store: { getNativePluginStateBodyMetadata: () => ({
			byteLength: bytes.byteLength, sha256,
		}) },
		signal: new AbortController().signal,
	} as never);
	assert.deepEqual(planned.map(({ kind }) => kind), ['native-plugin-state']);
	const rebound = structuredClone(held) as unknown as Record<string, unknown>;
	rebound.sources = (rebound.sources as Array<Record<string, unknown>>).map((entry) => ({
		...entry, id: entry.id === 'voice-source' ? 'voice-source-remapped' : entry.id,
	}));
	rebindSoundscaperProjectFreezeSourceIdentitiesV30(
		rebound,
		new Map([['voice-source', 'voice-source-remapped']]),
	);
	assert.equal((rebound.assistanceAssets as Array<{ sourceId: string }>)[0]?.sourceId,
		'voice-source-remapped');
	assert.equal(validateSoundscaperProjectV30(rebound), true);
});

test('the shared site route selects the V30 bootstrap while retaining the V29 source tree', async () => {
	const [app, production] = await Promise.all([
		readFile(new URL('../src/common/site/App.jsx', import.meta.url), 'utf8'),
		readFile(new URL('../src/soundscaper/editor-project-production-profile.ts', import.meta.url), 'utf8'),
	]);
	assert.match(app, /SoundscaperAudioEditorBootstrapV30\.tsx/u);
	assert.match(app, /\?\s*SoundscaperAudioEditorBootstrapV30\s*:/su);
	assert.match(production, /SOUNDSCAPER_V30_PROJECT_RUNTIME_PROFILE/u);
	assert.match(production, /cloneSoundscaperProjectV30/u);
});
