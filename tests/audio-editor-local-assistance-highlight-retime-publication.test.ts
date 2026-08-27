/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AssistanceWorkflowFenceV1 } from
	'../src/common/editor/assistance/workflow.ts';
import {
	resolveLocalAssistanceSelectedVideoAuthority,
} from '../src/common/editor/controller/local-assistance-selected-video.ts';
import {
	createLocalAssistanceSelectedVideoSourceTimeDescriptorV1,
	findLocalAssistanceSelectedVideoSourceTimeBySourceFrameV1,
} from '../src/common/editor/controller/local-assistance-selected-video-source-time.ts';
import {
	createLocalAssistanceGuidedHighlightDraftV1,
	setLocalAssistanceGuidedHighlightTrimV1,
} from '../src/common/editor/controller/local-assistance-guided-highlight-edits.ts';
import {
	snapLocalAssistanceGuidedHighlightTrimBoundaryV1,
} from '../src/common/editor/controller/local-assistance-guided-highlight-preview.ts';
import {
	createFramescaperAssistanceHighlightPublication,
} from '../src/framescaper/editor-local-assistance-highlight-publication.ts';
import {
	createFramescaperProjectHistoryV31,
	executeFramescaperProjectCommandV31,
	undoFramescaperProjectCommandV31,
} from '../src/framescaper/editor-project-v31-history.ts';
import type { FramescaperProjectCommandV31 } from
	'../src/framescaper/editor-project-v31-commands.ts';
import {
	createFramescaperProjectV31,
	type FramescaperProjectV31,
} from '../src/framescaper/editor-project-v31.ts';
import { FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE as PROFILE } from
	'../src/framescaper/editor-project-runtime-profile-v31.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const NOW = '2026-08-27T09:00:00.000Z';
const VIDEO_SHA256 = '12'.repeat(32);
const AUDIO_SHA256 = '34'.repeat(32);

test('highlight publication slices a monotonic forward retime into one undoable linked A/V sequence',
	async () => {
		const initial = retimedProject();
		const session = harness(initial);
		await session.publication.acceptReviewed(review(initial), ['highlight-retimed']);

		assert.equal(session.commits, 1);
		assert.equal(session.history.undoStack.length, 1);
		const sequence = records(session.history.present.sequences)
			.find(({ id }) => id !== 'main-sequence');
		assert.ok(sequence);
		const tracks = strings(sequence.trackIds).map((id) => records(session.history.present.tracks)
			.find((track) => track.id === id));
		const videoTrack = tracks.find((track) => track?.type === 'video');
		const audioTrack = tracks.find((track) => track?.type === 'audio');
		assert.ok(videoTrack);
		assert.ok(audioTrack);
		const video = records(session.history.present.clips).find(({ id }) => (
			strings(videoTrack.clipIds).includes(String(id))
		));
		const audio = records(session.history.present.clips).find(({ id }) => (
			strings(audioTrack.clipIds).includes(String(id))
		));
		assert.ok(video);
		assert.ok(audio);
		assert.deepEqual({ sequenceFrameCount: video.sequenceFrameCount,
			sourceInFrame: video.sourceInFrame, sourceFrameCount: video.sourceFrameCount,
		}, { sequenceFrameCount: 6, sourceInFrame: 1, sourceFrameCount: 5 });
		assert.deepEqual(video.retimeMap, {
			feature: 'video-retime', version: 2,
			points: [
				{ outerFrame: 0, sourceFrame: { num: 1, den: 1 } },
				{ outerFrame: 2, sourceFrame: { num: 2, den: 1 } },
				{ outerFrame: 6, sourceFrame: { num: 6, den: 1 } },
			],
			segments: [{ mode: 'constant-forward' }, { mode: 'constant-forward' }],
		});
		assert.deepEqual({ sourceStartFrame: audio.sourceStartFrame,
			sourceDurationFrames: audio.sourceDurationFrames, durationFrames: audio.durationFrames,
		}, { sourceStartFrame: 9_600, sourceDurationFrames: 28_800, durationFrames: 28_800 });
		assert.equal(video.avLinkId, audio.avLinkId);
		const left = (video.videoKeyframes as Readonly<{ curves: readonly Readonly<{
			target: Readonly<{ parameterId: string }>;
			curve: Readonly<{ anchors: readonly Readonly<{ position: unknown }>[] }>;
		}>[] }>).curves.find(({ target }) => target.parameterId === 'crop.left');
		assert.deepEqual(left?.curve.anchors.map(({ position }) => position), [
			{ num: 0, den: 1 }, { num: 5, den: 1 },
		]);

		session.history = undoFramescaperProjectCommandV31(PROFILE, session.history, { now: NOW });
		assert.deepEqual(session.history.present.sequences, initial.sequences);
		assert.deepEqual(session.history.present.tracks, initial.tracks);
		assert.deepEqual(session.history.present.clips, initial.clips);
	});

