/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createProjectFeatureCompatibilityService } from '../src/common/editor/controller/project-feature-compatibility-service.ts';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import {
	AudioEditorProjectReimportRequiredError,
	migrateAudioEditorProject,
} from '../src/common/editor/migration.js';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	AUDIO_EDITOR_PROJECT_SCHEMA_VERSION,
	cloneCurrentAudioEditorProject,
	createCurrentAudioEditorProject,
	loadCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import { createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import {
	PROJECT_FEATURE_AUDIO_CAPABILITY_IDS,
	PROJECT_FEATURE_CAPABILITY_IDS,
	PROJECT_FEATURE_VIDEO_CAPABILITY_IDS,
} from '../src/common/editor/project-feature-capabilities.ts';
import { PROJECT_OWNED_FEATURE_REQUIREMENT_IDS } from '../src/common/editor/project-owned-feature-requirements.ts';
import { normalizeProjectFeatureRequirements } from '../src/common/editor/project-feature-requirements.ts';
import {
	createAudioEditorProjectV11,
	validateAudioEditorProjectV11,
} from '../src/common/editor/project-v11.ts';
import {
	AUDIO_EDITOR_PROJECT_V13_SCHEMA_VERSION,
	createAudioEditorProjectV13,
	validateAudioEditorProjectV13,
	type AudioEditorProjectV13,
} from '../src/common/editor/project-v13.ts';
import { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { exportScapeProject, importScapeProject } from '../src/common/editor/scape-project.js';
import { PRODUCT_PROFILES } from '../src/common/products.js';

const NOW = '2026-08-09T18:00:00.000Z';

function folderProject(): AudioEditorProjectV13 {
	return createAudioEditorProjectV13({
		id: 'folder-project',
		title: 'Folder project',
		now: NOW,
		tracks: [
			createAudioTrackV10({ id: 'track-a', name: 'Track A' }),
			createAudioTrackV10({ id: 'track-b', name: 'Track B' }),
		],
		trackFolders: [{
			id: 'folder-a',
			name: 'Folder A',
			collapsed: true,
			height: 72,
			hidden: false,
			mute: true,
			solo: false,
		}, {
			id: 'folder-b',
			name: 'Folder B',
			collapsed: false,
			height: 40,
			hidden: true,
			mute: false,
			solo: true,
		}],
		sequences: [{
			id: 'main-sequence',
			trackNodes: [
				{ kind: 'folder', id: 'folder-a', parentFolderId: null },
				{ kind: 'track', id: 'track-a', parentFolderId: 'folder-a' },
				{ kind: 'folder', id: 'folder-b', parentFolderId: 'folder-a' },
				{ kind: 'track', id: 'track-b', parentFolderId: 'folder-b' },
			],
		}],
		timelineAnnotations: [{
			id: 'marker-a', sequenceId: 'main-sequence', name: 'Marker', color: 'violet',
			batchId: null, opaqueExtensions: {}, kind: 'marker', anchor: 'sample', positionFrame: 12,
		}],
		selection: { annotationIds: ['marker-a'] },
	});
}

test('V13 is exact current and retains V11 annotations with authoritative folder hierarchy', () => {
	const project = folderProject();

	assert.equal(AUDIO_EDITOR_PROJECT_SCHEMA_VERSION, 13);
	assert.equal(AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION, 13);
	assert.equal(AUDIO_EDITOR_PROJECT_V13_SCHEMA_VERSION, 13);
	assert.equal(project.schemaVersion, 13);
	assert.deepEqual(project.trackFolders.map(({ id }) => id), ['folder-a', 'folder-b']);
	assert.deepEqual(project.sequences[0]?.trackIds, ['track-a', 'track-b']);
	assert.deepEqual(project.sequences[0]?.trackNodes, [
		{ kind: 'folder', id: 'folder-a', parentFolderId: null },
		{ kind: 'track', id: 'track-a', parentFolderId: 'folder-a' },
		{ kind: 'folder', id: 'folder-b', parentFolderId: 'folder-a' },
		{ kind: 'track', id: 'track-b', parentFolderId: 'folder-b' },
	]);
	assert.deepEqual(project.tracks.map(({ id }) => id), ['track-a', 'track-b']);
	assert.deepEqual(project.selection.annotationIds, ['marker-a']);
	assert.equal(validateAudioEditorProjectV13(project), true);
	assert.equal(validateCurrentAudioEditorProject(project), true);
});

test('V13 derives root track nodes by default while V11 rejects every folder persistence field', () => {
	const current = createCurrentAudioEditorProject({
		now: NOW,
		tracks: [createAudioTrackV10({ id: 'track-a' })],
	});
	assert.deepEqual(current.trackFolders, []);
	assert.deepEqual(current.sequences[0]?.trackNodes, [
		{ kind: 'track', id: 'track-a', parentFolderId: null },
	]);

	const v11 = createAudioEditorProjectV11({
		now: NOW,
		tracks: [createAudioTrackV10({ id: 'track-a' })],
	});
	assert.throws(
		() => validateAudioEditorProjectV11({ ...v11, trackFolders: [] }),
		/trackFolders.*V12|V12.*trackFolders/iu,
	);
	assert.throws(
		() => validateAudioEditorProjectV11({ ...v11, trackFolderStateProjectionVersion: 1 }),
		/persisted project.*runtime projection marker/iu,
	);
	assert.throws(
		() => validateAudioEditorProjectV11({
			...v11,
			sequences: v11.sequences.map((sequence) => ({ ...sequence, trackNodes: [] })),
		}),
		/trackNodes.*V12|V12.*trackNodes/iu,
	);

	let getterCalls = 0;
	const hostileSequence = { id: 'hostile-sequence' } as Record<string, unknown>;
	Object.defineProperty(hostileSequence, 'trackNodes', {
		enumerable: true,
		get() {
			getterCalls += 1;
			return [];
		},
	});
	assert.throws(
		() => createAudioEditorProjectV13({ sequences: [hostileSequence] }),
		/trackNodes.*own enumerable data property/iu,
	);
	assert.equal(getterCalls, 0);
});

test('V13 rejects hierarchy projection drift and project metadata order drift', () => {
	const project = folderProject();
	const sequence = project.sequences[0]!;
	assert.throws(
		() => validateAudioEditorProjectV13({ ...project, trackFolderStateProjectionVersion: 1 }),
		/persisted project.*runtime projection marker/iu,
	);
	assert.throws(
		() => validateAudioEditorProjectV13({
			...project,
			sequences: [{ ...sequence, trackIds: ['track-b', 'track-a'] }],
		}),
		/trackIds.*derived leaf order/iu,
	);
	assert.throws(
		() => validateAudioEditorProjectV13({
			...project,
			tracks: [...project.tracks].reverse(),
		}),
		/project\.tracks.*exact hierarchy preorder/iu,
	);
	assert.throws(
		() => validateAudioEditorProjectV13({
			...project,
			trackFolders: [...project.trackFolders].reverse(),
		}),
		/project\.trackFolders.*exact hierarchy preorder/iu,
	);
});

test('current V13 is byte-idempotent across clone, JSON, and local store save/open', async () => {
	const project = folderProject();
	const serialized = JSON.stringify(project);
	const loaded = loadCurrentAudioEditorProject(JSON.parse(serialized));
	const cloned = cloneCurrentAudioEditorProject(project);

	assert.deepEqual(loaded, { project, readOnly: false, reason: null });
	assert.notStrictEqual(loaded.project, project);
	assert.deepEqual(cloned, project);
	assert.notStrictEqual(cloned.trackFolders, project.trackFolders);
	assert.notStrictEqual(cloned.sequences[0]?.trackNodes, project.sequences[0]?.trackNodes);
	assert.equal(JSON.stringify(loaded.project), serialized);

	const store = new AudioEditorProjectStore({ indexedDB: null, databaseName: 'v12-folder-roundtrip' });
	await store.saveProject(project);
	const reopened = await store.loadProject(project.id);
	assert.deepEqual(reopened, project);
	assert.equal(JSON.stringify(reopened), serialized);
	await store.close();
});

test('current .scape archive round trip preserves nonempty folder state byte-exactly', async () => {
	const project = folderProject();
	const sourceStore = new AudioEditorProjectStore({
		indexedDB: null,
		databaseName: 'v12-folder-scape-source',
	});
	const targetStore = new AudioEditorProjectStore({
		indexedDB: null,
		databaseName: 'v12-folder-scape-target',
	});
	const exported = await exportScapeProject(project, sourceStore);
	assert.equal(exported.manifest.project.schemaVersion, 13);
	const imported = await importScapeProject(exported.blob, targetStore);
	assert.equal(imported.readOnly, false);
	assert.equal(JSON.stringify(imported.project), JSON.stringify(project));
	assert.deepEqual(imported.project.trackFolders, project.trackFolders);
	assert.deepEqual(imported.project.sequences[0]?.trackNodes, project.sequences[0]?.trackNodes);
	assert.equal(JSON.stringify(await targetStore.loadProject(project.id)), JSON.stringify(project));
	const copied = await importScapeProject(exported.blob, targetStore, { collision: 'copy' });
	assert.notEqual(copied.project.id, project.id);
	assert.deepEqual(copied.project.trackFolders, project.trackFolders);
	assert.deepEqual(copied.project.sequences[0]?.trackNodes, project.sequences[0]?.trackNodes);
	assert.deepEqual(copied.project.sequences[0]?.trackIds, project.sequences[0]?.trackIds);
	assert.deepEqual(
		copied.project.tracks.map((track: Readonly<{ id: string }>) => track.id),
		project.tracks.map(({ id }) => id),
	);
	await sourceStore.close();
	await targetStore.close();
});

test('ordinary edits, undo, and redo preserve exact V13 folder state', () => {
	const project = folderProject();
	const command = {
		type: 'metadata/update',
		changes: { artist: 'Soundscaper' },
	} as const;
	const edited = applyEditorCommand(project, command, { now: '2026-08-09T18:01:00.000Z' });
	assert.deepEqual(edited.trackFolders, project.trackFolders);
	assert.deepEqual(edited.sequences[0]?.trackNodes, project.sequences[0]?.trackNodes);
	assert.equal(validateAudioEditorProjectV13(edited), true);

	const executed = executeEditorCommand(createEditorHistory(project), command, {
		now: '2026-08-09T18:01:00.000Z',
	});
	const undone = undoEditorCommand(executed);
	const redone = redoEditorCommand(undone);
	assert.deepEqual(undone.present.trackFolders, project.trackFolders);
	assert.deepEqual(undone.present.sequences[0]?.trackNodes, project.sequences[0]?.trackNodes);
	assert.equal(undone.present.metadata.artist, project.metadata.artist);
	assert.deepEqual(redone.present.trackFolders, edited.trackFolders);
	assert.deepEqual(redone.present.sequences[0]?.trackNodes, edited.sequences[0]?.trackNodes);
	assert.equal(redone.present.metadata.artist, edited.metadata.artist);
	assert.equal(validateAudioEditorProjectV13(undone.present), true);
	assert.equal(validateAudioEditorProjectV13(redone.present), true);
});

test('legacy track add, reorder, and remove keep empty-folder V13 root hierarchy exact', () => {
	let project = createCurrentAudioEditorProject({
		now: NOW,
		tracks: [
			createAudioTrackV10({ id: 'track-a' }),
			createAudioTrackV10({ id: 'track-b' }),
		],
	});
	project = applyEditorCommand(project, {
		type: 'track/add',
		track: { id: 'track-c', name: 'Track C' },
		index: 1,
	}, { now: NOW });
	assert.deepEqual(project.sequences[0]?.trackIds, ['track-a', 'track-c', 'track-b']);
	assert.deepEqual(project.sequences[0]?.trackNodes, [
		{ kind: 'track', id: 'track-a', parentFolderId: null },
		{ kind: 'track', id: 'track-c', parentFolderId: null },
		{ kind: 'track', id: 'track-b', parentFolderId: null },
	]);

	project = applyEditorCommand(project, {
		type: 'track/reorder', trackId: 'track-b', index: 0,
	}, { now: NOW });
	assert.deepEqual(project.sequences[0]?.trackIds, ['track-b', 'track-a', 'track-c']);
	assert.deepEqual(project.sequences[0]?.trackNodes.map(({ id }) => id), ['track-b', 'track-a', 'track-c']);

	project = applyEditorCommand(project, {
		type: 'track/remove', trackId: 'track-a',
	}, { now: NOW });
	assert.deepEqual(project.sequences[0]?.trackIds, ['track-b', 'track-c']);
	assert.deepEqual(project.sequences[0]?.trackNodes.map(({ id }) => id), ['track-b', 'track-c']);
	assert.equal(validateAudioEditorProjectV13(project), true);
});

test('legacy root track edits preserve multi-sequence blocks and reject cross-sequence reorder', () => {
	let project = createCurrentAudioEditorProject({
		now: NOW,
		tracks: [
			createAudioTrackV10({ id: 'track-a' }),
			createAudioTrackV10({ id: 'track-b' }),
		],
		sequences: [{
			id: 'main-sequence',
			trackNodes: [{ kind: 'track', id: 'track-a', parentFolderId: null }],
		}, {
			id: 'secondary-sequence',
			trackNodes: [{ kind: 'track', id: 'track-b', parentFolderId: null }],
		}],
	});
	project = applyEditorCommand(project, {
		type: 'track/add',
		track: { id: 'track-c', name: 'Track C' },
	}, { now: NOW });
	assert.deepEqual(project.tracks.map(({ id }) => id), ['track-a', 'track-c', 'track-b']);
	assert.deepEqual(project.sequences.map(({ trackIds }) => trackIds), [
		['track-a', 'track-c'],
		['track-b'],
	]);

	project = applyEditorCommand(project, {
		type: 'track/reorder', trackId: 'track-c', index: 0,
	}, { now: NOW });
	assert.deepEqual(project.tracks.map(({ id }) => id), ['track-c', 'track-a', 'track-b']);
	assert.deepEqual(project.sequences[0]?.trackNodes.map(({ id }) => id), ['track-c', 'track-a']);

	project = applyEditorCommand(project, {
		type: 'track/remove', trackId: 'track-c',
	}, { now: NOW });
	assert.deepEqual(project.tracks.map(({ id }) => id), ['track-a', 'track-b']);
	assert.deepEqual(project.sequences.map(({ trackIds }) => trackIds), [['track-a'], ['track-b']]);

	const snapshot = structuredClone(project);
	assert.throws(() => applyEditorCommand(project, {
		type: 'track/reorder', trackId: 'track-a', index: 1,
	}, { now: NOW }), /cross.*sequence|sequence boundar/iu);
	assert.deepEqual(project, snapshot);
});

test('legacy structural track commands reject nonempty V13 hierarchy without mutating it', () => {
	const project = folderProject();
	const snapshot = structuredClone(project);
	assert.throws(() => applyEditorCommand(project, {
		type: 'track/add', track: { id: 'track-c', name: 'Track C' },
	}, { now: NOW }), /track folder hierarchy.*folder-aware|folder-aware.*track/iu);
	assert.deepEqual(project, snapshot);
	assert.throws(() => applyEditorCommand(project, {
		type: 'batch',
		commands: [
			{ type: 'track/remove', trackId: 'track-a' },
			{
				type: 'track/add',
				index: 0,
				track: { ...project.tracks[0], name: 'Replacement track' },
			},
		],
	}, { now: NOW }), /track folder hierarchy.*folder-aware|folder-aware.*track/iu);
	assert.deepEqual(project, snapshot);
});

test('schemas 1 through 12 require typed re-import and future V14 stays opaque read-only', () => {
	for (let schemaVersion = 1; schemaVersion <= 12; schemaVersion += 1) {
		assert.throws(
			() => migrateAudioEditorProject({ schemaVersion }),
			(error: unknown) => error instanceof AudioEditorProjectReimportRequiredError
				&& error.schemaVersion === schemaVersion
				&& error.currentSchemaVersion === 13,
		);
	}
	const project = folderProject();
	const future = { ...project, schemaVersion: 14, futureFolderState: { opaque: true } };
	const loaded = migrateAudioEditorProject(future);
	assert.deepEqual(loaded, {
		project: future,
		migrated: false,
		fromVersion: 14,
		readOnly: true,
		reason: 'newer-schema',
	});
	assert.notStrictEqual(loaded.project, future);
});

test('nonempty folder state owns one bypass-only requirement in both product profiles', () => {
	const project = folderProject();
	assert.deepEqual(project.featureRequirements.requirements.filter(({ id }) => (
		id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.trackFolders
	)), [{
		id: 'soundscaper.track-folders',
		featureId: 'org.soundscaper.capability.track-folders',
		displayName: 'Nested track folders',
		disposition: 'bypass',
		fallback: null,
	}]);
	assert.equal(PROJECT_FEATURE_CAPABILITY_IDS.trackFolders, 'org.soundscaper.capability.track-folders');
	assert.equal(new Set<string>(PROJECT_FEATURE_AUDIO_CAPABILITY_IDS).has(PROJECT_FEATURE_CAPABILITY_IDS.trackFolders), false);
	assert.equal(new Set<string>(PROJECT_FEATURE_VIDEO_CAPABILITY_IDS).has(PROJECT_FEATURE_CAPABILITY_IDS.trackFolders), false);

	for (const productId of ['soundscaper', 'framescaper'] as const) {
		assert.equal(PRODUCT_PROFILES[productId].capabilities.trackFolders, false);
		const report = createProjectFeatureCompatibilityService(
			PRODUCT_PROFILES[productId].capabilities,
		).evaluate(project);
		const item = report?.items.find(({ featureId }) => featureId === PROJECT_FEATURE_CAPABILITY_IDS.trackFolders);
		assert.deepEqual(item && {
			availability: item.availability,
			declaredDisposition: item.declaredDisposition,
			disposition: item.disposition,
			fallback: item.fallback,
		}, {
			availability: 'unavailable',
			declaredDisposition: 'bypass',
			disposition: 'bypassed',
			fallback: null,
		});
	}
});

test('registered track-folder requirements reject audio and video rendered fallbacks', () => {
	for (const [kind, role] of [
		['audio', 'project-audio-mix-v1'],
		['video', 'project-video-render-v1'],
	] as const) {
		assert.throws(() => normalizeProjectFeatureRequirements({
			schemaVersion: 2,
			requirements: [{
				id: `publisher-${kind}-folder-render`,
				featureId: PROJECT_FEATURE_CAPABILITY_IDS.trackFolders,
				displayName: 'Nested track folders',
				disposition: 'rendered-fallback',
				fallback: {
					role,
					kind,
					sourceId: `fallback-${kind}`,
					sha256: 'ab'.repeat(32),
				},
			}],
		}, {
			sources: [{ id: `fallback-${kind}`, kind }],
			clips: [],
			tracks: [],
		}), /not eligible for an? (?:audio|video) rendered fallback/iu);
	}
});
