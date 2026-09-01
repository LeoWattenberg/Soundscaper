/* SPDX-License-Identifier: AGPL-3.0-only */

/* eslint-disable @typescript-eslint/no-explicit-any -- Explicit legacy ports keep the view-state composition seam typo-safe. */

type LegacyPort = (...args: any[]) => any;

export interface ViewStateServiceRuntime {
	readonly MAX_PIXELS_PER_SECOND: number;
	readonly MAX_TIMELINE_PIXELS: number;
	readonly commit: LegacyPort;
	readonly copy: any;
	readonly editingBlocked: LegacyPort;
	readonly editorTimelineDurationFrames: LegacyPort;
	readonly findTrack: LegacyPort;
	readonly getMicrophoneMeterSession: LegacyPort;
	readonly getProject: LegacyPort;
	readonly getRoutedInputLoudnessMeter: LegacyPort;
	readonly projectDurationFrames: LegacyPort;
	readonly projectSampleRate: LegacyPort;
	readonly publishProjectState: LegacyPort;
	readonly publishTelemetrySnapshot: LegacyPort;
	readonly sampleEditingAvailable: LegacyPort;
	readonly state: any;
	readonly stopMicrophoneMetering: LegacyPort;
	readonly syncMetronome: LegacyPort;
}

export function createViewStateService(runtime: ViewStateServiceRuntime) {
	const {
		MAX_PIXELS_PER_SECOND, MAX_TIMELINE_PIXELS, commit, copy, editingBlocked,
		editorTimelineDurationFrames, findTrack, getMicrophoneMeterSession, getProject,
		getRoutedInputLoudnessMeter, projectDurationFrames, projectSampleRate,
		publishProjectState, publishTelemetrySnapshot, sampleEditingAvailable, state,
		stopMicrophoneMetering, syncMetronome,
	} = runtime;

	function updatePlayhead(frame: any = 0, duration: any = projectDurationFrames(getProject())) {
		let nextFrame = Math.max(0, Math.round(Number(frame) || 0));
		let nextDuration = Math.max(0, Math.round(Number(duration) || 0));
		// The transport duration is fixed while recording. Keep preview and
		// playhead coordinates in the same project-time space.
		const recordingEndFrame = state.recordingPreviews.reduce((end: number, preview: any) => (
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

	function updateTransportState(value: any) {
		const nextTransportState = value || 'stopped';
		if (nextTransportState !== state.transportState && nextTransportState !== 'recording') {
			state.inputLoudnessMeasurementExplicitlyRunning = false;
		}
		state.transportState = nextTransportState;
		const shouldMeasure = !state.inputLoudnessMeasurementManuallyPaused
			&& (state.transportState === 'recording' || state.inputLoudnessMeasurementExplicitlyRunning);
		const microphoneMeterSession = getMicrophoneMeterSession();
		microphoneMeterSession?.loudnessMeter?.setRunning(shouldMeasure);
		getRoutedInputLoudnessMeter()?.setRunning(shouldMeasure);
		microphoneMeterSession?.loudnessMeter?.requestSnapshot();
		if (state.transportState !== 'recording'
			&& !state.microphoneMetering
			&& !state.recorder
			&& microphoneMeterSession) {
			stopMicrophoneMetering({ releaseInput: false, preserveReading: true });
		}
		syncMetronome();
		publishTelemetrySnapshot();
	}

	function updateMeters(meters: any) {
		state.meters = meters || { tracks: {}, master: null };
		publishTelemetrySnapshot();
	}

	function updateZoom(action: any, requestedViewportWidth: any) {
		const project = getProject();
		if (action === 'fit') {
			const viewport = Math.max(320, Number(requestedViewportWidth) || state.timelineViewportWidth || 960);
			const sampleRate = projectSampleRate();
			const editorDurationSeconds = editorTimelineDurationFrames(project, sampleRate) / sampleRate;
			const contentDurationFrames = projectDurationFrames(project);
			const fitDurationSeconds = contentDurationFrames > 0
				? contentDurationFrames / sampleRate
				: editorDurationSeconds;
			const maximum = Math.min(MAX_PIXELS_PER_SECOND, MAX_TIMELINE_PIXELS / editorDurationSeconds);
			state.pixelsPerSecond = Math.max(1, Math.min(maximum, viewport / fitDurationSeconds));
		} else {
			const durationSeconds = editorTimelineDurationFrames(project, projectSampleRate()) / projectSampleRate();
			const minimum = state.timelineViewportWidth > 0 ? state.timelineViewportWidth / durationSeconds : 1;
			state.pixelsPerSecond = Math.max(minimum, Math.min(
				MAX_PIXELS_PER_SECOND,
				state.pixelsPerSecond * (action === 'in' ? 2 : 0.5),
			));
		}
		if (!sampleEditingAvailable()) state.sampleEditMode = null;
		publishProjectState();
		return state.pixelsPerSecond;
	}

	function setTimelineViewportWidth(width: any) {
		const nextWidth = Math.max(0, Number(width) || 0);
		if (nextWidth === state.timelineViewportWidth) return nextWidth;
		state.timelineViewportWidth = nextWidth;
		publishProjectState();
		return nextWidth;
	}

	function setAutoFitTrackHeight(enabled: any) {
		state.autoFitTrackHeight = Boolean(enabled);
		publishProjectState();
		return state.autoFitTrackHeight;
	}

	function setVisibleTrackHeights(heights: any = {}) {
		const project = getProject();
		state.visibleTrackHeights = Object.fromEntries(Object.entries(heights)
			.filter(([trackId, height]) => project?.tracks.some((track: any) => track.id === trackId)
				&& Number.isFinite(Number(height)))
			.map(([trackId, height]) => [trackId, Math.max(40, Math.round(Number(height)))]));
		return state.visibleTrackHeights;
	}

	function adjustTrackHeight(trackId: any, delta: any) {
		const project = getProject();
		const track = findTrack(project, trackId);
		if (!track) throw new Error(copy.trackNotFound);
		const currentHeight = state.visibleTrackHeights[track.id] ?? track.height ?? 114;
		return resizeTrackHeight(track.id, currentHeight + delta, state.visibleTrackHeights);
	}

	function adjustAllTrackHeights(delta: any) {
		return applyAllTrackHeights((currentHeight: number) => currentHeight + delta);
	}

	function setAllTrackHeights(height: any) {
		return applyAllTrackHeights(() => Number(height));
	}

	function applyAllTrackHeights(resolveHeight: (currentHeight: number) => number) {
		if (editingBlocked()) return null;
		const project = getProject();
		const commands = project.tracks.map((track: any) => {
			const currentHeight = state.visibleTrackHeights[track.id] ?? track.height ?? 114;
			return {
				type: 'track/update',
				trackId: track.id,
				changes: { height: Math.max(40, Math.round(resolveHeight(currentHeight))) },
			};
		});
		state.autoFitTrackHeight = false;
		if (commands.length) return commit({ type: 'batch', commands });
		publishProjectState();
		return project;
	}

	function resizeTrackHeight(trackId: any, requestedHeight: any, fittedHeights: any = {}) {
		if (editingBlocked()) return null;
		const project = getProject();
		const selectedTrack = findTrack(project, trackId);
		if (!selectedTrack) throw new Error(copy.trackNotFound);
		const commands = project.tracks
			.map((track: any) => {
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
		setAllTrackHeights,
		setAutoFitTrackHeight,
		setTimelineViewportWidth,
		setVisibleTrackHeights,
		updateMeters,
		updatePlayhead,
		updateTransportState,
		updateZoom,
	});
}