test('highlight publication rejects a changed forward-retime authority before committing', async () => {
	const initial = retimedProject();
	const session = harness(initial);
	session.current = retimedProject(3);
	await assert.rejects(
		session.publication.acceptReviewed(review(initial), ['highlight-retimed']),
		/stale|timing|authority|source/iu,
	);
	assert.equal(session.commits, 0);
	assert.deepEqual(session.history.present.sequences, initial.sequences);
});

test('highlight publication refuses a retimed proposal edge that is not the authenticated cut',
	async () => {
		const initial = retimedProject();
		const session = harness(initial);
		const held = review(initial);
		const proposal = held.proposals[0]!;
		const changed = { ...held, proposals: [{ ...proposal, sourceStartFrame: 2,
			cropKeyframes: [crop(2), crop(5)] }] };
		await assert.rejects(
			session.publication.acceptReviewed(changed, ['highlight-retimed']),
			/source-time authority|proposal edges|representable/iu,
		);
		assert.equal(session.commits, 0);
	});

test('edited ramp highlight trims expose and publish only exact round-trip boundaries', async () => {
	const initial = rampRetimedProject();
	const authority = createLocalAssistanceSelectedVideoSourceTimeDescriptorV1(selected(initial));
	assert.equal(findLocalAssistanceSelectedVideoSourceTimeBySourceFrameV1(authority, 50), null,
		'a nearest inverse must not be exposed as a publishable ramp boundary');

	const original = rampProposals();
	assert.equal(snapLocalAssistanceGuidedHighlightTrimBoundaryV1(
		authority, original.proposals[0]!, 'end', 297_600,
	), 288_000, 'the end control must snap inward past an unpublishable ramp boundary');
	const edited = setLocalAssistanceGuidedHighlightTrimV1(
		original, createLocalAssistanceGuidedHighlightDraftV1(original),
		'highlight-ramp', 96_000, 384_000, authority,
	);
	assert.deepEqual({ startFrame: edited.proposals[0]!.startFrame,
		endFrame: edited.proposals[0]!.endFrame,
		sourceStartFrame: edited.proposals[0]!.sourceStartFrame,
		sourceEndFrame: edited.proposals[0]!.sourceEndFrame }, {
		startFrame: 96_000, endFrame: 384_000, sourceStartFrame: 12, sourceEndFrame: 72,
	});

	const session = harness(initial);
	await session.publication.acceptReviewed({
		kind: 'highlight-proposals', schemaVersion: 1, workflowId: 'make-highlights',
		fence: fence(initial), proposals: edited.proposals,
	}, ['highlight-ramp']);
	assert.equal(session.commits, 1);
	const video = records(session.history.present.clips).find(({ id, kind }) => (
		kind === 'video' && id !== 'video-clip' && id !== 'bin-video'
	));
	assert.deepEqual({ sequenceFrameCount: video?.sequenceFrameCount,
		sourceInFrame: video?.sourceInFrame, sourceFrameCount: video?.sourceFrameCount }, {
		sequenceFrameCount: 60, sourceInFrame: 12, sourceFrameCount: 60,
	});
});

