/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEditorTransportService,
	type TransportServiceRuntime,
} from '../src/common/editor/controller/transport-service.ts';
import {
	createProjectBinPreviewService,
	type ProjectBinPreviewEngine,
} from '../src/common/editor/controller/project-bin-preview-service.ts';
import {
	EditorControllerLifetime,
	EditorProjectGeneration,
} from '../src/common/editor/controller/lifecycle.ts';
import type {
	ProjectBinPreview,
	ProjectBinProject,
} from '../src/common/editor/controller/project-bin-types.ts';

for (const mode of ['normal', 'play-at-speed'] as const) {
	test(`Project Bin audition retires a pending ${mode} timeline start`, async () => {
		const fixture = ownershipFixture();
		const pending = mode === 'normal'
			? fixture.transport.handleTransport('play')
			: fixture.transport.handlePlayAtSpeed(1.25);

		await fixture.preview.playPauseProjectBinClip('bin-clip');
		fixture.allowPreparation();
		const outcome = await pending.then(
			(value: unknown) => ({ value, error: null }),
			(error: unknown) => ({ value: null, error }),
		);

		assert.equal(fixture.retirements, 1);
		assert.equal(fixture.timelineStops, 1);
		assert.equal(fixture.timelinePlays, 0);
		assert.equal(fixture.speedPlays, 0);
		assert.equal(fixture.previewPlays, 1);
		assert.equal(fixture.activePreview?.state, 'playing');
		if (mode === 'normal') {
			assert.equal(errorName(outcome.error), 'AbortError');
		} else {
			assert.equal(outcome.error, null);
			assert.equal(outcome.value, false);
		}
	});
}

function ownershipFixture() {
	const preparation = deferred();
	const lifetime = new EditorControllerLifetime();
	const projects = new EditorProjectGeneration();
	const project = previewProject();
	projects.activate(project.id);
	let activePreview: ProjectBinPreview | null = null;
	let retirements = 0;
	let timelineStops = 0;
	let timelinePlays = 0;
	let speedPlays = 0;
	let previewPlays = 0;
	const state = {
		playAtSpeedRate: 1,
		playAtSpeedAbort: null as AbortController | null,
		playAtSpeedGeneration: 0,
		playbackCacheAbort: null as AbortController | null,
		recordingStarting: false,
		timedRecordingPreparing: false,
		timedRecording: false,
		recorder: null,
		projectBinPreview: null,
		preferences: { playback: { playAtSpeedMode: 'naive' } },
	};
	const engine = {
		getState: () => ({ state: 'stopped', playbackMode: 'normal', playbackRate: 1 }),
		play: async () => { timelinePlays += 1; },
		playAtSpeed: async () => { speedPlays += 1; },
		pause: () => undefined,
		stop: () => { timelineStops += 1; },
	};
	const transport = createEditorTransportService({
		AUDIO_EDITOR_SAMPLE_RATE: 48_000,
		abortError: () => abortError(),
		activeSelection: () => null,
		assertPlayAtSpeedStaffPadMemorySafe: () => undefined,
		beginPlaybackCachePreparation: async (
			_snapshot: ProjectBinProject,
			options: Readonly<{ abortController?: AbortController }> = {},
		) => {
			const abort = options.abortController ?? new AbortController();
			state.playbackCacheAbort = abort;
			await preparation.promise;
			throwIfAborted(abort.signal);
			if (state.playbackCacheAbort === abort) state.playbackCacheAbort = null;
		},
		cancelPlaybackCachePreparation: () => {
			const active = state.playbackCacheAbort;
			state.playbackCacheAbort = null;
			active?.abort(abortError());
			return active !== null;
		},
		copy: {
			playAtSpeedPlaying: 'Playing at {rate}',
			localSourcesMissing: 'Sources missing.',
		},
		engine,
		formatPlaybackRate: (rate: number) => String(rate),
		getProject: () => project,
		hasMissingTimelineSources: () => false,
		playAtSpeedPitchPreserver: null,
		projectDurationFrames: () => 8_000,
		publishDocumentSnapshot: () => undefined,
		setPlayAtSpeedRate: () => undefined,
		setStatus: () => undefined,
		state,
		throwIfAborted,
	} as TransportServiceRuntime);
	const previewEngine: ProjectBinPreviewEngine = {
		loadProject: () => undefined,
		play: async () => { previewPlays += 1; },
		pause: () => undefined,
		stop: () => undefined,
	};
	const previewDependencies = {
		lifetime,
		copy: {
			audioClipNotFound: 'Audio clip not found.',
			localSourcesMissing: 'Sources missing.',
		},
		retireTimelinePlayback: () => {
			retirements += 1;
			transport.retireTimelinePlayback();
		},
		sourceBuffers: new Map<string, AudioBuffer>(),
		sourceChunkProviders: new Map(),
		createPreviewEngine: () => previewEngine,
		createId: (prefix: string) => `${prefix}-owned`,
		captureProject: () => projects.capture(project.id),
		assertProject: (token: ReturnType<EditorProjectGeneration['capture']>) => {
			projects.assertCurrent(token);
		},
		getProject: () => project,
		getPreview: () => activePreview,
		setPreview: (value: ProjectBinPreview | null) => { activePreview = value; },
		isSourceMissing: () => false,
		getVisualData: () => null,
		publish: () => undefined,
	};
	const preview = createProjectBinPreviewService(previewDependencies);
	return {
		transport,
		preview,
		allowPreparation: preparation.resolve,
		get retirements() { return retirements; },
		get timelineStops() { return timelineStops; },
		get timelinePlays() { return timelinePlays; },
		get speedPlays() { return speedPlays; },
		get previewPlays() { return previewPlays; },
		get activePreview() { return activePreview; },
	};
}

function previewProject(): ProjectBinProject {
	return {
		id: 'project',
		schemaVersion: 17,
		revision: 0,
		sampleRate: 48_000,
		sources: [{
			id: 'source', kind: 'audio', sampleRate: 48_000,
			frameCount: 8_000, channelCount: 1,
		}],
		clips: [],
		tracks: [],
		projectBin: {
			clips: [{
				id: 'bin-clip', sourceId: 'source', title: 'Audition', kind: 'audio',
				timelineStartFrame: 0, sourceStartFrame: 0,
				sourceDurationFrames: 8_000, durationFrames: 8_000,
			}],
		},
	} as ProjectBinProject;
}

function deferred() {
	let resolve = (): void => undefined;
	const promise = new Promise<void>((complete) => { resolve = complete; });
	return { promise, resolve };
}

function abortError(): DOMException {
	return new DOMException('Playback was retired.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
}

function errorName(error: unknown): string | null {
	return error instanceof Error ? error.name : null;
}
