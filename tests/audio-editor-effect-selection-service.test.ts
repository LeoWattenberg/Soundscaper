/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEffectSelectionService,
	type EffectSelectionProject,
	type EffectSelectionState,
} from '../src/common/editor/controller/effect-selection-service.ts';

function createHarness(options: Readonly<{ genericRangeErrors?: boolean }> = {}) {
	let project: EffectSelectionProject = {
		id: 'project-a',
		schemaVersion: 5,
		sampleRate: 48_000,
		title: 'Project',
		tracks: [
			{ id: 'track-a', name: 'A', type: 'audio', clipIds: ['clip-a'], spectrogram: { windowSize: 4_096 } },
			{ id: 'track-b', name: 'B', type: 'audio', clipIds: [] },
		],
		clips: [{
			id: 'clip-a', kind: 'audio', sourceId: 'source-a', title: 'Clip',
			timelineStartFrame: 100, sourceStartFrame: 0, sourceDurationFrames: 200, durationFrames: 200,
		}],
		selection: null,
		master: { effects: [] },
		mixer: { groups: [], sends: [], routes: {} },
	};
	const state: EffectSelectionState = {
		selectedTrackId: 'track-a',
		selectedClipId: 'clip-a',
		audacityEffectType: 'compressor',
	};
	let blocked = false;
	const commits: unknown[] = [];
	const service = createEffectSelectionService({
		state,
		copy: {
			audioTrackRequired: 'Select audio',
			maximumFrequency: 'Maximum frequency',
			...(options.genericRangeErrors ? {} : { maximumFrequencyInvalid: 'Maximum invalid' }),
			minimumFrequency: 'Minimum frequency',
			...(options.genericRangeErrors ? {} : { minimumFrequencyInvalid: 'Minimum invalid' }),
			parameterRangeError: '{label}: {minimum} to {maximum}',
			spectralEffectLengthChanging: 'Cannot stretch a spectral box',
			timeSelectionRequired: 'Select time',
			v2Required: 'Version 2 required',
		},
		getProject: () => project,
		activeSelection: () => project.selection ?? null,
		resolveEditingSelection: (_value, options) => options.selectedClipId
			? { kind: 'clips', clipIds: [options.selectedClipId] }
			: null,
		audacitySelectionChannelCount: (_value, trackId) => trackId === 'track-a' ? 2 : 0,
		audioTrackChannelCount: (_value, _track, fallback) => fallback,
		selectedTracksTimeRange: () => ({ startFrame: 10, endFrame: 20 }),
		projectSampleRate: () => project.sampleRate,
		editingBlocked: () => blocked,
		setSelection: (startFrame, endFrame, details) => {
			const selection = { startFrame, endFrame, ...details };
			commits.push(selection);
			project = { ...project, selection };
			return { selection };
		},
	});
	return {
		commits,
		service,
		state,
		setBlocked(value: boolean) { blocked = value; },
		setProject(next: EffectSelectionProject) { project = next; },
	};
}

test('clip selection resolves one exact target without widening its range', () => {
	const { service } = createHarness();
	assert.deepEqual(service.audacityEffectTarget(), {
		track: {
			id: 'track-a', name: 'A', type: 'audio', clipIds: ['clip-a'], spectrogram: { windowSize: 4_096 },
		},
		clipId: 'clip-a',
		clipIds: ['clip-a'],
		startFrame: 100,
		endFrame: 300,
		durationFrames: 200,
		channelCount: 2,
		hasAudio: true,
	});
});

test('clip-derived targets and selection details work without an explicit track or range', () => {
	const { service } = createHarness();
	const target = service.audacityEffectTarget(null);
	assert.ok(target);
	assert.equal(target.track.id, 'track-a');
	assert.deepEqual(service.audacityEffectSelectionDetails(null, [target]), {
		trackIds: ['track-a'],
		clipIds: ['clip-a'],
		frequencyRange: null,
	});
});

test('target resolution rejects missing focus, silent ranges, and invalid clip targets', () => {
	const harness = createHarness();
	harness.state.selectedClipId = null;
	harness.state.selectedTrackId = 'missing';
	assert.equal(harness.service.audacityEffectTarget(), null);
	assert.deepEqual(harness.service.audacityEffectTargets(), []);

	harness.state.selectedTrackId = 'track-b';
	harness.setProject({
		id: 'project-a', schemaVersion: 5, sampleRate: 48_000, title: 'Project',
		tracks: [{ id: 'track-b', name: 'B', type: 'audio', clipIds: [] }], clips: [],
		selection: { startFrame: 10, endFrame: 20, trackIds: ['track-b'], clipIds: [] },
		master: { effects: [] }, mixer: { groups: [], sends: [], routes: {} },
	});
	assert.equal(harness.service.audacityEffectTarget(), null);

	harness.state.selectedClipId = 'missing-clip';
	assert.deepEqual(harness.service.audacityEffectTargets(), []);
	harness.state.selectedClipId = 'video-clip';
	harness.setProject({
		id: 'project-a', schemaVersion: 5, sampleRate: 48_000, title: 'Project',
		tracks: [{ id: 'video', name: 'Video', type: 'video', clipIds: ['video-clip'] }],
		clips: [{
			id: 'video-clip', kind: 'video', sourceId: 'source-video', title: 'Video',
			timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 20, durationFrames: 20,
		}],
		selection: null, master: { effects: [] }, mixer: { groups: [], sends: [], routes: {} },
	});
	assert.deepEqual(harness.service.audacityEffectTargets(), []);
});

