/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createCrossProductHandoffLaunchIntent,
	parseCrossProductHandoffLaunchIntent,
	serializeCrossProductHandoffLaunchIntent,
} from '../src/common/cross-product-handoff-intent.ts';
import {
	CrossProductHandoffRefusalError,
	convertCrossProductEditableCopy,
	crossProductHandoffRootPolicy,
} from '../src/common/transfer/cross-product-handoff-conversion.ts';
import { crossProductHandoffRootNames } from
	'../src/common/transfer/cross-product-handoff-root-contract.ts';
import {
	createCrossProductHandoffProvenanceFromReport,
	readCrossProductHandoffProvenance,
} from '../src/common/transfer/cross-product-handoff-provenance.ts';
import {
	createAudioSource,
	createAudioTrack,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	SOUNDSCAPER_PROJECT_FIELDS,
	validateSoundscaperProject,
} from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import {
	FRAMESCAPER_PROJECT_FIELDS,
	createFramescaperProject,
	validateFramescaperProject,
} from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from
	'../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';

const NOW = '2026-08-29T12:00:00.000Z';

test('a strict versioned launch intent round-trips one family-qualified source and minted destination', () => {
	const source = createSoundscaperProject({ id: 'source-project', now: NOW });
	const intent = createCrossProductHandoffLaunchIntent({
		sourceProject: source,
		destinationFamily: 'framescaper',
		invocationId: 'invocation-1',
		destinationProjectId: 'framescaper-copy-1',
	});
	assert.deepEqual(intent, {
		kind: 'cross-product-editable-copy',
		version: 1,
		invocationId: 'invocation-1',
		sourceRevision: source.revision,
		source: { schemaFamily: 'soundscaper', schemaVersion: 1, projectId: 'source-project' },
		destination: { schemaFamily: 'framescaper', schemaVersion: 1, projectId: 'framescaper-copy-1' },
	});
	assert.ok(Object.isFrozen(intent));
	assert.ok(Object.isFrozen(intent.source));
	assert.deepEqual(
		parseCrossProductHandoffLaunchIntent(serializeCrossProductHandoffLaunchIntent(intent)),
		intent,
	);
});

test('launch intent admission rejects widening, same-family copies, and malformed references', () => {
	const valid = createCrossProductHandoffLaunchIntent({
		sourceProject: createSoundscaperProject({ id: 'source-project', now: NOW }),
		destinationFamily: 'framescaper',
		invocationId: 'invocation-1',
		destinationProjectId: 'framescaper-copy-1',
	});
	assert.throws(() => parseCrossProductHandoffLaunchIntent(new URLSearchParams({
		handoff: JSON.stringify({ ...valid, surprise: true }),
	})), /unsupported field/iu);
	assert.throws(() => parseCrossProductHandoffLaunchIntent(new URLSearchParams({
		handoff: JSON.stringify({ ...valid, destination: { ...valid.destination, schemaFamily: 'soundscaper' } }),
	})), /different product/iu);
	assert.throws(() => parseCrossProductHandoffLaunchIntent(new URLSearchParams({
		handoff: JSON.stringify({ ...valid, source: { ...valid.source, projectId: '' } }),
	})), /projectId/iu);
	assert.throws(() => parseCrossProductHandoffLaunchIntent(new URLSearchParams({
		handoff: JSON.stringify({ ...valid, sourceRevision: -1 }),
	})), /sourceRevision/iu);
	assert.equal(parseCrossProductHandoffLaunchIntent(new URLSearchParams()), null);
	assert.throws(
		() => parseCrossProductHandoffLaunchIntent(`handoff=${'x'.repeat(16 * 1024)}`),
		/URL budget/iu,
	);
	assert.throws(
		() => parseCrossProductHandoffLaunchIntent(`handoff=${encodeURIComponent('x'.repeat(4 * 1024 + 1))}`),
		/JSON budget/iu,
	);
});

test('an editable-copy intent is bound to the exact source revision it captured', () => {
	const source = createSoundscaperProject({ id: 'revision-source', now: NOW });
	const intent = createCrossProductHandoffLaunchIntent({
		sourceProject: source, destinationFamily: 'framescaper',
		invocationId: 'revision-invocation', destinationProjectId: 'revision-copy',
	});
	assert.equal(intent.sourceRevision, source.revision);
	assert.throws(
		() => convertCrossProductEditableCopy({
			intent,
			sourceProject: { ...source, revision: source.revision + 1 },
		}),
		/exact source revision|source does not match/iu,
	);
});