function retimedProject(middleSourceFrame = 2): FramescaperProjectV31 {
	const options = structuredClone(framescaperV20Options());
	options.id = 'retimed-highlight-project';
	options.title = 'Retimed highlight project';
	options.now = NOW;
	options.selection = { startFrame: 0, endFrame: 48_000,
		trackIds: ['video-track'], clipIds: ['video-clip'],
		frequencyRange: null, annotationIds: [] };
	options.sources = records(options.sources).map((source) => ({ ...source,
		contentSha256: source.id === 'video-source' ? VIDEO_SHA256 : AUDIO_SHA256,
	}));
	options.clips = records(options.clips).map((clip) => clip.id === 'video-clip' ? {
		...clip, avLinkId: 'source-av-link', sourceFrameCount: 8,
		retimeMap: {
			feature: 'video-retime', version: 2,
			points: [
				{ outerFrame: 0, sourceFrame: { num: 0, den: 1 } },
				{ outerFrame: 4, sourceFrame: { num: middleSourceFrame, den: 1 } },
				{ outerFrame: 10, sourceFrame: { num: 8, den: 1 } },
			],
			segments: [{ mode: 'constant-forward' }, { mode: 'constant-forward' }],
		},
	} : { ...clip, avLinkId: 'source-av-link' });
	options.tracks = records(options.tracks).map((track) => ({
		...track, laneGroupId: 'source-lane-group',
	}));
	return createFramescaperProjectV31(PROFILE, options as never);
}

function rampRetimedProject(): FramescaperProjectV31 {
	const options = structuredClone(framescaperV20Options());
	options.id = 'ramp-highlight-project';
	options.title = 'Ramp highlight project';
	options.now = NOW;
	options.selection = { startFrame: 0, endFrame: 480_000,
		trackIds: ['video-track', 'audio-track'], clipIds: ['video-clip', 'audio-clip'],
		frequencyRange: null, annotationIds: [] };
	options.sources = records(options.sources).map((source) => source.id === 'video-source' ? {
		...source, contentSha256: VIDEO_SHA256, frameCount: 480_000,
		sampleFrameCount: 480_000, sourceFrameCount: 100,
	} : { ...source, contentSha256: AUDIO_SHA256, frameCount: 480_000 });
	options.clips = records(options.clips).map((clip) => clip.id === 'video-clip' ? {
		...clip, avLinkId: 'source-av-link', sequenceFrameCount: 100, sourceFrameCount: 100,
		retimeMap: {
			feature: 'video-retime', version: 2,
			points: [
				{ outerFrame: 0, sourceFrame: { num: 0, den: 1 } },
				{ outerFrame: 100, sourceFrame: { num: 100, den: 1 } },
			],
			segments: [{ mode: 'ramp-forward', startVelocity: { num: 1, den: 2 },
				endVelocity: { num: 3, den: 2 } }],
		},
	} : { ...clip, avLinkId: 'source-av-link', sourceDurationFrames: 480_000,
		durationFrames: 480_000 });
	options.tracks = records(options.tracks).map((track) => ({
		...track, laneGroupId: 'source-lane-group',
	}));
	return createFramescaperProjectV31(PROFILE, options as never);
}

function rampProposals() {
	return {
		schemaVersion: 1 as const, kind: 'highlight-proposals' as const,
		workflowId: 'make-highlights' as const,
		targetAspect: { width: 9 as const, height: 16 as const },
		proposals: [{ id: 'highlight-ramp', startFrame: 0, endFrame: 480_000,
			sourceStartFrame: 0, sourceEndFrame: 100, score: 0.8,
			evidenceMode: 'speechless' as const, transcriptExcerpt: null,
			visualSummary: 'Authenticated ramp-retime signals.', selected: false as const,
			videoOccurrenceId: 'video-clip', audioOccurrenceId: 'audio-clip',
			title: 'Ramp highlight', hook: null, chapters: [], explanation: null,
			cropKeyframes: [rampCrop(0), rampCrop(99)],
		}],
	};
}

function rampCrop(sourceFrame: number) {
	return { sourceFrame, authority: 'center' as const, trackIds: [],
		crop: { left: 0.341796875, top: 0, right: 0.341796875, bottom: 0 } };
}

