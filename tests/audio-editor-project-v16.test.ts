/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AudioEditorProjectReimportRequiredError,
	migrateAudioEditorProject,
} from '../src/common/editor/migration.js';
import {
	cloneCurrentAudioEditorProject,
	createCurrentAudioEditorProject,
	loadCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	AUDIO_EDITOR_PROJECT_SCHEMA_VERSION,
	isSourceCharacteristicsProjectSchema,
	isTimelineAnnotationProjectSchema,
	isTrackFolderProjectSchema,
	isTrackLockProjectSchema,
	isVideoRetimeCurveProjectSchema,
} from '../src/common/editor/project-schema-version.ts';
import {
	createAudioEditorProjectV15,
	validateAudioEditorProjectV15,
} from '../src/common/editor/project-v15.ts';
import {
	AUDIO_EDITOR_PROJECT_V16_SCHEMA_VERSION,
	cloneAudioEditorProjectV16,
	createAudioEditorProjectV16,
	loadAudioEditorProjectV16,
	validateAudioEditorProjectV16,
	type AudioEditorProjectV16,
} from '../src/common/editor/project-v16.ts';
import {
	createAudioSourceV10,
	createAudioTrackV10,
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { PROJECT_OWNED_FEATURE_REQUIREMENT_IDS } from '../src/common/editor/project-owned-feature-requirements.ts';
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
		id: 'v16-retime',
		title: 'V16 retime',
		now: NOW,
		sources: [createVideoSourceV10({
			id: 'video-source',
			name: 'Video',
			frameCount: 40_000,
			sampleFrameCount: 40_000,
			sourceFrameCount: 20,
			frameRate: { num: 24, den: 1 },
			width: 1920,
			height: 1080,
		})],
		clips: [{
			kind: 'video',
			id: 'timeline-video',
			sourceId: 'video-source',
			title: 'Timeline',
			sequenceId: 'main-sequence',
			sequenceStartFrame: 0,
			sequenceFrameCount: 4,
			sourceInFrame: 2,
			sourceFrameCount: 8,
			retimeMap,
		}],
		tracks: [createVideoTrackV10({
			id: 'video-track',
			name: 'Video',
			clipIds: ['timeline-video'],
			locked: true,
		})],
		sequences: [{
			id: 'main-sequence',
			rate: { num: 24, den: 1 },
			trackIds: ['video-track'],
		}],
		primarySequenceId: 'main-sequence',
		projectBin: {
			clips: [{
				kind: 'video',
				id: 'bin-video',
				binItemId: 'bin-video-item',
				sourceId: 'video-source',
				title: 'Bin',
				sequenceId: 'main-sequence',
				sequenceStartFrame: 0,
				sequenceFrameCount: 4,
				sourceInFrame: 2,
				sourceFrameCount: 8,
				retimeMap,
			}],
		},
	};
}

test('V16 creates and validates exact timeline and Project Bin curve wires in two phases', () => {
	const inputCurve = curve();
	const project = createAudioEditorProjectV16(projectOptions(inputCurve));

	assert.equal(project.schemaVersion, 16);
	assert.deepEqual(project.clips[0]?.retimeMap, inputCurve);
	assert.deepEqual(project.projectBin.clips[0]?.retimeMap, inputCurve);
	assert.notStrictEqual(project.clips[0]?.retimeMap, inputCurve);
	assert.notStrictEqual(project.projectBin.clips[0]?.retimeMap, inputCurve);
	assert.equal(Object.isFrozen(project.clips[0]?.retimeMap), true);
	assert.equal(validateAudioEditorProjectV16(project), true);
	assert.throws(() => validateCurrentAudioEditorProject(project), /schema version/iu);

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

test('V16 defaults both video clip stores to null and does not declare video-retime ownership', () => {
	const project = createAudioEditorProjectV16(projectOptions(null));
	assert.equal(project.clips[0]?.retimeMap, null);
	assert.equal(project.projectBin.clips[0]?.retimeMap, null);
	assert.equal(project.featureRequirements.requirements.some(
		({ id }) => id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.videoRetime,
	), false);
	assert.equal(validateAudioEditorProjectV16(project), true);
});

test('V16 exact validation refuses a V15 breakpoint map in either clip store', () => {
	const legacy = {
		feature: 'video-retime',
		points: [
			{ outer: { num: 0, den: 1 }, source: { num: 2, den: 1 }, mode: 'forward' },
			{ outer: { num: 4, den: 1 }, source: { num: 10, den: 1 }, mode: 'forward' },
		],
	};
	assert.throws(() => createAudioEditorProjectV16(projectOptions(legacy)), /version|keys|unsupported/iu);
	const historical = createAudioEditorProjectV15(projectOptions(legacy));
	assert.equal(validateAudioEditorProjectV15(historical), true);
	assert.deepEqual(historical.clips[0]?.retimeMap, legacy);
	assert.deepEqual(historical.projectBin.clips[0]?.retimeMap, legacy);
	const historicalPublisherOptions = projectOptions(legacy);
	historicalPublisherOptions.featureRequirements = publisherVideoRetimeRequirement();
	const historicalRequirements = createAudioEditorProjectV15(
		historicalPublisherOptions,
	).featureRequirements.requirements;
	assert.equal(historicalRequirements.some(({ id }) => id === 'publisher.video-retime'), true);
	assert.equal(historicalRequirements.some(
		({ id }) => id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.videoRetime,
	), false, 'V15 retains its historical same-feature publisher precedence');

	const project = createAudioEditorProjectV16(projectOptions());
	const invalid = structuredClone(project) as unknown as Record<string, unknown>;
	(invalid.projectBin as { clips: Record<string, unknown>[] }).clips[0]!.retimeMap = legacy;
	assert.throws(() => validateAudioEditorProjectV16(invalid), /version|keys|unsupported/iu);
});

test('V16 restores Project Bin curves by index when the inherited creator generates a clip ID', () => {
	const options = projectOptions() as {
		projectBin: { clips: Record<string, unknown>[] };
	};
	delete options.projectBin.clips[0]!.id;
	const project = createAudioEditorProjectV16(options);

	assert.equal(typeof project.projectBin.clips[0]?.id, 'string');
	assert.deepEqual(project.projectBin.clips[0]?.retimeMap, curve());
	assert.equal(validateAudioEditorProjectV16(project), true);
});

test('V16 refuses non-null video-retime state on audio clips in both clip stores', () => {
	for (const location of ['timeline', 'bin'] as const) {
		const options = audioProjectOptions(location, curve());
		assert.throws(
			() => createAudioEditorProjectV16(options),
			/(?:retimeMap|retime state).*video/iu,
		);

		const valid = createAudioEditorProjectV16(audioProjectOptions(location, null));
		const invalid = structuredClone(valid) as unknown as Record<string, unknown>;
		const clips = location === 'timeline'
			? invalid.clips as Record<string, unknown>[]
			: (invalid.projectBin as { clips: Record<string, unknown>[] }).clips;
		clips[0]!.retimeMap = curve();
		assert.throws(
			() => validateAudioEditorProjectV16(invalid),
			/(?:retimeMap|retime state).*video/iu,
		);
	}
});

test('V16 refuses audio retime accessors in both clip stores without invoking them', () => {
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
			() => createAudioEditorProjectV16(options),
			/retimeMap.*data property/iu,
		);
		assert.equal(getterCalls, 0);
	}
});

