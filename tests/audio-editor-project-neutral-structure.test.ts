/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	validateProjectAudioWarpRuntimeAuthority,
} from '../src/common/editor/project-audio-warp-validation.ts';
import {
	validateProjectHierarchyDocument,
} from '../src/common/editor/project-hierarchy-document-validation.ts';
import { createProjectFoundation } from '../src/common/editor/project-foundation-factory.ts';
import {
	createProjectRetimeFoundation,
} from '../src/common/editor/project-retime-factory.ts';
import {
	createProjectStructureFoundation,
} from '../src/common/editor/project-structure-factory.ts';
import {
	validateProjectTrackLocks,
} from '../src/common/editor/project-track-lock-validation.ts';

const NOW = '2026-08-20T09:00:00.000Z';

test('the neutral structure step reproduces current annotation, hierarchy, bus, and lock state', () => {
	const options = structureOptions();
	const actual = createProjectStructureFoundation(options, createProjectFoundation);

	assert.equal(actual.schemaVersion, 17);
	assert.deepEqual(actual.selection.annotationIds, ['marker-a']);
	assert.deepEqual(actual.trackFolders, [{
		id: 'folder-a', name: 'Folder A', collapsed: false, height: 40,
		hidden: false, mute: false, solo: false,
	}]);
	assert.deepEqual(actual.sequences[0]?.trackIds, ['track-a']);
	assert.deepEqual(actual.sequences[0]?.trackNodes, [
		{ kind: 'folder', id: 'folder-a', parentFolderId: null },
		{ kind: 'track', id: 'track-a', parentFolderId: 'folder-a' },
	]);
	assert.equal(actual.tracks[0]?.locked, false);
	assert.equal(validateProjectHierarchyDocument(actual, 17), true);
	validateProjectTrackLocks(actual);
});

test('the neutral retime step hides curves from its foundation and restores exact current authority', () => {
	const options = retimeOptions();
	let observedTimelineRetime: unknown = Symbol('unobserved');
	let observedBinRetime: unknown = Symbol('unobserved');
	const actual = createProjectRetimeFoundation(options, (foundationOptions) => {
		const clips = foundationOptions.clips as readonly Readonly<Record<string, unknown>>[];
		const projectBin = foundationOptions.projectBin as Readonly<Record<string, unknown>>;
		const binClips = projectBin.clips as readonly Readonly<Record<string, unknown>>[];
		observedTimelineRetime = clips[0]?.retimeMap;
		observedBinRetime = binClips[0]?.retimeMap;
		return createProjectStructureFoundation(foundationOptions, createProjectFoundation);
	});

	assert.equal(observedTimelineRetime, null);
	assert.equal(observedBinRetime, null);
	assert.deepEqual(actual.clips[0]?.retimeMap, options.clips[0]?.retimeMap);
	assert.deepEqual(
		(actual.projectBin.clips[0] as Readonly<Record<string, unknown>> | undefined)?.retimeMap,
		options.clips[0]?.retimeMap,
	);
	assert.notStrictEqual(actual.clips[0]?.retimeMap, options.clips[0]?.retimeMap);
	assert.equal(validateProjectHierarchyDocument(actual, 17), true);
});

test('neutral leaf validators retain strict current-document failures', () => {
	const project = createProjectStructureFoundation(structureOptions(), createProjectFoundation);
	const unlocked = structuredClone(project) as unknown as Record<string, unknown>;
	(unlocked.tracks as Record<string, unknown>[])[0] = {
		...(unlocked.tracks as Record<string, unknown>[])[0],
		locked: 'no',
	};
	assert.throws(() => validateProjectTrackLocks(unlocked as never), /locked must be boolean/iu);

	validateProjectAudioWarpRuntimeAuthority(project as unknown as Record<string, unknown>);
	const malformed = structuredClone(project) as unknown as Record<string, unknown>;
	(malformed.clips as Record<string, unknown>[]).push({
		kind: 'audio',
		warpMap: { feature: 'audio-warp', points: [] },
	});
	assert.throws(
		() => validateProjectAudioWarpRuntimeAuthority(malformed),
		/native runtime authority/iu,
	);
});

function structureOptions(): Record<string, unknown> {
	return {
		id: 'neutral-structure', title: 'Neutral structure', now: NOW,
		selection: { startFrame: 0, endFrame: 0, annotationIds: ['marker-a'] },
		tracks: [{ id: 'track-a', type: 'audio', name: 'Track A', clipIds: [] }],
		trackFolders: [{ id: 'folder-a', name: 'Folder A' }],
		sequences: [{
			id: 'main-sequence',
			trackNodes: [
				{ kind: 'folder', id: 'folder-a', parentFolderId: null },
				{ kind: 'track', id: 'track-a', parentFolderId: 'folder-a' },
			],
		}],
		primarySequenceId: 'main-sequence',
		timelineAnnotations: [{
			id: 'marker-a', sequenceId: 'main-sequence', name: 'Marker A', color: 'teal',
			batchId: null, opaqueExtensions: {}, kind: 'marker', anchor: 'sample',
			positionFrame: 0,
		}],
	};
}

function retimeOptions(): Record<string, unknown> & {
	readonly clips: readonly Readonly<Record<string, unknown>>[];
} {
	const retimeMap = {
		feature: 'video-retime',
		version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 2, den: 1 } },
			{ outerFrame: 4, sourceFrame: { num: 10, den: 1 } },
		],
		segments: [{
			mode: 'ramp-forward',
			startVelocity: { num: 1, den: 1 },
			endVelocity: { num: 3, den: 1 },
		}],
	};
	const clip = {
		kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'Video',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 4,
		sourceInFrame: 2, sourceFrameCount: 8, retimeMap,
	};
	return {
		id: 'neutral-retime', title: 'Neutral retime', now: NOW,
		sources: [{
			kind: 'video', id: 'video-source', name: 'Video', storageKey: 'video-source',
			mimeType: 'video/mp4', frameCount: 40_000, sampleFrameCount: 40_000,
			sourceFrameCount: 20, frameRate: { num: 24, den: 1 }, width: 1920, height: 1080,
		}],
		clips: [clip],
		tracks: [{ id: 'video-track', type: 'video', name: 'Video', clipIds: ['video-clip'] }],
		sequences: [{ id: 'main-sequence', rate: { num: 24, den: 1 }, trackIds: ['video-track'] }],
		primarySequenceId: 'main-sequence',
		projectBin: { clips: [{ ...clip, id: 'bin-video', binItemId: 'bin-video' }] },
	};
}