test('the conversion policy exhaustively classifies every persisted family-v1 root once', () => {
	for (const [family, fields] of [
		['soundscaper', SOUNDSCAPER_PROJECT_FIELDS],
		['framescaper', FRAMESCAPER_PROJECT_FIELDS],
	] as const) {
		assert.deepEqual(crossProductHandoffRootNames(family), fields);
		const policy = crossProductHandoffRootPolicy(family);
		assert.deepEqual(policy.map(({ root }) => root).sort(), [...fields].sort());
		assert.equal(new Set(policy.map(({ root }) => root)).size, fields.length);
		for (const item of policy) {
			assert.ok(['copy', 'materialize-fallback', 'omit-with-report', 'refuse'].includes(item.disposition));
			assert.ok(item.reason.length > 0);
		}
	}
	assert.equal(
		crossProductHandoffRootPolicy('framescaper').find(({ root }) => root === 'takeGroups')?.disposition,
		'copy',
	);
});

test('a safe Soundscaper root becomes a separately identified writable Framescaper v1 copy', () => {
	const source = createSoundscaperProject({
		id: 'sound-source', title: 'Sound source', now: NOW,
		metadata: { artist: 'Author', comments: 'Keep this' },
	});
	const before = structuredClone(source);
	const intent = createCrossProductHandoffLaunchIntent({
		sourceProject: source,
		destinationFamily: 'framescaper',
		invocationId: 'sound-to-frame-1',
		destinationProjectId: 'frame-copy-1',
	});
	const result = convertCrossProductEditableCopy({ intent, sourceProject: source });
	assert.deepEqual(source, before, 'source authority is unchanged');
	assert.equal(result.project.schemaFamily, 'framescaper');
	assert.equal(result.project.schemaVersion, 1);
	assert.equal(result.project.id, 'frame-copy-1');
	assert.equal(result.project.title, 'Sound source');
	assert.equal((result.project.metadata as { artist: string }).artist, 'Author');
	assert.equal(validateFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, result.project), true);
	assert.equal(result.report.refused, false);
	assert.equal(result.report.source.projectId, 'sound-source');
	assert.equal(result.report.destination?.projectId, 'frame-copy-1');
	assert.equal(result.report.roots.length, SOUNDSCAPER_PROJECT_FIELDS.length);
	assert.deepEqual(
		readCrossProductHandoffProvenance(result.project),
		createCrossProductHandoffProvenanceFromReport(result.report),
	);
	assert.ok(Object.isFrozen(result.report));
});

test('a safe Framescaper audio root becomes a separately identified writable Soundscaper v1 copy', () => {
	const source = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		id: 'frame-source', title: 'Frame source', now: NOW,
		metadata: { artist: 'Editor' },
	});
	const before = structuredClone(source);
	const intent = createCrossProductHandoffLaunchIntent({
		sourceProject: source,
		destinationFamily: 'soundscaper',
		invocationId: 'frame-to-sound-1',
		destinationProjectId: 'sound-copy-1',
	});
	const result = convertCrossProductEditableCopy({ intent, sourceProject: source });
	assert.deepEqual(source, before, 'source authority is unchanged');
	assert.equal(result.project.schemaFamily, 'soundscaper');
	assert.equal(result.project.schemaVersion, 1);
	assert.equal(result.project.id, 'sound-copy-1');
	assert.equal((result.project.metadata as { artist: string }).artist, 'Editor');
	assert.equal(result.report.refused, false);
	assert.equal(result.report.roots.length, FRAMESCAPER_PROJECT_FIELDS.length);
});

test('a second cross-product hop replaces only the reserved prior invocation provenance', () => {
	const source = createSoundscaperProject({ id: 'two-hop-source', now: NOW });
	const firstIntent = createCrossProductHandoffLaunchIntent({
		sourceProject: source, destinationFamily: 'framescaper',
		invocationId: 'first-hop', destinationProjectId: 'first-hop-copy',
	});
	const first = convertCrossProductEditableCopy({ intent: firstIntent, sourceProject: source });
	const firstBefore = structuredClone(first.project);
	const secondIntent = createCrossProductHandoffLaunchIntent({
		sourceProject: first.project, destinationFamily: 'soundscaper',
		invocationId: 'second-hop', destinationProjectId: 'second-hop-copy',
	});
	const second = convertCrossProductEditableCopy({ intent: secondIntent, sourceProject: first.project });
	assert.deepEqual(first.project, firstBefore);
	assert.equal(second.report.refused, false);
	assert.equal(readCrossProductHandoffProvenance(second.project)?.invocationId, 'second-hop');
	assert.equal(second.report.roots.find(({ root }) => root === 'opaqueExtensions')?.disposition,
		'materialize-fallback');
	assert.throws(() => convertCrossProductEditableCopy({
		intent: secondIntent,
		sourceProject: {
			...first.project,
			opaqueExtensions: {
				...(first.project.opaqueExtensions as Record<string, unknown>),
				foreignAuthority: true,
			},
		},
	}), (error: unknown) => error instanceof CrossProductHandoffRefusalError
		&& error.report.roots.find(({ root }) => root === 'opaqueExtensions')?.disposition === 'refuse');
});

