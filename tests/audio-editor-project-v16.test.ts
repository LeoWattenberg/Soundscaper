/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	cloneCurrentAudioEditorProject,
	createCurrentAudioEditorProject,
	loadCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import {
	createAudioSource,
	createAudioTrack,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import { PROJECT_OWNED_FEATURE_REQUIREMENT_IDS } from '../src/common/editor/project-owned-feature-requirements.ts';
import { validateProjectTrackLocks } from '../src/common/editor/project-track-lock-validation.ts';
import type { VideoRetimeCurveV16 } from '../src/common/editor/video-retime-v16.ts';

const NOW = '2026-08-11T18:00:00.000Z';

function curve(): VideoRetimeCurveV16 {
	return {
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
}

function projectOptions(retimeMap: unknown = curve()): Record<string, unknown> {
	return {
		id: 'current-retime',
		title: 'Current retime',
		now: NOW,
		sources: [createVideoSource({
			id: 'video-source', name: 'Video', storageKey: 'video-source',
			mimeType: 'video/mp4', frameCount: 40_000, sampleFrameCount: 40_000,
			sourceFrameCount: 20, frameRate: { num: 24, den: 1 }, width: 1920, height: 1080,
		})],
		clips: [{
			kind: 'video', id: 'timeline-video', sourceId: 'video-source', title: 'Timeline',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 4,
			sourceInFrame: 2, sourceFrameCount: 8, retimeMap,
		}],
		tracks: [createVideoTrack({
			id: 'video-track', name: 'Video', clipIds: ['timeline-video'], locked: true,
		})],
		sequences: [{
			id: 'main-sequence', rate: { num: 24, den: 1 }, trackIds: ['video-track'],
		}],
		primarySequenceId: 'main-sequence',
		projectBin: {
			clips: [{
				kind: 'video', id: 'bin-video', binItemId: 'bin-video-item',
				sourceId: 'video-source', title: 'Bin', sequenceId: 'main-sequence',
				sequenceStartFrame: 0, sequenceFrameCount: 4,
				sourceInFrame: 2, sourceFrameCount: 8, retimeMap,
			}],
		},
	};
}

test('current construction binds exact timeline and Project Bin curves in two phases', () => {
	const inputCurve = curve();
	const project = createCurrentAudioEditorProject(projectOptions(inputCurve));

	assert.equal(project.schemaVersion, 17);
	assert.deepEqual(project.clips[0]?.retimeMap, inputCurve);
	assert.deepEqual(project.projectBin.clips[0]?.retimeMap, inputCurve);
	assert.notStrictEqual(project.clips[0]?.retimeMap, inputCurve);
	assert.notStrictEqual(project.projectBin.clips[0]?.retimeMap, inputCurve);
	assert.equal(Object.isFrozen(project.clips[0]?.retimeMap), true);
	assert.equal(validateCurrentAudioEditorProject(project), true);

	const requirement = project.featureRequirements.requirements.find(
		({ id }) => id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.videoRetime,
	);
	assert.deepEqual(requirement, {
		id: 'framescaper.video-retime',
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoRetime,
		displayName: 'Video retime maps',
		disposition: 'bypass',
		fallback: null,
	});
});

test('current construction defaults both video stores to null without claiming retime ownership', () => {
	const project = createCurrentAudioEditorProject(projectOptions(null));
	assert.equal(project.clips[0]?.retimeMap, null);
	assert.equal(project.projectBin.clips[0]?.retimeMap, null);
	assert.equal(project.featureRequirements.requirements.some(
		({ id }) => id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.videoRetime,
	), false);
	assert.equal(validateCurrentAudioEditorProject(project), true);
});

test('current construction and validation refuse legacy breakpoint maps', () => {
	const legacy = {
		feature: 'video-retime',
		points: [
			{ outer: { num: 0, den: 1 }, source: { num: 2, den: 1 }, mode: 'forward' },
			{ outer: { num: 4, den: 1 }, source: { num: 10, den: 1 }, mode: 'forward' },
		],
	};
	assert.throws(() => createCurrentAudioEditorProject(projectOptions(legacy)), /version|keys|unsupported/iu);

	const project = createCurrentAudioEditorProject(projectOptions());
	const invalid = structuredClone(project) as unknown as Record<string, unknown>;
	(invalid.projectBin as { clips: Record<string, unknown>[] }).clips[0]!.retimeMap = legacy;
	assert.throws(() => validateCurrentAudioEditorProject(invalid), /version|keys|unsupported/iu);
});

test('Project Bin curves restore by index when the foundation generates a clip ID', () => {
	const options = projectOptions() as { projectBin: { clips: Record<string, unknown>[] } };
	delete options.projectBin.clips[0]!.id;
	const project = createCurrentAudioEditorProject(options);

	assert.equal(typeof project.projectBin.clips[0]?.id, 'string');
	assert.deepEqual(project.projectBin.clips[0]?.retimeMap, curve());
	assert.equal(validateCurrentAudioEditorProject(project), true);
});

test('non-null retime state is refused on audio clips in either clip store', () => {
	for (const location of ['timeline', 'bin'] as const) {
		assert.throws(
			() => createCurrentAudioEditorProject(audioProjectOptions(location, curve())),
			/(?:retimeMap|retime state).*video/iu,
		);

		const valid = createCurrentAudioEditorProject(audioProjectOptions(location, null));
		const invalid = structuredClone(valid) as unknown as Record<string, unknown>;
		const clips = location === 'timeline'
			? invalid.clips as Record<string, unknown>[]
			: (invalid.projectBin as { clips: Record<string, unknown>[] }).clips;
		clips[0]!.retimeMap = curve();
		assert.throws(
			() => validateCurrentAudioEditorProject(invalid),
			/(?:retimeMap|retime state).*video/iu,
		);
	}
});

test('retime accessors are rejected in both stores without invocation', () => {
	for (const location of ['timeline', 'bin'] as const) {
		let getterCalls = 0;
		const options = audioProjectOptions(location, null);
		const clips = location === 'timeline'
			? options.clips as Record<string, unknown>[]
			: (options.projectBin as { clips: Record<string, unknown>[] }).clips;
		Object.defineProperty(clips[0]!, 'retimeMap', {
			enumerable: true,
			get() {
				getterCalls += 1;
				return curve();
			},
		});

		assert.throws(
			() => createCurrentAudioEditorProject(options),
			/retimeMap.*data property/iu,
		);
		assert.equal(getterCalls, 0);
	}
});

test('owned current curves refuse publisher substitution while unretimed state permits it', () => {
	const options = projectOptions();
	options.featureRequirements = publisherVideoRetimeRequirement();
	assert.throws(
		() => createCurrentAudioEditorProject(options),
		/owned|publisher|video-retime|conflict/iu,
	);

	const unretimed = projectOptions(null);
	unretimed.featureRequirements = publisherVideoRetimeRequirement();
	const project = createCurrentAudioEditorProject(unretimed);
	assert.equal(project.featureRequirements.requirements[0]?.id, 'publisher.video-retime');
});

test('current clone, load, and inherited lock validation preserve curve authority', () => {
	const project = createCurrentAudioEditorProject(projectOptions());
	const clone = cloneCurrentAudioEditorProject(project);
	const loaded = loadCurrentAudioEditorProject(project);

	assert.deepEqual(clone, project);
	assert.notStrictEqual(clone, project);
	assert.notStrictEqual(clone.clips[0]?.retimeMap, project.clips[0]?.retimeMap);
	assert.deepEqual(loaded, { project, readOnly: false, reason: null });
	assert.notStrictEqual(loaded.project, project);
	validateProjectTrackLocks(project);

	const missingLock = structuredClone(project) as unknown as Record<string, unknown>;
	delete (missingLock.tracks as Record<string, unknown>[])[0]!.locked;
	assert.throws(() => validateCurrentAudioEditorProject(missingLock), /locked.*data property/iu);
});

function audioProjectOptions(
	location: 'timeline' | 'bin',
	retimeMap: unknown,
): Record<string, unknown> {
	const source = createAudioSource({
		id: 'audio-source', name: 'Audio', storageKey: 'audio-source',
		frameCount: 48_000, channelCount: 1, sampleRate: 48_000,
	});
	const clip = {
		kind: 'audio', id: 'audio-clip', sourceId: 'audio-source', title: 'Audio',
		timelineStartFrame: 0, durationFrames: 100,
		sourceStartFrame: 0, sourceDurationFrames: 100,
		retimeMap,
	};
	return {
		id: `audio-retime-${location}`,
		now: NOW,
		sources: [source],
		clips: location === 'timeline' ? [clip] : [],
		tracks: location === 'timeline'
			? [createAudioTrack({ id: 'audio-track', clipIds: ['audio-clip'] })]
			: [],
		projectBin: {
			clips: location === 'bin' ? [{ ...clip, binItemId: 'audio-item' }] : [],
		},
	};
}

function publisherVideoRetimeRequirement(): Record<string, unknown> {
	return {
		schemaVersion: 2,
		requirements: [{
			id: 'publisher.video-retime',
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoRetime,
			displayName: 'Publisher retime',
			disposition: 'bypass',
			fallback: null,
		}],
	};
}
