/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ControllerTransportMeters, ControllerTransportState } from './transport-state.ts';

export interface ViewStateTrack {
	readonly id: string;
	readonly height?: number;
}

/** What the timeline view reads from the active document. */
export interface ViewStateProject {
	readonly tracks: readonly ViewStateTrack[];
}

export interface ViewStateServiceState extends Pick<ControllerTransportState,
	| 'durationFrames' | 'meters' | 'positionFrame' | 'transportState'
> {
	pixelsPerSecond: number;
	timelineViewportWidth: number;
	autoFitTrackHeight: boolean;
	visibleTrackHeights: Record<string, number>;
	sampleEditMode: unknown;
	inputLoudnessMeasurementExplicitlyRunning: boolean;
	readonly inputLoudnessMeasurementManuallyPaused: boolean;
	readonly microphoneMetering: boolean;
	readonly recorder: unknown;
	readonly recordingPreviews: readonly Readonly<{ readonly startFrame: number; readonly frames: number }>[];
}

export interface ViewStateLoudnessMeter {
	setRunning(running: boolean): void;
	requestSnapshot?(): void;
}

export interface ViewStateServiceRuntime<Project extends ViewStateProject = ViewStateProject> {
	readonly MAX_PIXELS_PER_SECOND: number;
	readonly commit: (
		command: Readonly<{ readonly type: 'batch'; readonly commands: readonly unknown[] }>,
		selection?: Readonly<{ readonly selectTrackId?: unknown }>,
	) => unknown;
	readonly copy: Readonly<{ readonly trackNotFound: string }>;
	readonly editingBlocked: () => boolean;
	readonly editorTimelineDurationFrames: (project: Project | null, sampleRate: number) => number;
	readonly findTrack: (project: Project | null, trackId: unknown) => ViewStateTrack | null | undefined;
	readonly getMicrophoneMeterSession: () => Readonly<{ readonly loudnessMeter?: ViewStateLoudnessMeter | null }> | null;
	readonly getProject: () => Project | null;
	readonly getRoutedInputLoudnessMeter: () => Pick<ViewStateLoudnessMeter, 'setRunning'> | null;
	readonly projectDurationFrames: (project: Project | null) => number;
	readonly projectSampleRate: () => number;
	readonly publishProjectState: () => void;
	readonly publishTelemetrySnapshot: () => void;
	readonly sampleEditingAvailable: () => boolean;
	readonly state: ViewStateServiceState;
	readonly stopMicrophoneMetering: (
		options: Readonly<{ readonly releaseInput: boolean; readonly preserveReading: boolean }>,
	) => unknown;
	readonly syncMetronome: () => unknown;
}

