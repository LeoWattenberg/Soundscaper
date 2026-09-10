/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorTransportService, type TransportServiceRuntime } from '../../src/common/editor/controller/transport/internal/transport-service.ts';

export function createTransportFixture() {
	type TestProject = {
		id: string;
		schemaVersion: number;
		sampleRate: number;
		selection: { startFrame: number; endFrame: number; trackIds: string[]; clipIds: string[] } | null;
		loop: { enabled: boolean; startFrame: number; endFrame: number } | null;
		tempo: { bpm: number; timeSignature: { numerator: number } };
		tempoMap: {
			mode: 'musical';
			events: Array<{ beat: { num: number; den: number }; bpm: { num: number; den: number } }>;
		};
		signatureMap: { events: Array<{ bar: number; numerator: number; denominator: number }> };
	};
	type PlaybackState = { state: string; playbackMode: string; playbackRate: number };
	let project: TestProject = {
		id: 'project-a',
		schemaVersion: 5,
		sampleRate: 48_000,
		selection: { startFrame: 10, endFrame: 30, trackIds: ['track'], clipIds: [] },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		tempo: { bpm: 30, timeSignature: { numerator: 7 } },
		tempoMap: {
			mode: 'musical',
			events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
		},
		signatureMap: { events: [{ bar: 0, numerator: 6, denominator: 8 }] },
	};
	let playbackState: PlaybackState = { state: 'stopped', playbackMode: 'normal', playbackRate: 1 };
	let missingSources = false;
	let projectAvailable = true;
	let beginPreparation: (snapshot: TestProject, options?: { abortController?: AbortController }) => Promise<void>
		= async () => undefined;
	let audioContext: unknown = null;
	const state = {
		playAtSpeedRate: 1,
		playAtSpeedAbort: null as AbortController | null,
		playAtSpeedGeneration: 0,
		recordingStarting: false,
		timedRecordingPreparing: false,
		timedRecording: false,
		recorder: null as object | null,
		projectBinPreview: null as object | null,
		playbackCacheAbort: null as AbortController | null,
		preferences: { playback: { playAtSpeedMode: 'naive' } },
		selectionFollowsLoop: false,
		metronomeEnabled: false,
		transportState: 'stopped',
		disposed: false,
		metronomeTimer: 0 as ReturnType<typeof setTimeout> | 0,
	};
	const calls = {
		begins: [] as TestProject[],
		cacheCancellations: 0,
		commits: [] as unknown[],
		memoryChecks: [] as unknown[][],
		pauses: 0,
		plays: 0,
		playAtSpeed: [] as unknown[][],
		publishes: 0,
		recordStarts: 0,
		recordStops: 0,
		seeks: [] as number[],
		playRanges: [] as unknown[],
		selections: [] as number[][],
		statuses: [] as unknown[][],
		previewStops: 0,
		timedCancellations: 0,
		persisted: [] as unknown[][],
		loops: [] as unknown[],
		metronomeSchedules: [] as unknown[],
	};
	let positionFrame = 40;
	let playRange: { startFrame: number; endFrame: number } | null = null;
	const engine = {
		getState: () => playbackState,
		getPositionFrames: () => positionFrame,
		setPlayRange: (range: { startFrame: number; endFrame: number } | null) => {
			calls.playRanges.push(range ? { ...range } : null);
			playRange = range ? { ...range } : null;
			return playRange;
		},
		pause: () => { calls.pauses += 1; return 'paused'; },
		play: () => { calls.plays += 1; return 'played'; },
		playAtSpeed: async (rate: number, options: unknown) => {
			calls.playAtSpeed.push([rate, options]);
		},
		stop: () => 'stopped',
		seek: (frame: number) => { calls.seeks.push(frame); return frame; },
		setLoop: (loop: unknown) => { calls.loops.push(loop); },
		getAudioContext: async () => audioContext,
	};
	const runtime = {
		AUDIO_EDITOR_SAMPLE_RATE: 44_100,
		abortError: () => Object.assign(new Error('Aborted'), { name: 'AbortError' }),
		activeSelection: () => project.selection,
		assertPlayAtSpeedStaffPadMemorySafe: (...args: unknown[]) => { calls.memoryChecks.push(args); },
		beginPlaybackCachePreparation: async (snapshot: TestProject, options?: { abortController?: AbortController }) => {
			calls.begins.push(snapshot);
			await beginPreparation(snapshot, options);
		},
		calculateAudioEditorMetronomeSchedule: (options: unknown) => {
			calls.metronomeSchedules.push(options);
			return {
				beatIndex: 3, delaySeconds: 0.01, beatDurationSeconds: 0.02,
				barIndex: 0, pulseIndex: 3, accent: 'group',
			};
		},
		cancelPlaybackCachePreparation: () => {
			calls.cacheCancellations += 1;
			state.playbackCacheAbort?.abort();
			state.playbackCacheAbort = null;
		},
		playbackCachePreparationPending: () => state.playbackCacheAbort !== null,
		cancelTimedRecording: () => { calls.timedCancellations += 1; return 'timed-cancelled'; },
		commit: (command: unknown) => {
			calls.commits.push(command);
			const candidate = command as {
				type?: string;
				enabled?: boolean;
				startFrame?: number;
				endFrame?: number;
				commands?: Array<{ type?: string; enabled?: boolean; startFrame?: number; endFrame?: number }>;
			};
			const loopCommand = candidate.type === 'batch'
				? candidate.commands?.find((entry) => entry.type === 'loop/set')
				: candidate;
			if (loopCommand?.type === 'loop/set') {
				project = {
					...project,
					loop: {
						enabled: Boolean(loopCommand.enabled),
						startFrame: Number(loopCommand.startFrame) || 0,
						endFrame: Number(loopCommand.endFrame) || 0,
					},
				};
			}
			return project;
		},
		copy: {
			ready: 'Ready',
			localSourcesMissing: 'Sources missing',
			playAtSpeedPreparing: 'Preparing',
			playAtSpeedPlaying: 'Playing at {rate}',
			timeSelectionRequired: 'Select time',
			timelineFramesFinite: 'Frames must be finite.',
		},
		editorTimelineDurationFrames: () => 1_200,
		engine,
		formatPlaybackRate: (rate: number) => `${rate}x`,
		hasMissingTimelineSources: () => missingSources,
		persistSetting: async (...args: unknown[]) => { calls.persisted.push(args); },
		playAtSpeedPitchPreserver: { name: 'staffpad' },
		productSettingKey: (key: string) => `product:${key}`,
		getProject: () => projectAvailable ? project : null,
		projectDurationFrames: () => 1_000,
		publishDocumentSnapshot: () => { calls.publishes += 1; },
		setSelection: (start: number, end: number) => {
			calls.selections.push([start, end]);
			return { startFrame: start, endFrame: end };
		},
		setStatus: (...args: unknown[]) => { calls.statuses.push(args); },
		startRecording: () => { calls.recordStarts += 1; return 'recording-started'; },
		state,
		stopProjectBinPreview: async () => { calls.previewStops += 1; state.projectBinPreview = null; },
		stopRecording: () => { calls.recordStops += 1; return 'recording-stopped'; },
		throwIfAborted: (signal: AbortSignal) => {
			if (signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
		},
	} as unknown as TransportServiceRuntime;
	return {
		service: createEditorTransportService(runtime),
		state,
		calls,
		engine,
		project: () => project,
		setProject(value: TestProject) { project = value; },
		setPlaybackState(value: Partial<PlaybackState>) { playbackState = { ...playbackState, ...value }; },
		setProjectAvailable(value: boolean) { projectAvailable = value; },
		setMissingSources(value: boolean) { missingSources = value; },
		setBeginPreparation(value: typeof beginPreparation) { beginPreparation = value; },
		setAudioContext(value: unknown) { audioContext = value; },
		setPositionFrame(value: number) { positionFrame = value; },
		playRange: () => playRange,
	};
}