test('multi-track range resolution preserves silent tracks only when requested', () => {
	const harness = createHarness();
	harness.state.selectedClipId = null;
	harness.setProject({
		...({} as EffectSelectionProject),
		id: 'project-a', schemaVersion: 5, sampleRate: 48_000, title: 'Project',
		tracks: [
			{ id: 'track-a', name: 'A', type: 'audio', clipIds: ['clip-a'] },
			{ id: 'track-b', name: 'B', type: 'audio', clipIds: [] },
		],
		clips: [{
			id: 'clip-a', kind: 'audio', sourceId: 'source-a', title: 'Clip',
			timelineStartFrame: 100, sourceStartFrame: 0, sourceDurationFrames: 200, durationFrames: 200,
		}],
		selection: { startFrame: 120, endFrame: 160, trackIds: ['track-a', 'track-b'], clipIds: [] },
		master: { effects: [] }, mixer: { groups: [], sends: [], routes: {} },
	});
	assert.deepEqual(harness.service.audacityEffectTargets().map((target) => target.track.id), ['track-a']);
	assert.deepEqual(
		harness.service.audacityEffectTargets({ includeSilentTracks: true }).map((target) => [target.track.id, target.hasAudio]),
		[['track-a', true], ['track-b', false]],
	);
});

test('spectral context treats parametric EQ as a time-only selection', () => {
	const harness = createHarness();
	harness.setProject({
		...({} as EffectSelectionProject),
		id: 'project-a', schemaVersion: 5, sampleRate: 48_000, title: 'Project',
		tracks: [{ id: 'track-a', name: 'A', type: 'audio', clipIds: ['clip-a'], spectrogram: { windowSize: 4_096 } }],
		clips: [{
			id: 'clip-a', kind: 'audio', sourceId: 'source-a', title: 'Clip',
			timelineStartFrame: 100, sourceStartFrame: 0, sourceDurationFrames: 200, durationFrames: 200,
		}],
		selection: {
			startFrame: 100, endFrame: 300, trackIds: ['track-a'], clipIds: ['clip-a'],
			frequencyRange: { minimumFrequency: 100, maximumFrequency: 2_000 },
		},
		master: { effects: [] }, mixer: { groups: [], sends: [], routes: {} },
	});
	const target = harness.service.audacityEffectTarget();
	assert.ok(target);
	assert.deepEqual(harness.service.audacitySpectralEffectContext(target, { lengthChanging: false }), {
		minimumFrequency: 100,
		maximumFrequency: 2_000,
		windowSize: 4_096,
	});
	harness.state.audacityEffectType = 'eq';
	assert.equal(harness.service.audacitySpectralEffectContext(target, { lengthChanging: false }), null);
	harness.state.audacityEffectType = 'change-speed';
	assert.throws(
		() => harness.service.audacitySpectralEffectContext(target, { lengthChanging: true }),
		/Cannot stretch/u,
	);
});

test('spectral box creation validates Nyquist limits and respects edit blocking', () => {
	const harness = createHarness();
	assert.deepEqual(harness.service.setSpectralBoxSelection({ minimumFrequency: 80, maximumFrequency: 12_000 }), {
		startFrame: 100,
		endFrame: 300,
		trackIds: ['track-a'],
		clipIds: ['clip-a'],
		frequencyRange: { minimumFrequency: 80, maximumFrequency: 12_000 },
	});
	assert.equal(harness.commits.length, 1);
	assert.throws(
		() => harness.service.setSpectralBoxSelection({ minimumFrequency: 80, maximumFrequency: 30_000 }),
		/Maximum invalid/u,
	);
	harness.setBlocked(true);
	assert.equal(harness.service.setSpectralBoxSelection({ minimumFrequency: 100, maximumFrequency: 1_000 }), null);
});