export function createViewStateService<Project extends ViewStateProject = ViewStateProject>(
	runtime: ViewStateServiceRuntime<Project>,
) {
	const {
		MAX_PIXELS_PER_SECOND, commit, copy, editingBlocked,
		editorTimelineDurationFrames, findTrack, getMicrophoneMeterSession, getProject,
		getRoutedInputLoudnessMeter, projectDurationFrames, projectSampleRate,
		publishProjectState, publishTelemetrySnapshot, sampleEditingAvailable, state,
		stopMicrophoneMetering, syncMetronome,
	} = runtime;

	function updatePlayhead(frame: unknown = 0, duration: unknown = projectDurationFrames(getProject())) {
		let nextFrame = Math.max(0, Math.round(Number(frame) || 0));
		let nextDuration = Math.max(0, Math.round(Number(duration) || 0));
		// The transport duration is fixed while recording. Keep preview and
		// playhead coordinates in the same project-time space.
		const recordingEndFrame = state.recordingPreviews.reduce((end, preview) => (
			Math.max(end, preview.startFrame + preview.frames)
		), 0);
		if (state.recorder && recordingEndFrame > 0) {
			nextFrame = Math.max(nextFrame, recordingEndFrame);
			nextDuration = Math.max(nextDuration, recordingEndFrame);
		}
		state.positionFrame = nextFrame;
		state.durationFrames = nextDuration;
		publishTelemetrySnapshot();
	}

	function updateTransportState(value: unknown) {
		const nextTransportState = typeof value === 'string' && value ? value : 'stopped';
		if (nextTransportState !== state.transportState && nextTransportState !== 'recording') {
			state.inputLoudnessMeasurementExplicitlyRunning = false;
		}
		state.transportState = nextTransportState;
		const shouldMeasure = !state.inputLoudnessMeasurementManuallyPaused
			&& (state.transportState === 'recording' || state.inputLoudnessMeasurementExplicitlyRunning);
		const microphoneMeterSession = getMicrophoneMeterSession();
		microphoneMeterSession?.loudnessMeter?.setRunning(shouldMeasure);
		getRoutedInputLoudnessMeter()?.setRunning(shouldMeasure);
		microphoneMeterSession?.loudnessMeter?.requestSnapshot?.();
		if (state.transportState !== 'recording'
			&& !state.microphoneMetering
			&& !state.recorder
			&& microphoneMeterSession) {
			stopMicrophoneMetering({ releaseInput: false, preserveReading: true });
		}
		syncMetronome();
		publishTelemetrySnapshot();
	}

	function updateMeters(meters: ControllerTransportMeters | null | undefined) {
		state.meters = meters || { tracks: {}, master: null };
		publishTelemetrySnapshot();
	}

	/**
	 * Zoom the timeline. Menu and shortcut zoom moves one octave a step, the way
	 * Audacity's Zoom In and Zoom Out do; a caller that supplies its own factor
	 * — the mouse wheel, which honours Audacity's zoom precision — moves by that
	 * instead.
	 */
	function updateZoom(action: unknown, requestedViewportWidth: unknown, requestedFactor?: unknown) {
		const project = getProject();
		if (action === 'fit') {
			const viewport = Math.max(320, Number(requestedViewportWidth) || state.timelineViewportWidth || 960);
			const sampleRate = projectSampleRate();
			const editorDurationSeconds = editorTimelineDurationFrames(project, sampleRate) / sampleRate;
			const contentDurationFrames = projectDurationFrames(project);
			const fitDurationSeconds = contentDurationFrames > 0
				? contentDurationFrames / sampleRate
				: editorDurationSeconds;
			state.pixelsPerSecond = Math.max(1, Math.min(MAX_PIXELS_PER_SECOND, viewport / fitDurationSeconds));
		} else {
			const durationSeconds = editorTimelineDurationFrames(project, projectSampleRate()) / projectSampleRate();
			const minimum = state.timelineViewportWidth > 0 ? state.timelineViewportWidth / durationSeconds : 1;
			const requested = Number(requestedFactor);
			const factor = Number.isFinite(requested) && requested > 1 ? requested : 2;
			state.pixelsPerSecond = Math.max(minimum, Math.min(
				MAX_PIXELS_PER_SECOND,
				state.pixelsPerSecond * (action === 'in' ? factor : 1 / factor),
			));
		}
		if (!sampleEditingAvailable()) state.sampleEditMode = null;
		publishProjectState();
		return state.pixelsPerSecond;
	}

	function setTimelineViewportWidth(width: unknown) {
		const nextWidth = Math.max(0, Number(width) || 0);
		if (nextWidth === state.timelineViewportWidth) return nextWidth;
		state.timelineViewportWidth = nextWidth;
		publishProjectState();
		return nextWidth;
	}

	function setAutoFitTrackHeight(enabled: unknown) {
		state.autoFitTrackHeight = Boolean(enabled);
		publishProjectState();
		return state.autoFitTrackHeight;
	}

	function setVisibleTrackHeights(heights: Readonly<Record<string, unknown>> = {}) {
		const project = getProject();
		state.visibleTrackHeights = Object.fromEntries(Object.entries(heights)
			.filter(([trackId, height]) => project?.tracks.some((track) => track.id === trackId)
				&& Number.isFinite(Number(height)))
			.map(([trackId, height]) => [trackId, Math.max(40, Math.round(Number(height)))]));
		return state.visibleTrackHeights;
	}

	function adjustTrackHeight(trackId: unknown, delta: number) {
		const project = getProject();
		const track = findTrack(project, trackId);
		if (!track) throw new Error(copy.trackNotFound);
		const currentHeight = state.visibleTrackHeights[track.id] ?? track.height ?? 114;
		return resizeTrackHeight(track.id, currentHeight + delta, state.visibleTrackHeights);
	}

	function adjustAllTrackHeights(delta: number) {
		if (editingBlocked()) return null;
		const project = getProject();
		const commands = (project?.tracks ?? []).map((track) => {
			const currentHeight = state.visibleTrackHeights[track.id] ?? track.height ?? 114;
			return {
				type: 'track/update',
				trackId: track.id,
				changes: { height: Math.max(40, Math.round(currentHeight + delta)) },
			};
		});
		state.autoFitTrackHeight = false;
		if (commands.length) return commit({ type: 'batch', commands });
		publishProjectState();
		return project;
	}

	function resizeTrackHeight(trackId: unknown, requestedHeight: unknown, fittedHeights: Readonly<Record<string, unknown>> = {}) {
		if (editingBlocked()) return null;
		const project = getProject();
		const selectedTrack = findTrack(project, trackId);
		if (!project || !selectedTrack) throw new Error(copy.trackNotFound);
		const commands = project.tracks
			.map((track) => {
				const value = track.id === trackId ? requestedHeight : fittedHeights[track.id];
				const height = Math.max(40, Math.round(Number(value) || track.height || 114));
				return height === track.height ? null : {
					type: 'track/update',
					trackId: track.id,
					changes: { height },
				};
			})
			.filter(Boolean);
		state.autoFitTrackHeight = false;
		if (commands.length) commit({ type: 'batch', commands }, { selectTrackId: trackId });
		else publishProjectState();
		return selectedTrack.id;
	}

	return Object.freeze({
		adjustAllTrackHeights,
		adjustTrackHeight,
		resizeTrackHeight,
		setAutoFitTrackHeight,
		setTimelineViewportWidth,
		setVisibleTrackHeights,
		updateMeters,
		updatePlayhead,
		updateTransportState,
		updateZoom,
	});
}