test('Framescaper visual-only roots are omitted or projected explicitly in the conversion report', () => {
	const source = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		id: 'visual-source', title: 'Visual source', now: NOW,
		sources: [createVideoSource({
			id: 'video-source', name: 'Video', storageKey: 'video-source', mimeType: 'video/mp4',
			contentSha256: '12'.repeat(32), frameCount: 48_000, sampleFrameCount: 48_000,
			sourceFrameCount: 10, frameRate: { num: 10, den: 1 }, width: 1_920, height: 1_080,
		})],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'Video',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
			fadeInFrames: 0, fadeOutFrames: 0,
		}],
		tracks: [createVideoTrack({
			id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: false,
		})],
		sequences: [{
			id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track'],
		}],
		primarySequenceId: 'main-sequence',
	});
	const intent = createCrossProductHandoffLaunchIntent({
		sourceProject: source, destinationFamily: 'soundscaper',
		invocationId: 'visual-projection', destinationProjectId: 'audio-copy',
	});
	const result = convertCrossProductEditableCopy({ intent, sourceProject: source });
	for (const root of ['sources', 'clips', 'tracks']) {
		const row = result.report.roots.find((candidate) => candidate.root === root);
		assert.equal(row?.disposition, 'omit-with-report', root);
		assert.notEqual(row?.sourceSha256, row?.destinationSha256, root);
	}
	assert.equal(
		result.report.roots.find(({ root }) => root === 'sequences')?.disposition,
		'materialize-fallback',
	);
});

test('Framescaper projection severs omitted visual links while retaining linked audio', () => {
	const options = framescaperBaselineOptions();
	const source = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		...options,
		clips: records(options.clips).map((clip) => ({ ...clip, avLinkId: 'linked-av-1' })),
		tracks: records(options.tracks).map((track) => ({ ...track, laneGroupId: 'linked-lane-1' })),
	});
	const before = structuredClone(source);
	const intent = createCrossProductHandoffLaunchIntent({
		sourceProject: source, destinationFamily: 'soundscaper',
		invocationId: 'linked-av-projection', destinationProjectId: 'linked-audio-copy',
	});
	const result = convertCrossProductEditableCopy({ intent, sourceProject: source });
	assert.equal(validateSoundscaperProject(result.project), true);
	assert.deepEqual(records(result.project.clips).map(({ id, avLinkId }) => [id, avLinkId]), [
		['audio-clip', null],
	]);
	assert.deepEqual(records(result.project.tracks).map(({ id, laneGroupId }) => [id, laneGroupId]), [
		['audio-track', null],
	]);
	assert.deepEqual(source, before);
});

test('Framescaper projection retains audio owned by every sequence without dangling roots', () => {
	const options = framescaperBaselineOptions();
	const sources = records(options.sources);
	const clips = records(options.clips);
	const tracks = records(options.tracks);
	const source = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		...options,
		sources: [...sources, {
			kind: 'audio', id: 'secondary-source', name: 'Secondary', storageKey: 'secondary-source',
			mimeType: 'audio/wav', frameCount: 48_000, channelCount: 1,
			sampleRate: 48_000, originalSampleRate: 48_000,
		}],
		clips: [...clips, {
			kind: 'audio', id: 'secondary-clip', sourceId: 'secondary-source', title: 'Secondary',
			timelineStartFrame: 0, sourceStartFrame: 0,
			sourceDurationFrames: 48_000, durationFrames: 48_000,
		}],
		tracks: [...tracks, {
			id: 'secondary-track', name: 'Secondary', type: 'audio', clipIds: ['secondary-clip'],
			height: 96, collapsed: false,
		}],
		sequences: [
			{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track', 'audio-track'] },
			{ id: 'secondary-sequence', rate: { num: 10, den: 1 }, trackIds: ['secondary-track'] },
		],
	});
	const intent = createCrossProductHandoffLaunchIntent({
		sourceProject: source, destinationFamily: 'soundscaper',
		invocationId: 'multi-sequence-projection', destinationProjectId: 'multi-sequence-copy',
	});
	const result = convertCrossProductEditableCopy({ intent, sourceProject: source });
	assert.equal(validateSoundscaperProject(result.project), true);
	assert.deepEqual(records(result.project.sequences).map(({ id, trackIds }) => [id, trackIds]), [
		['main-sequence', ['audio-track']],
		['secondary-sequence', ['secondary-track']],
	]);
	assert.deepEqual(records(result.project.clips).map(({ id }) => id), ['audio-clip', 'secondary-clip']);
	assert.deepEqual(records(result.project.sources).map(({ id }) => id), ['audio-source', 'secondary-source']);
});

