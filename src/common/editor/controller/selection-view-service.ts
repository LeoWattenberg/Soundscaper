/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../project-schema-version.ts';
import { createClipSelectionNavigationService } from './clip-selection-navigation-service.ts';

/* eslint-disable @typescript-eslint/no-explicit-any -- Explicitly named legacy ports keep the migration seam typo-safe while project shapes are narrowed. */

type LegacyPort = (...args: any[]) => any;

export interface SelectionViewServiceRuntime {
	readonly DEFAULT_PIXELS_PER_SECOND: number;
	readonly MAX_PIXELS_PER_SECOND: number;
	readonly MAX_TIMELINE_PIXELS: number;
	readonly activeSelection: LegacyPort;
	readonly audioBufferChannels: LegacyPort;
	readonly cloneProject: LegacyPort;
	readonly collectRelatedClipIds: LegacyPort;
	readonly commit: LegacyPort;
	readonly copy: any;
	readonly editorTimelineDurationFrames: LegacyPort;
	readonly engine: any;
	readonly findClip: LegacyPort;
	readonly findClipTrack: LegacyPort;
	readonly findNearestAudioZeroCrossing: LegacyPort;
	readonly findTrack: LegacyPort;
	readonly getProject: LegacyPort;
	readonly handleError: LegacyPort;
	readonly normalizeTimelineFrame: LegacyPort;
	readonly persistSetting: LegacyPort;
	readonly productSettingKey: LegacyPort;
	readonly projectDurationFrames: LegacyPort;
	readonly projectSampleRate: LegacyPort;
	readonly publishDocumentSnapshot: LegacyPort;
	readonly publishProjectState: LegacyPort;
	readonly renderSnapshot: LegacyPort;
	readonly resetRoutedInputMeter: LegacyPort;
	readonly setStatus: LegacyPort;
	readonly snapAudioEditorFrameWithProject: LegacyPort;
	readonly state: any;
	readonly synchronizeAutomaticSampleEditMode: LegacyPort;
	readonly synchronizeMicrophoneMeterTarget: LegacyPort;
	readonly updatePlayhead: LegacyPort;
	readonly updateSelection: LegacyPort;
}

