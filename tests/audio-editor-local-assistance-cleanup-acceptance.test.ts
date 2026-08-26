/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createLocalAssistanceTranscriptCleanupSession,
	type LocalAssistanceTranscriptCleanupRequest,
} from '../src/common/editor/controller/local-assistance-cleanup-acceptance.ts';
import type { LocalAssistanceTranscriptCleanupPreset } from
	'../src/common/editor/ui/local-assistance-cleanup.ts';
import {
	resolveLocalAssistanceSelectedMediaAuthority,
} from '../src/common/editor/controller/local-assistance-selected-media.ts';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';
import {
	createCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import type { AssistanceSelectionFence } from '../src/common/editor/assistance/proposal-session.ts';

const NOW = '2026-08-26T12:00:00.000Z';
const SAMPLE_RATE = 48_000;
const DURATION_FRAMES = 2 * SAMPLE_RATE;
const SOURCE_SHA256 = 'ab'.repeat(32);
const MODEL_SHA256 = '12'.repeat(32);
const VAD_MODEL_SHA256 = '34'.repeat(32);
const RATE = Object.freeze({ num: 30, den: 1 });

const REVIEW = Object.freeze({
	kind: 'transcript' as const,
	language: 'en',
	segments: Object.freeze([Object.freeze({
		startSeconds: 0,
		endSeconds: 2,
		text: 'hello um there uh now',
		words: Object.freeze([
			Object.freeze({ text: 'hello', startSeconds: 0, endSeconds: 0.4, confidence: 0.99 }),
			Object.freeze({ text: 'um', startSeconds: 0.4, endSeconds: 0.6, confidence: 0.98 }),
			Object.freeze({ text: 'there', startSeconds: 0.6, endSeconds: 1.2, confidence: 0.97 }),
			Object.freeze({ text: 'uh', startSeconds: 1.2, endSeconds: 1.4, confidence: 0.96 }),
			Object.freeze({ text: 'now', startSeconds: 1.4, endSeconds: 2, confidence: 0.95 }),
		]),
		speaker: null,
	})]),
});

function cleanupProject(linked: boolean) {
	const audioSource = createAudioSource({
		id: 'audio-source', name: 'Dialogue', storageKey: 'audio-source',
		contentSha256: SOURCE_SHA256, frameCount: DURATION_FRAMES,
		channelCount: 1, sampleRate: SAMPLE_RATE,
	});
	const audioClip = createAudioClip({
		id: 'audio-clip', sourceId: audioSource.id, title: 'Dialogue',
		timelineStartFrame: 0, durationFrames: DURATION_FRAMES,
		sourceStartFrame: 0, sourceDurationFrames: DURATION_FRAMES,
		...(linked ? { avLinkId: 'camera-link' } : {}),
	});
	const sources: Record<string, unknown>[] = [audioSource];
	const clips: Record<string, unknown>[] = [audioClip];
	const tracks: Record<string, unknown>[] = [createAudioTrack({
		id: 'audio-track', name: 'Dialogue', clipIds: [audioClip.id],
		...(linked ? { laneGroupId: 'camera-lanes' } : {}),
	})];
	const trackIds = ['audio-track'];
	if (linked) {
		const videoSource = createVideoSource({
			id: 'video-source', name: 'Camera', storageKey: 'video-source',
			mimeType: 'video/mp4', sampleFrameCount: DURATION_FRAMES, sourceFrameCount: 60,
			frameRate: RATE, width: 1_920, height: 1_080, videoCodec: 'h264',
		});
		const videoClip = createVideoClip({
			id: 'video-clip', sourceId: videoSource.id, sequenceId: 'main-sequence',
			sequenceStartFrame: 0, sequenceFrameCount: 60,
			sourceInFrame: 0, sourceFrameCount: 60, avLinkId: 'camera-link',
		}, {
			projectSampleRate: SAMPLE_RATE,
			sequence: { id: 'main-sequence', rate: RATE },
			source: videoSource,
		});
		sources.unshift(videoSource);
		clips.unshift(videoClip);
		tracks.unshift(createVideoTrack({
			id: 'video-track', name: 'Camera', clipIds: [videoClip.id], laneGroupId: 'camera-lanes',
		}));
		trackIds.unshift('video-track');
	}
	return createCurrentAudioEditorProject({
		id: linked ? 'linked-cleanup-project' : 'cleanup-project', title: 'Cleanup', now: NOW,
		sampleRate: SAMPLE_RATE, sources, clips, tracks,
		sequences: [{ id: 'main-sequence', rate: RATE, trackIds }],
		primarySequenceId: 'main-sequence',
		selection: {
			startFrame: 0, endFrame: DURATION_FRAMES,
			clipIds: ['audio-clip'], trackIds: ['audio-track'],
		},
	});
}

class CleanupFixture {
	history: ReturnType<typeof createEditorHistory> & { present: AudioEditorProjectCurrent };
	commitCount = 0;
	committed: AudioEditorCommand[] = [];
	fenceOverride: ((fence: AssistanceSelectionFence) => AssistanceSelectionFence) | null = null;

	constructor(linked = false) {
		this.history = createEditorHistory(cleanupProject(linked)) as ReturnType<
			typeof createEditorHistory
		> & { present: AudioEditorProjectCurrent };
	}

	currentAuthority() {
		const authority = resolveLocalAssistanceSelectedMediaAuthority({
			getProject: () => projectForCommand(
				this.history.present as unknown as Record<string, unknown>,
			),
			getSelectedClipId: () => 'audio-clip',
			captureProject: () => this.history.present,
			assertProject: (token) => { assert.equal(token, this.history.present); },
			renderDryTrackRange: async () => [new Float32Array(DURATION_FRAMES)],
		});
		return this.fenceOverride
			? Object.freeze({ ...authority, fence: this.fenceOverride(authority.fence) })
			: authority;
	}

	createSession(overrides: Partial<Pick<LocalAssistanceTranscriptCleanupRequest,
		'models' | 'options' | 'voiceActivity' | 'review' | 'preset'>> = {}) {
		const authority = this.currentAuthority();
		return createLocalAssistanceTranscriptCleanupSession({
			currentAuthority: () => this.currentAuthority(),
			captureProject: () => this.history.present,
			assertProject: (token) => { assert.equal(token, this.history.present); },
			commit: (command) => {
				this.commitCount += 1;
				this.committed.push(command as AudioEditorCommand);
				this.history = executeEditorCommand(this.history, command, { now: NOW }) as typeof this.history;
			},
		}, {
			selectionFence: authority.fence,
			review: overrides.review ?? REVIEW,
			models: overrides.models ?? Object.freeze([Object.freeze({
				modelId: 'parakeet-tdt-0.6b-v2',
				version: '1',
				task: 'speech-recognition',
				artifactSha256s: Object.freeze([MODEL_SHA256]),
			})]),
			options: overrides.options ?? { fillerLexicon: ['um', 'uh'] },
			preset: overrides.preset ?? 'balanced',
			voiceActivity: overrides.voiceActivity ?? null,
		});
	}
}

function reviewedVad(fence: AssistanceSelectionFence) {
	return Object.freeze({
		selectionFence: fence,
		models: Object.freeze([Object.freeze({
			modelId: 'silero-vad-v6', version: '6.2.1', task: 'voice-activity-detection',
			artifactSha256s: Object.freeze([VAD_MODEL_SHA256]),
		})]),
		review: Object.freeze({
			kind: 'voice-activity' as const,
			sampleRate: 16_000,
			segments: Object.freeze([
				Object.freeze({ startSample: 0, sampleCount: 8_000 }),
				Object.freeze({ startSample: 24_000, sampleCount: 8_000 }),
			]),
		}),
	});
}

function runtimeClips(project: AudioEditorProjectCurrent) {
	return resolveRuntimeProjectProjection(project as never).clips;
}

function programmeEnd(project: AudioEditorProjectCurrent, kind: 'audio' | 'video' = 'audio'): number {
	return Math.max(...runtimeClips(project)
		.filter((clip) => clip.kind === kind)
		.map((clip) => clip.timelineEndFrame));
}

test('reviewed transcript timing becomes deterministic subset-selectable cleanup proposals', async () => {
	const fixture = new CleanupFixture();
	const session = fixture.createSession();
	const proposals = session.snapshot().proposals;

	assert.deepEqual(proposals.map(({ id, kind, startFrame, endFrame, text }) => ({
		id, kind, startFrame, endFrame, text,
	})), [
		{ id: 'filler-19200-28800', kind: 'filler', startFrame: 19_200, endFrame: 28_800, text: 'um' },
		{ id: 'filler-57600-67200', kind: 'filler', startFrame: 57_600, endFrame: 67_200, text: 'uh' },
	]);

	await session.accept([proposals[1]!.id]);

	assert.equal(fixture.commitCount, 1);
	assert.equal(fixture.history.undoStack.length, 1);
	assert.equal(programmeEnd(fixture.history.present), DURATION_FRAMES - 9_600);
	const command = fixture.committed[0];
	assert.equal(command?.type, 'range/ripple-delete');
	if (command?.type !== 'range/ripple-delete') throw new TypeError('Expected one ripple command.');
	assert.deepEqual(command.trackIds, ['audio-track']);
	assert.deepEqual(command.clipIds, ['audio-clip']);
	assert.equal(command.startFrame, 57_600);
	assert.equal(command.endFrame, 67_200);
	assert.match(command.splitClipIds?.['audio-clip'] ?? '', /^clip-/u);
});

/**
 * A recognition model can predict an integer frame duration of zero. Such a
 * proposal has no timeline extent and cannot be applied, but refusing the whole
 * session for one would take away every well-formed proposal in the transcript
 * and make Clean-up unusable for that recording.
 */
test('a zero-duration reviewed word is skipped, not fatal to the whole session', () => {
	const fixture = new CleanupFixture();
	const review = Object.freeze({
		...REVIEW,
		segments: Object.freeze([Object.freeze({
			...REVIEW.segments[0]!,
			words: Object.freeze([
				...REVIEW.segments[0]!.words.slice(0, 4),
				// A filler the model gave no duration at all, in order between the
				// words that surround it.
				Object.freeze({ text: 'um', startSeconds: 1.4, endSeconds: 1.4, confidence: 0.9 }),
				...REVIEW.segments[0]!.words.slice(4),
			]),
		})]),
	});
	const session = fixture.createSession({ review });

	assert.deepEqual(
		session.snapshot().proposals.map(({ id }) => id),
		['filler-19200-28800', 'filler-57600-67200'],
		'the well-formed proposals survive the degenerate one',
	);
});

test('only same-fence reviewed VAD can add silence cleanup proposals', () => {
	const fixture = new CleanupFixture();
	const authority = fixture.currentAuthority();
	const session = fixture.createSession({ voiceActivity: reviewedVad(authority.fence) });
	assert.deepEqual(session.snapshot().proposals.filter(({ kind }) => kind === 'silence'), [{
		id: 'vad-silence-26400-69600', kind: 'silence',
		startFrame: 26_400, endFrame: 69_600, text: '',
	}]);

	assert.throws(() => fixture.createSession({
		options: { fillerLexicon: ['um'], minSilenceFrames: 8_000 },
	}), /word gaps cannot authorize silence/iu);
	assert.throws(() => fixture.createSession({
		voiceActivity: reviewedVad(Object.freeze({
			...authority.fence, timingAuthoritySha256: '56'.repeat(32),
		})),
	}), /no longer matches/iu);
});

test('cleanup presets use exact reviewed-VAD thresholds and padding', () => {
	const fixture = new CleanupFixture();
	const voiceActivity = reviewedVad(fixture.currentAuthority().fence);
	const silences = (preset: LocalAssistanceTranscriptCleanupPreset) => fixture.createSession({
		preset, voiceActivity,
	}).snapshot().proposals.filter(({ kind }) => kind === 'silence');

	assert.deepEqual(silences('conservative'), []);
	assert.deepEqual(silences('balanced'), [{
		id: 'vad-silence-26400-69600', kind: 'silence',
		startFrame: 26_400, endFrame: 69_600, text: '',
	}]);
	assert.deepEqual(silences('aggressive'), [{
		id: 'vad-silence-25440-70560', kind: 'silence',
		startFrame: 25_440, endFrame: 70_560, text: '',
	}]);
});

test('cleanup refuses non-Parakeet speech model authority', () => {
	const fixture = new CleanupFixture();
	assert.throws(() => fixture.createSession({ models: Object.freeze([Object.freeze({
		modelId: 'generic-speech-model', version: '1', task: 'speech-recognition',
		artifactSha256s: Object.freeze([MODEL_SHA256]),
	})]) }), /Parakeet/iu);
});

test('all accepted disjoint edits commit as one history revision and undo and redo together', async () => {
	const fixture = new CleanupFixture();
	const before = structuredClone(fixture.history.present);
	const beforeRevision = fixture.history.present.revision;
	const session = fixture.createSession();

	await session.accept(session.snapshot().proposals.map(({ id }) => id));

	assert.equal(fixture.commitCount, 1);
	assert.equal(fixture.committed[0]?.type, 'batch');
	assert.equal(fixture.history.present.revision, beforeRevision + 1);
	assert.equal(fixture.history.undoStack.length, 1);
	assert.equal(programmeEnd(fixture.history.present), DURATION_FRAMES - 19_200);
	const edited = structuredClone(fixture.history.present);

	fixture.history = undoEditorCommand(fixture.history, { now: NOW }) as typeof fixture.history;
	assert.equal(programmeEnd(fixture.history.present), DURATION_FRAMES);
	assert.deepEqual(
		runtimeClips(fixture.history.present),
		runtimeClips(before),
	);
	fixture.history = redoEditorCommand(fixture.history, { now: NOW }) as typeof fixture.history;
	assert.equal(programmeEnd(fixture.history.present), DURATION_FRAMES - 19_200);
	assert.deepEqual(
		runtimeClips(fixture.history.present),
		runtimeClips(edited),
	);
});

test('track ripple expands accepted cleanup ranges across linked audio and video', async () => {
	const fixture = new CleanupFixture(true);
	const session = fixture.createSession();

	await session.accept([session.snapshot().proposals[0]!.id]);

	assert.equal(fixture.commitCount, 1);
	assert.equal(programmeEnd(fixture.history.present, 'audio'), DURATION_FRAMES - 9_600);
	assert.equal(programmeEnd(fixture.history.present, 'video'), DURATION_FRAMES - 9_600);
	const command = fixture.committed[0];
	assert.equal(command?.type, 'range/ripple-delete');
	if (command?.type !== 'range/ripple-delete') throw new TypeError('Expected one ripple command.');
	assert.deepEqual(command.trackIds, ['video-track', 'audio-track']);
	assert.deepEqual(command.clipIds, ['video-clip', 'audio-clip']);
});

test('a changed full selection fence refuses cleanup before command preparation or commit', async () => {
	const fixture = new CleanupFixture(true);
	const session = fixture.createSession();
	fixture.fenceOverride = (value) => Object.freeze({
		...value,
		linkMembershipSha256: 'cd'.repeat(32),
	});

	await assert.rejects(
		session.accept([session.snapshot().proposals[0]!.id]),
		/no longer matches/iu,
	);
	assert.equal(session.snapshot().phase, 'failed');
	assert.equal(fixture.commitCount, 0);
	assert.equal(fixture.history.undoStack.length, 0);
	assert.equal(programmeEnd(fixture.history.present), DURATION_FRAMES);
});

test('reject, cancel, and accepting an empty subset make no project mutation', async () => {
	for (const decision of ['reject', 'cancel', 'empty'] as const) {
		const fixture = new CleanupFixture();
		const session = fixture.createSession();
		if (decision === 'reject') await session.reject();
		else if (decision === 'cancel') await session.cancel();
		else await session.accept([]);

		assert.equal(fixture.commitCount, 0, decision);
		assert.equal(fixture.history.undoStack.length, 0, decision);
		assert.equal(programmeEnd(fixture.history.present), DURATION_FRAMES, decision);
		assert.equal(session.snapshot().phase,
			decision === 'empty' ? 'accepted' : decision === 'cancel' ? 'cancelled' : 'rejected');
	}
});
