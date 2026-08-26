/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AssistanceWorkflowFenceV1 } from '../src/common/editor/assistance/workflow.ts';
import {
	createFramescaperAssistanceHighlightPublication,
} from '../src/framescaper/editor-local-assistance-highlight-publication.ts';
import {
	reviewFramescaperAssistanceHighlightsV1,
} from '../src/framescaper/editor-local-assistance-highlight-review.ts';
import type { FramescaperProjectCommandV31 } from '../src/framescaper/editor-project-v31-commands.ts';
import {
	createFramescaperProjectHistoryV31,
	executeFramescaperProjectCommandV31,
	type FramescaperProjectHistoryV31,
	undoFramescaperProjectCommandV31,
} from '../src/framescaper/editor-project-v31-history.ts';
import {
	createFramescaperProjectV31,
	type FramescaperProjectV31,
} from '../src/framescaper/editor-project-v31.ts';
import {
	FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v31.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE;
const NOW = '2026-08-26T13:00:00.000Z';
const VIDEO_SHA256 = '12'.repeat(32);
const AUDIO_SHA256 = '34'.repeat(32);

function project(): FramescaperProjectV31 {
	const options = structuredClone(framescaperV20Options());
	options.id = 'highlight-project';
	options.title = 'Highlight project';
	options.now = NOW;
	options.sources = records(options.sources).map((source) => ({
		...source,
		contentSha256: source.id === 'video-source' ? VIDEO_SHA256 : AUDIO_SHA256,
	}));
	options.clips = records(options.clips).map((clip) => ({
		...clip, avLinkId: 'original-av-link',
	}));
	options.tracks = records(options.tracks).map((track) => ({
		...track, laneGroupId: 'original-lane-group',
	}));
	return createFramescaperProjectV31(PROFILE, options as never);
}

function fence(value: FramescaperProjectV31): AssistanceWorkflowFenceV1 {
	return {
		fenceVersion: 1,
		projectId: String(value.id),
		schemaVersion: Number(value.schemaVersion),
		revision: Number(value.revision),
		sequenceId: 'main-sequence',
		sourceRanges: [{
			slotId: 'audio-main', mediaKind: 'audio', sourceId: 'audio-source',
			sourceSha256: AUDIO_SHA256, sourceSampleRate: 48_000, occurrenceIds: ['audio-clip'],
			sourceStartFrame: 0, sourceEndFrame: 48_000,
			linkMembershipSha256: '56'.repeat(32), timingAuthoritySha256: '78'.repeat(32),
			retimeKind: 'identity',
		}, {
			slotId: 'video-main', mediaKind: 'video', sourceId: 'video-source',
			sourceSha256: VIDEO_SHA256, sourceSampleRate: null, occurrenceIds: ['video-clip'],
			sourceStartFrame: 0, sourceEndFrame: 10,
			linkMembershipSha256: '56'.repeat(32), timingAuthoritySha256: '9a'.repeat(32),
			retimeKind: 'identity',
		}],
		transcriptBodySha256: null,
		recipeSha256: 'bc'.repeat(32),
		settingsSha256: 'de'.repeat(32),
		modelBindingsSha256: 'f0'.repeat(32),
	};
}

function review(value: FramescaperProjectV31, includeSecond = false) {
	return reviewFramescaperAssistanceHighlightsV1({
		kind: 'highlight-proposals', schemaVersion: 1, workflowId: 'make-highlights',
		fence: fence(value),
		proposals: [proposal({
			id: 'highlight-a', title: 'First highlight', startFrame: 0, endFrame: 19_200,
			firstSourceFrame: 0, lastSourceFrame: 3,
		}), ...includeSecond ? [proposal({
			id: 'highlight-b', title: 'Second highlight', startFrame: 28_800, endFrame: 48_000,
			firstSourceFrame: 6, lastSourceFrame: 9,
		})] : []],
	});
}

function proposal(options: Readonly<{
	id: string;
	title: string;
	startFrame: number;
	endFrame: number;
	firstSourceFrame: number;
	lastSourceFrame: number;
}>) {
	return {
		id: options.id,
		startFrame: options.startFrame,
		endFrame: options.endFrame,
		score: 0.875,
		evidenceMode: 'transcript',
		selected: false,
		videoOccurrenceId: 'video-clip',
		audioOccurrenceId: 'audio-clip',
		title: options.title,
		cropKeyframes: [cropKeyframe(options.firstSourceFrame, {
			left: 0.25, top: 0, right: 0.25, bottom: 0,
		}), cropKeyframe(options.lastSourceFrame, {
			left: 0.3, top: 0, right: 0.2, bottom: 0,
		})],
	};
}

function cropKeyframe(
	sourceFrame: number,
	crop: Readonly<{ left: number; top: number; right: number; bottom: number }>,
) {
	return { sourceFrame, authority: 'center', trackIds: [], crop };
}

function harness(initial = project(), createId: (prefix: string) => string = incrementalIds()) {
	let history = createFramescaperProjectHistoryV31(PROFILE, initial);
	let currentFence = fence(initial);
	let commits = 0;
	let authorityReads = 0;
	const publication = createFramescaperAssistanceHighlightPublication({
		currentAuthority: () => {
			authorityReads += 1;
			return { project: history.present, fence: currentFence };
		},
		captureProject: () => history.present,
		assertProject: (token) => assert.strictEqual(token, history.present),
		createId,
		commit: (command) => {
			commits += 1;
			history = executeFramescaperProjectCommandV31(
				PROFILE, history, command as FramescaperProjectCommandV31, { now: NOW },
			);
		},
	});
	return {
		publication,
		get history(): FramescaperProjectHistoryV31 { return history; },
		set history(value: FramescaperProjectHistoryV31) { history = value; },
		get commits(): number { return commits; },
		get authorityReads(): number { return authorityReads; },
		set currentFence(value: AssistanceWorkflowFenceV1) { currentFence = value; },
	};
}

test('review leaves every proposal unselected and rejection/no-selection changes nothing', async () => {
	const initial = project();
	const held = review(initial);
	assert.deepEqual(held.proposals.map(({ selected }) => selected), [false]);
	assert.equal(Object.isFrozen(held), true);
	assert.equal(Object.isFrozen(held.proposals[0]?.cropKeyframes), true);

	const session = harness(initial);
	await session.publication.acceptReviewed(held);
	assert.equal(session.commits, 0);
	assert.equal(session.authorityReads, 0,
		'an empty explicit selection cannot even capture mutable project authority');
	assert.deepEqual(session.history.present.sequences, initial.sequences);

	assert.throws(() => reviewFramescaperAssistanceHighlightsV1({
		...held,
		proposals: [{ ...held.proposals[0], selected: true }],
	}), /unselected|selected/iu);
	await assert.rejects(session.publication.acceptReviewed(held, ['unknown-highlight']),
		/unknown.*highlight/iu);
	assert.equal(session.commits, 0);
});

test('acceptance revalidates the complete aggregate fence before one command commit', async () => {
	const initial = project();
	const held = review(initial);
	const session = harness(initial);
	session.currentFence = { ...fence(initial), settingsSha256: '11'.repeat(32) };

	await assert.rejects(session.publication.acceptReviewed(held, ['highlight-a']),
		/stale|authority|fence/iu);
	assert.equal(session.commits, 0);
	assert.deepEqual(session.history.present.sequences, initial.sequences);
});

test('one atomic F31 batch creates an editable linked A/V secondary sequence and undoes it', async () => {
	const initial = project();
	const session = harness(initial);
	await session.publication.acceptReviewed(review(initial), ['highlight-a']);

	assert.equal(session.commits, 1);
	assert.equal(session.history.undoStack.length, 1);
	const presentSequences = records(session.history.present.sequences);
	assert.equal(presentSequences.length, records(initial.sequences).length + 1);
	const secondary = presentSequences.find(({ id }) => id !== 'main-sequence');
	assert.ok(secondary);
	assert.equal(secondary.name, 'First highlight');
	const secondaryTrackIds = strings(secondary.trackIds);
	assert.equal(secondaryTrackIds.length, 3);
	const presentTracks = records(session.history.present.tracks);
	const tracks = secondaryTrackIds.map((trackId) => presentTracks.find(
		({ id }) => id === trackId,
	));
	assert.deepEqual(tracks.map((track) => track?.type), ['video', 'audio', 'label']);
	assert.equal(tracks[0]?.laneGroupId, tracks[1]?.laneGroupId);

	const videoId = strings(tracks[0]?.clipIds)[0];
	const audioId = strings(tracks[1]?.clipIds)[0];
	const presentClips = records(session.history.present.clips);
	const video = presentClips.find(({ id }) => id === videoId);
	const audio = presentClips.find(({ id }) => id === audioId);
	assert.ok(video);
	assert.ok(audio);
	assert.equal(video.sourceId, 'video-source');
	assert.equal(video.sourceInFrame, 0);
	assert.equal(video.sourceFrameCount, 4);
	assert.equal(video.sequenceStartFrame, 0);
	assert.equal(video.sequenceFrameCount, 4);
	assert.equal(audio.sourceId, 'audio-source');
	assert.equal(audio.sourceStartFrame, 0);
	assert.equal(audio.sourceDurationFrames, 19_200);
	assert.equal(audio.timelineStartFrame, 0);
	assert.equal(audio.durationFrames, 19_200);
	assert.equal(video.avLinkId, audio.avLinkId);
	assert.notEqual(video.avLinkId, 'original-av-link');

	const labelTrack = tracks[2] as Readonly<Record<string, unknown>>;
	const labels = records(labelTrack.labels);
	assert.deepEqual(labels.map(({ title, startFrame, endFrame }) => ({
		title, startFrame, endFrame,
	})), [{ title: 'First highlight', startFrame: 0, endFrame: 19_200 }]);
	const extensions = labelTrack.opaqueExtensions as Readonly<
		Record<string, Readonly<Record<string, unknown>>>>;
	assert.equal(extensions['org.soundscaper.assistance-highlights-v1']?.proposalId, 'highlight-a');

	const keyframes = video.videoKeyframes as Readonly<{
		curves: readonly Readonly<{
			target: Readonly<{ parameterId: string }>;
			curve: Readonly<{ anchors: readonly Readonly<{ value: number }>[] }>;
		}>[];
	}>;
	assert.deepEqual(keyframes.curves.map(({ target }) => target.parameterId), [
		'crop.bottom', 'crop.left', 'crop.right', 'crop.top',
	]);
	assert.deepEqual(keyframes.curves.find(
		({ target }) => target.parameterId === 'crop.left',
	)?.curve.anchors.map(({ value }) => value), [0.25, 0.3]);
	assert.deepEqual(session.history.present.sources, initial.sources,
		'highlight sequences retain source custody instead of generating media');

	session.history = undoFramescaperProjectCommandV31(PROFILE, session.history, { now: NOW });
	assert.deepEqual(session.history.present.sequences, initial.sequences);
	assert.deepEqual(session.history.present.tracks, initial.tracks);
	assert.deepEqual(session.history.present.clips, initial.clips);
	assert.deepEqual(session.history.present.sources, initial.sources);
});

test('planning every selected proposal is all-or-nothing before commit', async () => {
	const initial = project();
	const session = harness(initial, (prefix) => prefix);
	await assert.rejects(
		session.publication.acceptReviewed(review(initial, true), ['highlight-a', 'highlight-b']),
		/duplicate|identity|unique/iu,
	);
	assert.equal(session.commits, 0);
	assert.equal(session.history.undoStack.length, 0);
	assert.deepEqual(session.history.present.sequences, initial.sequences);
	assert.deepEqual(session.history.present.clips, initial.clips);
});

function incrementalIds(): (prefix: string) => string {
	let next = 0;
	return (prefix) => `${prefix}-${String(next += 1)}`;
}

function records(value: unknown): Record<string, unknown>[];
function records(value: unknown[] | readonly unknown[]): Record<string, unknown>[];
function records(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => entry as Record<string, unknown>);
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.map(String) : [];
}