export function createSelectionViewService(runtime: SelectionViewServiceRuntime) {
	const {
		DEFAULT_PIXELS_PER_SECOND, MAX_PIXELS_PER_SECOND, MAX_TIMELINE_PIXELS,
		activeSelection, audioBufferChannels, cloneProject, collectRelatedClipIds,
		commit, copy, editorTimelineDurationFrames, engine, findClip, findClipTrack,
		findNearestAudioZeroCrossing, findTrack, getProject, handleError,
		normalizeTimelineFrame, persistSetting, productSettingKey, projectDurationFrames,
		projectSampleRate, publishDocumentSnapshot, publishProjectState, renderSnapshot,
		resetRoutedInputMeter, setStatus, snapAudioEditorFrameWithProject, state,
		synchronizeAutomaticSampleEditMode, synchronizeMicrophoneMeterTarget,
		updatePlayhead, updateSelection,
	} = runtime;
	const clipNavigation = createClipSelectionNavigationService({
		state,
		getProject,
		updateSelection,
		seek: (frame) => { engine.seek(frame); },
	});

	function selectTrack(trackId: any) {
		const project = getProject();
		if (trackId != null && !findTrack(project, trackId)) throw new Error(copy.audioTrackNotFound);
		const changed = state.selectedTrackId !== (trackId || null);
		state.selectedTrackId = trackId || null;
		state.selectedClipId = null;
		state.selectedAnnotationId = null;
		if (changed) resetRoutedInputMeter();
		synchronizeMicrophoneMeterTarget();
		if (!clearDurableAnnotationSelection(project)) publishProjectState();
	}

	function expandSelectedClipIds(rawClipIds: any) {
		return collectRelatedClipIds(getProject(), rawClipIds || []);
	}

	function selectClip(clipId: any, options: any = {}) {
		const project = getProject();
		if (clipId == null) {
			state.selectedClipId = null;
			state.selectedAnnotationId = null;
			if (project?.schemaVersion >= 2 && (
				project.selection?.clipIds?.length
				|| (hasCurrentTimelineAnnotations(project) && project.selection?.annotationIds?.length)
			)) {
				const selection = project.selection;
				return updateSelection({
					type: 'selection/set',
					startFrame: selection.startFrame,
					endFrame: selection.endFrame,
					trackIds: [],
					clipIds: [],
					...clearedAnnotationSelectionDetails(project),
					frequencyRange: selection.frequencyRange || null,
				});
			}
			publishProjectState();
			return null;
		}
		const clip = findClip(project, clipId);
		const track = clip ? findClipTrack(project, clip.id) : null;
		if (!clip || !track) throw new Error(copy.audioClipNotFound);
		state.selectedAnnotationId = null;
		if (project.schemaVersion < 2) {
			state.selectedTrackId = track.id;
			state.selectedClipId = clip.id;
			synchronizeMicrophoneMeterTarget();
			publishProjectState();
			return clip.id;
		}

		const currentClipIds = project.selection?.clipIds || [];
		let clipIds;
		if (options.toggle) {
			const toggledClipIds = new Set(expandSelectedClipIds([clip.id]));
			clipIds = currentClipIds.includes(clip.id)
				? currentClipIds.filter((selectedId: any) => !toggledClipIds.has(selectedId))
				: [...currentClipIds, ...toggledClipIds];
		} else if (options.additive) {
			clipIds = currentClipIds.includes(clip.id) ? currentClipIds : [...currentClipIds, clip.id];
		} else clipIds = [clip.id];
		const nextClipIds = expandSelectedClipIds(clipIds);
		const trackIds = [...new Set(nextClipIds.map((selectedId: any) => findClipTrack(project, selectedId)?.id).filter(Boolean))];
		const activeClipId = nextClipIds.includes(clip.id) ? clip.id : nextClipIds.at(-1) || null;
		const activeTrack = activeClipId ? findClipTrack(project, activeClipId) : null;
		state.selectedTrackId = activeTrack?.id || null;
		state.selectedClipId = activeClipId;
		updateSelection({
			type: 'selection/set',
			startFrame: 0,
			endFrame: 0,
			trackIds,
			clipIds: nextClipIds,
			...clearedAnnotationSelectionDetails(project),
			frequencyRange: null,
		});
		return activeClipId;
	}

	function setSelection(startFrame: any, endFrame: any, details: any = {}) {
		const project = getProject();
		if (!Number.isFinite(Number(startFrame)) || !Number.isFinite(Number(endFrame))) {
			throw new TypeError(copy.selectionFramesFinite);
		}
		const maximumFrame = project.tracks.length
			? editorTimelineDurationFrames(project, projectSampleRate())
			: projectDurationFrames(project);
		const clampSelectionFrame = (value: any) => Math.max(0, Math.min(maximumFrame, Math.round(Number(value))));
		const start = snapTimelineFrame(clampSelectionFrame(Math.min(Number(startFrame), Number(endFrame))), { maximumFrame });
		const end = snapTimelineFrame(clampSelectionFrame(Math.max(Number(startFrame), Number(endFrame))), { maximumFrame });
		state.selectedClipId = null;
		state.selectedAnnotationId = null;
		const command: any = { type: 'selection/set', startFrame: start, endFrame: end };
		if (Object.keys(details).length) Object.assign(command, details, { clipIds: [] });
		Object.assign(command, clearedAnnotationSelectionDetails(project));
		return updateSelection(command);
	}

	function clearDurableAnnotationSelection(project: any) {
		if (!hasCurrentTimelineAnnotations(project) || !project.selection?.annotationIds?.length) return false;
		const selection = project.selection;
		updateSelection({
			type: 'selection/set', startFrame: selection.startFrame, endFrame: selection.endFrame,
			trackIds: selection.trackIds || [], clipIds: selection.clipIds || [], annotationIds: [],
			frequencyRange: selection.frequencyRange || null,
		});
		return true;
	}

	function clearedAnnotationSelectionDetails(project: any) {
		return hasCurrentTimelineAnnotations(project) && project.selection?.annotationIds?.length ? { annotationIds: [] } : {};
	}

	function selectAllTracks() {
		const project = getProject();
		if (!project) return null;
		const selection = project.selection || { startFrame: 0, endFrame: 0 };
		const trackIds = project.tracks.map((track: any) => track.id);
		const next = setSelection(selection.startFrame, selection.endFrame, { trackIds });
		if (!state.selectedTrackId && trackIds.length) {
			state.selectedTrackId = trackIds[0];
			synchronizeMicrophoneMeterTarget();
		}
		return next.selection;
	}

	function selectLeftOfPlaybackPosition(requestedStartFrame: any = null) {
		const playbackFrame = normalizeTimelineFrame(engine.getPositionFrames());
		let startFrame = requestedStartFrame == null
			? (activeSelection()?.startFrame ?? 0)
			: normalizeTimelineFrame(requestedStartFrame);
		if (startFrame >= playbackFrame) startFrame = 0;
		return setSelection(startFrame, playbackFrame).selection;
	}

	function selectRightOfPlaybackPosition(requestedEndFrame: any = null) {
		const project = getProject();
		const playbackFrame = normalizeTimelineFrame(engine.getPositionFrames());
		let endFrame = requestedEndFrame == null
			? (activeSelection()?.endFrame ?? projectDurationFrames(project))
			: normalizeTimelineFrame(requestedEndFrame);
		if (endFrame <= playbackFrame) endFrame = projectDurationFrames(project);
		return setSelection(playbackFrame, endFrame).selection;
	}

	function selectTrackStartToCursor() {
		const range = selectedTracksTimeRange();
		return setSelection(range?.startFrame ?? 0, normalizeTimelineFrame(engine.getPositionFrames())).selection;
	}

	function selectCursorToTrackEnd() {
		const range = selectedTracksTimeRange();
		const playbackFrame = normalizeTimelineFrame(engine.getPositionFrames());
		return range && range.endFrame > playbackFrame
			? setSelection(playbackFrame, range.endFrame).selection
			: selectTrackStartToCursor();
	}

	function selectTrackStartToEnd() {
		const range = selectedTracksTimeRange();
		if (!range) return null;
		return setSelection(range.startFrame, range.endFrame).selection;
	}

	function selectedTracksTimeRange() {
		const project = getProject();
		const requestedIds = project.selection?.trackIds?.length
			? project.selection.trackIds
			: state.selectedTrackId ? [state.selectedTrackId] : [];
		const tracks = requestedIds.map((trackId: any) => findTrack(project, trackId)).filter(Boolean);
		const ranges: Array<[number, number]> = [];
		for (const track of tracks) {
			if (track.type === 'label') {
				for (const label of track.labels || []) ranges.push([label.startFrame, label.endFrame]);
			} else {
				for (const clipId of track.clipIds || []) {
					const clip = findClip(project, clipId);
					if (clip) ranges.push([clip.timelineStartFrame, clip.timelineStartFrame + clip.durationFrames]);
				}
			}
		}
		if (!ranges.length && tracks.length) {
			return { startFrame: 0, endFrame: editorTimelineDurationFrames(project, projectSampleRate()) };
		}
		if (!ranges.length) return null;
		return {
			startFrame: Math.min(...ranges.map(([startFrame]) => startFrame)),
			endFrame: Math.max(...ranges.map(([, endFrame]) => endFrame)),
		};
	}

	function persistBooleanPreference(stateKey: string, settingKey: string) {
		state[stateKey] = !state[stateKey];
		void persistSetting(productSettingKey(settingKey), state[stateKey]);
		publishDocumentSnapshot();
		return state[stateKey];
	}

	function toggleRmsWaveform() {
		return persistBooleanPreference('showRms', 'waveform-show-rms');
	}

	function toggleVerticalRulers() {
		return persistBooleanPreference('showVerticalRulers', 'timeline-show-vertical-rulers');
	}

	function toggleUpdateWhilePlaying() {
		return persistBooleanPreference('updateDisplayWhilePlaying', 'timeline-update-while-playing');
	}

	function togglePinnedPlayhead() {
		return persistBooleanPreference('pinnedPlayhead', 'timeline-pinned-playhead');
	}

	function toggleRulerPlayback() {
		return persistBooleanPreference('playbackOnRulerClick', 'timeline-ruler-playback');
	}

	async function selectAtZeroCrossings() {
		const selection = activeSelection();
		if (!selection || state.analysisProcessing) return null;
		const projectAtStart = getProject();
		const radius = Math.max(1, Math.round(projectSampleRate() * 0.01));
		const renderStart = Math.max(0, selection.startFrame - radius);
		const renderEnd = Math.min(projectDurationFrames(projectAtStart), selection.endFrame + radius);
		state.analysisProcessing = true;
		publishDocumentSnapshot();
		try {
			const rendered = await renderSnapshot(cloneProject(projectAtStart), {
				startFrame: renderStart,
				endFrame: renderEnd,
				includeTail: false,
				outputFrames: renderEnd - renderStart,
			});
			if (getProject() !== projectAtStart) return null;
			const channels = audioBufferChannels(rendered);
			const startFrame = renderStart + findNearestAudioZeroCrossing(channels, selection.startFrame - renderStart, { maximumDistance: radius });
			const endFrame = renderStart + findNearestAudioZeroCrossing(channels, selection.endFrame - renderStart, { maximumDistance: radius });
			const next = commit({
				type: 'selection/set',
				startFrame: Math.min(startFrame, endFrame),
				endFrame: Math.max(startFrame, endFrame),
			});
			setStatus(copy.zeroCrossingsAligned, 'success');
			return next.selection;
		} catch (error) {
			handleError(error);
			return null;
		} finally {
			state.analysisProcessing = false;
			publishDocumentSnapshot();
		}
	}

	function setSnapSettings(settings: any = {}) {
		const project = getProject();
		if (!project || project.schemaVersion < 2) throw new Error(copy.v2Required);
		return commit({ type: 'snap/set', settings });
	}

	function snapTimelineFrame(value: any, overrides: any = {}) {
		const project = getProject();
		const frame = Number(value);
		if (!Number.isFinite(frame)) throw new TypeError(copy.timelineFramesFinite);
		const rounded = Math.round(frame);
		if (!project || project.schemaVersion < 2) return Math.max(0, rounded);
		return snapAudioEditorFrameWithProject(rounded, project, { minimumFrame: 0, ...overrides });
	}

	function setZoom(pixelsPerSecond: any) {
		const project = getProject();
		const durationSeconds = editorTimelineDurationFrames(project, projectSampleRate()) / projectSampleRate();
		const maximum = Math.min(MAX_PIXELS_PER_SECOND, MAX_TIMELINE_PIXELS / durationSeconds);
		const minimum = state.timelineViewportWidth > 0 ? state.timelineViewportWidth / durationSeconds : 1;
		state.pixelsPerSecond = Math.max(minimum, Math.min(maximum, Number(pixelsPerSecond) || DEFAULT_PIXELS_PER_SECOND));
		synchronizeAutomaticSampleEditMode();
		updatePlayhead(engine.getPositionFrames());
		publishDocumentSnapshot();
		return state.pixelsPerSecond;
	}

	return Object.freeze({
		clipNavigation,
		selectAllTracks,
		selectAtZeroCrossings,
		selectClip,
		selectCursorToTrackEnd,
		selectLeftOfPlaybackPosition,
		selectRightOfPlaybackPosition,
		selectTrack,
		selectTrackStartToCursor,
		selectTrackStartToEnd,
		selectedTracksTimeRange,
		setSelection,
		setSnapSettings,
		setZoom,
		snapTimelineFrame,
		togglePinnedPlayhead,
		toggleRmsWaveform,
		toggleRulerPlayback,
		toggleUpdateWhilePlaying,
		toggleVerticalRulers,
	});
}

function hasCurrentTimelineAnnotations(project: any): boolean {
	return project?.schemaVersion === AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION
		&& Array.isArray(project.timelineAnnotations);
}
