/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import {
	cloneCurrentAudioEditorProject,
	createCurrentAudioEditorProject,
	loadCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { PROJECT_OWNED_FEATURE_REQUIREMENT_IDS } from '../src/common/editor/project-owned-feature-requirements.ts';
import { normalizeProjectFeatureRequirements } from '../src/common/editor/project-feature-requirements.ts';
import { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { validateVideoSourceCharacteristicsV14 } from '../src/common/editor/source-characteristics-v14.ts';
import { createUnreportedVideoSourceCharacteristics } from '../src/common/editor/video-source-characteristics.ts';

const NOW = '2026-08-09T18:00:00.000Z';

function reportedCharacteristics(): Record<string, unknown> {
	return {
		backend: 'ffprobe',
		codedWidth: 1920,
		codedHeight: 1080,
		rotationDegrees: 0,
		pixelAspectRatio: { num: 1, den: 1 },
		fieldOrder: 'progressive',
		hasAlpha: false,
		videoCodec: 'h264',
		colour: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'limited' },
		audioStreams: null,
		extractedAudioStreamIndex: null,
		startTimecode: null,
	};
}

function folderProject(): AudioEditorProjectCurrent {
	return createCurrentAudioEditorProject({
		id: 'folder-project',
		title: 'Folder and source characteristics project',
		now: NOW,
		sources: [{
			kind: 'video', id: 'video-source', name: 'Video', storageKey: 'video-source',
			mimeType: 'video/mp4', frameCount: 40_000, sampleFrameCount: 40_000,
			sourceFrameCount: 20, frameRate: { num: 24, den: 1 }, width: 1920, height: 1080,
			videoCodec: 'h264', characteristics: reportedCharacteristics(),
		}],
		projectBin: { clips: [{
			kind: 'video', id: 'bin-video', binItemId: 'bin-video', sourceId: 'video-source',
			title: 'Video', sequenceId: 'main-sequence', sequenceStartFrame: 0,
			sequenceFrameCount: 4, sourceInFrame: 0, sourceFrameCount: 4,
		}] },
		tracks: [
			createAudioTrack({ id: 'track-a', name: 'Track A' }),
			createAudioTrack({ id: 'track-b', name: 'Track B' }),
		],
		trackFolders: [{
			id: 'folder-a', name: 'Folder A', collapsed: true, height: 72,
			hidden: false, mute: true, solo: false,
		}, {
			id: 'folder-b', name: 'Folder B', collapsed: false, height: 40,
			hidden: true, mute: false, solo: true,
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

test('current construction accumulates annotations, hierarchy, and reported source characteristics', () => {
	const project = folderProject();
	const source = project.sources[0] as Readonly<Record<string, unknown>>;

	assert.equal(project.schemaVersion, 17);
	assert.deepEqual(project.trackFolders.map(({ id }) => id), ['folder-a', 'folder-b']);
	assert.deepEqual(project.sequences[0]?.trackIds, ['track-a', 'track-b']);
	assert.deepEqual(project.sequences[0]?.trackNodes, [
		{ kind: 'folder', id: 'folder-a', parentFolderId: null },
		{ kind: 'track', id: 'track-a', parentFolderId: 'folder-a' },
		{ kind: 'folder', id: 'folder-b', parentFolderId: 'folder-a' },
		{ kind: 'track', id: 'track-b', parentFolderId: 'folder-b' },
	]);
	assert.deepEqual(project.selection.annotationIds, ['marker-a']);
	assert.deepEqual(source.characteristics, reportedCharacteristics());
	assert.equal(validateCurrentAudioEditorProject(project), true);

	for (const id of [
		PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.trackFolders,
		PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.sourceCharacteristics,
	]) {
		const requirement = project.featureRequirements.requirements.find((candidate) => candidate.id === id);
		assert.equal(requirement?.disposition, 'bypass');
		assert.equal(requirement?.fallback, null);
	}
});

test('unreported video characteristics are explicit and do not claim ownership', () => {
	const project = createCurrentAudioEditorProject({
		now: NOW,
		sources: [{
			kind: 'video', id: 'video-source', name: 'Video', storageKey: 'video-source',
			mimeType: 'video/mp4', frameCount: 40_000, sampleFrameCount: 40_000,
			sourceFrameCount: 20, frameRate: { num: 24, den: 1 }, width: 1920, height: 1080,
		}],
	});
	const source = project.sources[0] as Readonly<Record<string, unknown>>;

	assert.deepEqual(source.characteristics, createUnreportedVideoSourceCharacteristics());
	assert.equal(project.featureRequirements.requirements.some(
		({ id }) => id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.sourceCharacteristics,
	), false);
	assert.equal(validateCurrentAudioEditorProject(project), true);
});

test('current validation rejects source-characteristic drift instead of repairing it', () => {
	const project = folderProject();
	const missing = structuredClone(project) as unknown as Record<string, unknown>;
	delete ((missing.sources as Record<string, unknown>[])[0]!).characteristics;
	assert.throws(() => validateVideoSourceCharacteristicsV14(missing), /characteristics.*required/iu);
	assert.throws(() => validateCurrentAudioEditorProject(missing), /owned feature|characteristics/iu);

	const codecDrift = structuredClone(project) as unknown as Record<string, unknown>;
	(codecDrift.sources as Record<string, unknown>[])[0]!.videoCodec = 'hevc';
	assert.throws(() => validateCurrentAudioEditorProject(codecDrift), /videoCodec.*disagrees/iu);

	const nonCanonical = structuredClone(project) as unknown as Record<string, unknown>;
	const characteristics = (nonCanonical.sources as Record<string, unknown>[])[0]!
		.characteristics as Record<string, unknown>;
	characteristics.pixelAspectRatio = { num: 2, den: 2 };
	assert.throws(() => validateCurrentAudioEditorProject(nonCanonical), /canonical reported form/iu);
});

test('hierarchy projection and metadata order remain exact current authority', () => {
	const project = folderProject();
	const sequence = project.sequences[0]!;
	assert.throws(
		() => validateCurrentAudioEditorProject({ ...project, trackFolderStateProjectionVersion: 1 }),
		/persisted project.*runtime projection marker/iu,
	);
	assert.throws(
		() => validateCurrentAudioEditorProject({
			...project,
			sequences: [{ ...sequence, trackIds: ['track-b', 'track-a'] }],
		}),
		/trackIds.*derived leaf order/iu,
	);
	assert.throws(
		() => validateCurrentAudioEditorProject({ ...project, tracks: [...project.tracks].reverse() }),
		/project\.tracks.*exact hierarchy preorder/iu,
	);
	assert.throws(
		() => validateCurrentAudioEditorProject({
			...project,
			trackFolders: [...project.trackFolders].reverse(),
		}),
		/project\.trackFolders.*exact hierarchy preorder/iu,
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
		() => createCurrentAudioEditorProject({ sequences: [hostileSequence] }),
		/trackNodes.*own enumerable data property/iu,
	);
	assert.equal(getterCalls, 0);
});

test('clone, JSON load, and local storage preserve hierarchy and characteristics byte-exactly', async () => {
	const project = folderProject();
	const serialized = JSON.stringify(project);
	const loaded = loadCurrentAudioEditorProject(JSON.parse(serialized));
	const cloned = cloneCurrentAudioEditorProject(project);

	assert.deepEqual(loaded, { project, readOnly: false, reason: null });
	assert.notStrictEqual(loaded.project, project);
	assert.deepEqual(cloned, project);
	assert.notStrictEqual(cloned.trackFolders, project.trackFolders);
	assert.notStrictEqual(cloned.sources[0], project.sources[0]);
	assert.equal(JSON.stringify(loaded.project), serialized);

	const store = new AudioEditorProjectStore({ indexedDB: null, databaseName: 'current-structure-roundtrip' });
	await store.saveProject(project);
	const reopened = await store.loadProject(project.id);
	assert.deepEqual(reopened, project);
	assert.equal(JSON.stringify(reopened), serialized);
	await store.close();
});

test('ordinary edits, undo, and redo preserve current structural layers', () => {
	const project = folderProject();
	const command = { type: 'metadata/update', changes: { artist: 'Soundscaper' } } as const;
	const edited = applyEditorCommand(project, command, { now: '2026-08-09T18:01:00.000Z' });
	assert.deepEqual(edited.trackFolders, project.trackFolders);
	assert.deepEqual(edited.sequences[0]?.trackNodes, project.sequences[0]?.trackNodes);
	assert.deepEqual(edited.sources[0], project.sources[0]);

	const executed = executeEditorCommand(createEditorHistory(project), command, {
		now: '2026-08-09T18:01:00.000Z',
	});
	const undone = undoEditorCommand(executed);
	const redone = redoEditorCommand(undone);
	assert.deepEqual(undone.present.trackFolders, project.trackFolders);
	assert.deepEqual(undone.present.sequences[0]?.trackNodes, project.sequences[0]?.trackNodes);
	assert.deepEqual(undone.present.sources, project.sources);
	assert.equal(undone.present.metadata.artist, project.metadata.artist);
	assert.deepEqual(redone.present.trackFolders, edited.trackFolders);
	assert.deepEqual(redone.present.sequences[0]?.trackNodes, edited.sequences[0]?.trackNodes);
	assert.deepEqual(redone.present.sources, edited.sources);
	assert.equal(redone.present.metadata.artist, edited.metadata.artist);
	assert.equal(validateCurrentAudioEditorProject(undone.present), true);
	assert.equal(validateCurrentAudioEditorProject(redone.present), true);
});

test('root track edits reconcile current hierarchy without discarding folders', () => {
	const project = folderProject();
	const appended = applyEditorCommand(project, {
		type: 'track/add', track: { id: 'track-c', name: 'Track C' },
	}, { now: NOW });
	assert.deepEqual(appended.sequences[0]?.trackNodes.at(-1), {
		kind: 'track', id: 'track-c', parentFolderId: null,
	});
	assert.equal(validateCurrentAudioEditorProject(appended), true);
});

test('owned structural features remain bypass-only and reject rendered substitution', () => {
	for (const featureId of [
		PROJECT_FEATURE_CAPABILITY_IDS.trackFolders,
		PROJECT_FEATURE_CAPABILITY_IDS.sourceCharacteristics,
	]) {
		assert.throws(() => normalizeProjectFeatureRequirements({
			schemaVersion: 2,
			requirements: [{
				id: `publisher-${featureId}`,
				featureId,
				displayName: 'Structural authority',
				disposition: 'rendered-fallback',
				fallback: {
					role: 'project-video-render-v1', kind: 'video',
					sourceId: 'fallback-video', sha256: 'ab'.repeat(32),
				},
			}],
		}, {
			sources: [{ id: 'fallback-video', kind: 'video' }],
			clips: [],
			tracks: [],
		}), /not eligible for a video rendered fallback/iu);
	}
});