test('V16 refuses publisher substitution for non-null curves but retains normal publisher ownership otherwise', () => {
	const options = projectOptions();
	options.featureRequirements = publisherVideoRetimeRequirement();
	assert.throws(() => createAudioEditorProjectV16(options), /owned|publisher|video-retime|conflict/iu);

	const unretimed = projectOptions(null);
	unretimed.featureRequirements = options.featureRequirements;
	const project = createAudioEditorProjectV16(unretimed);
	assert.equal(project.featureRequirements.requirements[0]?.id, 'publisher.video-retime');
});

test('V16 clone/load and V17 current aliases preserve curve state; V18 stays opaque', () => {
	const project = createAudioEditorProjectV16(projectOptions());
	const clone = cloneAudioEditorProjectV16(project);
	const loaded = loadAudioEditorProjectV16(project);
	const current = createCurrentAudioEditorProject(projectOptions());

	assert.deepEqual(clone, project);
	assert.notStrictEqual(clone, project);
	assert.notStrictEqual(clone.clips[0]?.retimeMap, project.clips[0]?.retimeMap);
	assert.deepEqual(loaded, { project, readOnly: false, reason: null });
	assert.notStrictEqual(
		(loaded.project as AudioEditorProjectV16).projectBin.clips[0]?.retimeMap,
		project.projectBin.clips[0]?.retimeMap,
	);
	assert.equal(current.schemaVersion, 17);
	assert.deepEqual(current.takeGroups, []);
	assert.deepEqual(cloneCurrentAudioEditorProject(current), current);
	assert.deepEqual(loadCurrentAudioEditorProject(current), { project: current, readOnly: false, reason: null });

	const v15 = createAudioEditorProjectV15({ id: 'historical-v15', now: NOW });
	assert.equal(validateAudioEditorProjectV15(v15), true);
	assert.throws(
		() => migrateAudioEditorProject(v15),
		(error: unknown) => error instanceof AudioEditorProjectReimportRequiredError,
	);
	const future = { ...current, schemaVersion: 18, future: { retained: true } };
	assert.deepEqual(migrateAudioEditorProject(future), {
		project: future,
		migrated: false,
		fromVersion: 18,
		readOnly: true,
		reason: 'newer-schema',
	});
});

test('current V17 inherits the V16 retime predicate while keeping V15 historical', () => {
	assert.equal(AUDIO_EDITOR_PROJECT_V16_SCHEMA_VERSION, 16);
	assert.equal(AUDIO_EDITOR_PROJECT_SCHEMA_VERSION, 17);
	assert.equal(AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION, 17);
	for (const predicate of [
		isTimelineAnnotationProjectSchema,
		isTrackFolderProjectSchema,
		isSourceCharacteristicsProjectSchema,
		isTrackLockProjectSchema,
		isVideoRetimeCurveProjectSchema,
	]) assert.equal(predicate(16), true);
	assert.equal(isVideoRetimeCurveProjectSchema(17), true);
	assert.equal(isVideoRetimeCurveProjectSchema(15), false);
	assert.equal(isTrackLockProjectSchema(15), true);
});

test('V16 validator retains inherited V15 lock validation', () => {
	const project = createAudioEditorProjectV16(projectOptions()) as unknown as Record<string, unknown>;
	delete (project.tracks as Record<string, unknown>[])[0]!.locked;
	assert.throws(() => validateAudioEditorProjectV16(project), /locked.*data property/iu);
});

function typed(_project: AudioEditorProjectV16): void {}
void typed;

function audioProjectOptions(
	location: 'timeline' | 'bin',
	retimeMap: unknown,
): Record<string, unknown> {
	const source = createAudioSourceV10({
		id: 'audio-source', name: 'Audio', frameCount: 48_000, channelCount: 1, sampleRate: 48_000,
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
			? [createAudioTrackV10({ id: 'audio-track', clipIds: ['audio-clip'] })]
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