function selected(project: FramescaperProjectV31) {
	return resolveLocalAssistanceSelectedVideoAuthority({
		getProject: () => project,
		getSelectedClipId: () => 'video-clip',
	});
}

function fence(project: FramescaperProjectV31): AssistanceWorkflowFenceV1 {
	const authority = selected(project);
	const held = authority.fence;
	const videoSource = records(project.sources).find(({ id }) => id === 'video-source')!;
	const audioSource = records(project.sources).find(({ id }) => id === 'audio-source')!;
	const audioClip = records(project.clips).find(({ id }) => id === 'audio-clip')!;
	const audioStart = Number(audioClip.sourceStartFrame);
	const audioEnd = audioStart + Number(audioClip.sourceDurationFrames);
	return {
		fenceVersion: 1, projectId: String(project.id), schemaVersion: Number(project.schemaVersion),
		revision: Number(project.revision), sequenceId: 'main-sequence',
		sourceRanges: [{
			slotId: 'primary-audio', mediaKind: 'audio', sourceId: 'audio-source',
			sourceSha256: String(audioSource.contentSha256), sourceSampleRate: 48_000,
			occurrenceIds: ['audio-clip'], sourceStartFrame: audioStart, sourceEndFrame: audioEnd,
			linkMembershipSha256: held.linkMembershipSha256,
			timingAuthoritySha256: '56'.repeat(32), retimeKind: 'identity',
		}, {
			slotId: 'primary-video', mediaKind: 'video', sourceId: 'video-source',
			sourceSha256: String(videoSource.contentSha256), sourceSampleRate: null,
			occurrenceIds: ['video-clip'], sourceStartFrame: authority.sourceStartFrame,
			sourceEndFrame: authority.sourceEndFrame,
			linkMembershipSha256: held.linkMembershipSha256,
			timingAuthoritySha256: held.timingAuthoritySha256, retimeKind: 'monotonic-forward',
		}],
		transcriptBodySha256: null, recipeSha256: '78'.repeat(32),
		settingsSha256: '9a'.repeat(32), modelBindingsSha256: 'bc'.repeat(32),
	};
}

function review(project: FramescaperProjectV31) {
	return {
		kind: 'highlight-proposals', schemaVersion: 1, workflowId: 'make-highlights',
		fence: fence(project), proposals: [{
			id: 'highlight-retimed', startFrame: 9_600, endFrame: 38_400,
			sourceStartFrame: 1, sourceEndFrame: 6, score: 0.8,
			evidenceMode: 'speechless', transcriptExcerpt: null,
			visualSummary: 'Authenticated forward-retime signals.', selected: false,
			videoOccurrenceId: 'video-clip', audioOccurrenceId: 'audio-clip',
			title: 'Retimed highlight', hook: null, chapters: [], explanation: null,
			cropKeyframes: [crop(1), crop(5)],
		}],
	};
}

function crop(sourceFrame: number) {
	return { sourceFrame, authority: 'center', trackIds: [],
		crop: { left: 0.25, top: 0, right: 0.25, bottom: 0 } };
}

function harness(initial: FramescaperProjectV31) {
	let history = createFramescaperProjectHistoryV31(PROFILE, initial);
	let current = initial;
	let commits = 0;
	const expectedFence = fence(initial);
	const publication = createFramescaperAssistanceHighlightPublication({
		currentAuthority: () => ({ selection: selected(current), fence: expectedFence }),
		captureProject: () => history.present,
		assertProject: (token) => assert.strictEqual(token, history.present),
		createId: incrementalIds(),
		commit: (command) => {
			commits += 1;
			history = executeFramescaperProjectCommandV31(
				PROFILE, history, command as FramescaperProjectCommandV31, { now: NOW },
			);
		},
	});
	return { publication,
		get history() { return history; }, set history(value) { history = value; },
		get current() { return current; }, set current(value) { current = value; },
		get commits() { return commits; },
	};
}

function incrementalIds(): (prefix: string) => string {
	let next = 0;
	return (prefix) => `${prefix}-${String(next += 1)}`;
}

function records(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.map((entry) => entry as Record<string, unknown>) : [];
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.map(String) : [];
}