test('spectral brush creates one bounded time-frequency selection from a point and radius', () => {
	const harness = createHarness();
	assert.deepEqual(harness.service.setSpectralBrushSelection({
		centerFrame: 200,
		centerFrequency: 1_000,
		radiusFrames: 40,
		radiusFrequency: 250,
	}), {
		startFrame: 160,
		endFrame: 240,
		trackIds: ['track-a'],
		clipIds: [],
		frequencyRange: { minimumFrequency: 750, maximumFrequency: 1_250 },
	});
	assert.deepEqual(harness.commits, [{
		startFrame: 160,
		endFrame: 240,
		trackIds: ['track-a'],
		clipIds: [],
		frequencyRange: { minimumFrequency: 750, maximumFrequency: 1_250 },
	}]);
});

test('spectral brush clamps at timeline and Nyquist bounds and rejects malformed requests', () => {
	const harness = createHarness();
	assert.deepEqual(harness.service.setSpectralBrushSelection({
		centerFrame: 5,
		centerFrequency: 23_900,
		radiusFrames: 10,
		radiusFrequency: 500,
	}), {
		startFrame: 0,
		endFrame: 15,
		trackIds: ['track-a'],
		clipIds: [],
		frequencyRange: { minimumFrequency: 23_400, maximumFrequency: 24_000 },
	});
	assert.throws(
		() => harness.service.setSpectralBrushSelection({
			centerFrame: 5.5,
			centerFrequency: 1_000,
			radiusFrames: 10,
			radiusFrequency: 100,
		}),
		/safe integer/u,
	);
	assert.throws(
		() => harness.service.setSpectralBrushSelection({
			centerFrame: 5,
			centerFrequency: Number.NaN,
			radiusFrames: 10,
			radiusFrequency: 100,
		}),
		/finite/u,
	);
	assert.throws(
		() => harness.service.setSpectralBrushSelection({
			centerFrame: 5,
			centerFrequency: 1_000,
			radiusFrames: 0,
			radiusFrequency: 100,
		}),
		/positive/u,
	);
	harness.setBlocked(true);
	assert.equal(harness.service.setSpectralBrushSelection({
		centerFrame: 5,
		centerFrequency: 1_000,
		radiusFrames: 10,
		radiusFrequency: 100,
	}), null);
});

test('selection details and range targets retain explicit track and frequency metadata', () => {
	const harness = createHarness();
	harness.state.selectedClipId = null;
	harness.setProject({
		id: 'project-a', schemaVersion: 5, sampleRate: 48_000, title: 'Project',
		tracks: [{ id: 'track-a', name: 'A', type: 'audio', clipIds: ['clip-a'] }],
		clips: [{
			id: 'clip-a', kind: 'audio', sourceId: 'source-a', title: 'Clip',
			timelineStartFrame: 100, sourceStartFrame: 0, sourceDurationFrames: 200, durationFrames: 200,
		}],
		selection: {
			startFrame: 110, endFrame: 150, trackIds: ['track-a'], clipIds: [],
			frequencyRange: { minimumFrequency: 50, maximumFrequency: 5_000 },
		},
		master: { effects: [] }, mixer: { groups: [], sends: [], routes: {} },
	});
	const targets = harness.service.audacityEffectTargets();
	assert.equal(targets.length, 1);
	assert.deepEqual(harness.service.audacityEffectSelectionDetails({
		startFrame: 110, endFrame: 150, trackIds: ['track-a'],
		frequencyRange: { minimumFrequency: 50, maximumFrequency: 5_000 },
	}, targets), {
		trackIds: ['track-a'], clipIds: [],
		frequencyRange: { minimumFrequency: 50, maximumFrequency: 5_000 },
	});
});

test('generic spectral range messages interpolate labels and Nyquist bounds', () => {
	const harness = createHarness({ genericRangeErrors: true });
	assert.throws(
		() => harness.service.setSpectralBoxSelection({ minimumFrequency: -1, maximumFrequency: 1_000 }),
		/Minimum frequency: 0 to 24000/u,
	);
	assert.throws(
		() => harness.service.setSpectralBoxSelection({ minimumFrequency: 1_000, maximumFrequency: 500 }),
		/Maximum frequency: 1000 to 24000/u,
	);
});

test('legacy projects and non-audio focus are rejected before selection mutation', () => {
	const harness = createHarness();
	harness.setProject({
		id: 'project-a', schemaVersion: 1, sampleRate: 48_000, title: 'Legacy', tracks: [], clips: [],
		selection: null, master: { effects: [] }, mixer: { groups: [], sends: [], routes: {} },
	});
	assert.throws(() => harness.service.setSpectralBoxSelection(), /Version 2/u);
	harness.setProject({
		id: 'project-a', schemaVersion: 5, sampleRate: 48_000, title: 'Video',
		tracks: [{ id: 'video', name: 'Video', type: 'video', clipIds: [] }], clips: [], selection: null,
		master: { effects: [] }, mixer: { groups: [], sends: [], routes: {} },
	});
	harness.state.selectedTrackId = 'video';
	harness.state.selectedClipId = null;
	assert.throws(() => harness.service.setSpectralBoxSelection(), /Select audio/u);
});