test('Framescaper projection retains alternate sources referenced only by take groups', () => {
	const options = framescaperBaselineOptions();
	const source = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		...options,
		sources: [...records(options.sources), {
			kind: 'audio', id: 'alternate-take-source', name: 'Alternate take',
			storageKey: 'alternate-take-source', mimeType: 'audio/wav', frameCount: 48_000,
			channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		}],
		takeGroups: [{
			id: 'take-group', sequenceId: 'main-sequence', trackId: 'audio-track',
			startSample: 0, endSample: 48_000, laneOrder: ['take-lane'],
			lanes: [{ id: 'take-lane' }],
			takes: [{
				id: 'alternate-take', laneId: 'take-lane', sourceId: 'alternate-take-source',
				startSample: 0, endSample: 48_000, sourceStartSample: 0,
			}],
			compRegions: [{
				id: 'alternate-region', takeId: 'alternate-take', startSample: 0, endSample: 48_000,
			}],
		}],
	});
	const intent = createCrossProductHandoffLaunchIntent({
		sourceProject: source, destinationFamily: 'soundscaper',
		invocationId: 'take-source-projection', destinationProjectId: 'take-source-copy',
	});
	const result = convertCrossProductEditableCopy({ intent, sourceProject: source });
	assert.equal(validateSoundscaperProject(result.project), true);
	assert.deepEqual(records(result.project.sources).map(({ id }) => id), [
		'audio-source', 'alternate-take-source',
	]);
	assert.equal(records(result.project.takeGroups).length, 1);
});

test('unsupported audible Soundscaper state refuses with an exhaustive report before mutation', () => {
	const source = createSoundscaperProject({
		id: 'takes-source', now: NOW,
		sources: [createAudioSource({
			id: 'take-source', name: 'Take', frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
		})],
		tracks: [createAudioTrack({ id: 'take-track', name: 'Vocal', clipIds: [] })],
		sequences: [{ id: 'main-sequence', trackIds: ['take-track'] }],
		primarySequenceId: 'main-sequence',
		takeGroups: [{
			id: 'take-group', sequenceId: 'main-sequence', trackId: 'take-track',
			startSample: 100, endSample: 500, laneOrder: ['take-lane'],
			lanes: [{ id: 'take-lane' }],
			takes: [{
				id: 'take-a', laneId: 'take-lane', sourceId: 'take-source',
				startSample: 100, endSample: 500, sourceStartSample: 0,
			}],
			compRegions: [{ id: 'region-a', takeId: 'take-a', startSample: 100, endSample: 500 }],
		}],
	});
	const before = structuredClone(source);
	const intent = createCrossProductHandoffLaunchIntent({
		sourceProject: source,
		destinationFamily: 'framescaper',
		invocationId: 'refused-1',
		destinationProjectId: 'never-written',
	});
	assert.throws(
		() => convertCrossProductEditableCopy({ intent, sourceProject: source }),
		(error: unknown) => {
			assert.ok(error instanceof CrossProductHandoffRefusalError);
			assert.equal(error.report.refused, true);
			assert.equal(error.report.destination, null);
			assert.equal(error.report.roots.length, SOUNDSCAPER_PROJECT_FIELDS.length);
			assert.equal(error.report.roots.find(({ root }) => root === 'takeGroups')?.disposition, 'refuse');
			return true;
		},
	);
	assert.deepEqual(source, before);
});

test('one invocation reuses its destination identity while a later invocation mints another copy', () => {
	const source = createSoundscaperProject({ id: 'repeat-source', now: NOW });
	const first = createCrossProductHandoffLaunchIntent({
		sourceProject: source, destinationFamily: 'framescaper',
		invocationId: 'invocation-a', destinationProjectId: 'copy-a',
	});
	const retry = parseCrossProductHandoffLaunchIntent(serializeCrossProductHandoffLaunchIntent(first));
	assert.equal(retry?.destination.projectId, 'copy-a');
	const later = createCrossProductHandoffLaunchIntent({
		sourceProject: source, destinationFamily: 'framescaper',
		invocationId: 'invocation-b', destinationProjectId: 'copy-b',
	});
	assert.notEqual(later.destination.projectId, first.destination.projectId);
});

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	assert.ok(Array.isArray(value));
	return value.map(record);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	return value as Readonly<Record<string, unknown>>;
}
