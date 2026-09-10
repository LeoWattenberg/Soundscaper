/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CommandObject } from '../../../commands/protocol.ts';
import type { RenderedAudio } from '../../../rendered-audio-channels.ts';
import { hasCoreEditingProjectAuthority, isActiveAudioEditorProjectSchema } from '../../../project-schema-version.ts';
import { resolveSelectionRange } from '../../../selection-range.ts';
import { createClipSelectionNavigationService } from './clip-selection-navigation-service.ts';
import type {
	SelectionViewClipOptions,
	SelectionViewProject,
	SelectionViewSelectionCommand,
	SelectionViewSelectionDetails,
	SelectionViewServiceRuntime,
	SelectionViewSnapOverrides,
} from './selection-view-service-types.d.ts';

export type * from './selection-view-service-types.d.ts';

type SelectionViewBooleanPreferenceKey =
	| 'showRms'
	| 'showVerticalRulers'
	| 'scrollViewToPlayhead'
	| 'pinnedPlayhead'
	| 'playbackOnRulerClick';

export function createSelectionViewService<
	Project extends SelectionViewProject,
	Rendered extends RenderedAudio,
>(runtime: SelectionViewServiceRuntime<Project, Rendered>) {
	const {
		DEFAULT_PIXELS_PER_SECOND, MAX_PIXELS_PER_SECOND,
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
	let zeroCrossingGeneration = 0;

	function selectTrack(trackId: string | null) {
		const project = getProject();
		if (trackId != null && (!project || !findTrack(project, trackId))) {
			throw new Error(copy.audioTrackNotFound);
		}
		const changed = state.selectedTrackId !== (trackId || null);
		state.selectedTrackId = trackId || null;
		state.selectedClipId = null;
		state.selectedAnnotationId = null;
		if (changed) resetRoutedInputMeter();
		synchronizeMicrophoneMeterTarget();
		if (!project || !clearDurableAnnotationSelection(project)) publishProjectState();
	}

	function expandSelectedClipIds(project: Project, rawClipIds: readonly string[]) {
		return collectRelatedClipIds(project, rawClipIds || []);
	}

	function selectClip(clipId: string | null, options: SelectionViewClipOptions = {}) {
		const project = getProject();
		if (clipId == null) {
			state.selectedClipId = null;
			state.selectedAnnotationId = null;
			if (project && hasCoreEditingProjectAuthority(project) && (
				project.selection?.clipIds?.length
				|| (hasActiveTimelineAnnotations(project) && project.selection?.annotationIds?.length)
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
		if (!project) throw new Error(copy.audioClipNotFound);
		const clip = findClip(project, clipId);
		const track = clip ? findClipTrack(project, clip.id) : null;
		if (!clip || !track) throw new Error(copy.audioClipNotFound);
		state.selectedAnnotationId = null;
		if (!hasCoreEditingProjectAuthority(project)) {
			state.selectedTrackId = track.id;
			state.selectedClipId = clip.id;
			synchronizeMicrophoneMeterTarget();
			publishProjectState();
			return clip.id;
		}

		const currentClipIds = project.selection?.clipIds || [];
		let clipIds: readonly string[];
		if (options.toggle) {
			const toggledClipIds = new Set(expandSelectedClipIds(project, [clip.id]));
			clipIds = currentClipIds.includes(clip.id)
				? currentClipIds.filter((selectedId) => !toggledClipIds.has(selectedId))
				: [...currentClipIds, ...toggledClipIds];
		} else if (options.additive) {
			clipIds = currentClipIds.includes(clip.id) ? currentClipIds : [...currentClipIds, clip.id];
		} else clipIds = [clip.id];
		const nextClipIds = expandSelectedClipIds(project, clipIds);
		const trackIds = [...new Set(nextClipIds.flatMap((selectedId) => {
			const selectedTrack = findClipTrack(project, selectedId);
			return selectedTrack ? [selectedTrack.id] : [];
		}))];
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

	function setSelection(
		startFrame: unknown,
		endFrame: unknown,
		details: SelectionViewSelectionDetails = {},
	) {
		const project = getProject();
		if (!project) throw new Error(copy.v2Required);
		return applySelectionRange(project, startFrame, endFrame, details, true);
	}

	/**
	 * Select an exact frame range, unsnapped.
	 *
	 * A macro asking for one second means one second. Running its endpoints
	 * through the snap grid would silently move them, and the reader's own snap
	 * preference is not part of what the macro says.
	 */
	function setExactSelection(
		startFrame: unknown,
		endFrame: unknown,
		details: SelectionViewSelectionDetails = {},
	) {
		const project = getProject();
		if (!project) throw new Error(copy.v2Required);
		return applySelectionRange(project, startFrame, endFrame, details, false);
	}

	/**
	 * Carry the playhead to the start of a new time selection, so pressing play
	 * plays the selection from its beginning.
	 *
	 * Only a range does this: clearing the selection collapses it onto frame zero
	 * and must leave the playhead where the click that cleared it put it. Nor does
	 * a transport already running move — a selection drawn or a macro run during
	 * playback would otherwise restart it somewhere else.
	 */
	function carryPlayheadToSelectionStart(startFrame: number, endFrame: number) {
		if (endFrame <= startFrame) return;
		if (engine.getState().state === 'playing') return;
		engine.seek(startFrame);
	}

	function applySelectionRange(
		project: Project,
		startFrame: unknown,
		endFrame: unknown,
		details: SelectionViewSelectionDetails,
		snap: boolean,
		carryPlayhead = true,
	) {
		if (!Number.isFinite(Number(startFrame)) || !Number.isFinite(Number(endFrame))) {
			throw new TypeError(copy.selectionFramesFinite);
		}
		const maximumFrame = project.tracks.length
			? editorTimelineDurationFrames(project, projectSampleRate())
			: projectDurationFrames(project);
		const clampSelectionFrame = (value: unknown) => Math.max(0, Math.min(maximumFrame, Math.round(Number(value))));
		const place = (value: unknown) => snap
			? snapTimelineFrame(clampSelectionFrame(value), { maximumFrame })
			: clampSelectionFrame(value);
		const start = place(Math.min(Number(startFrame), Number(endFrame)));
		const end = place(Math.max(Number(startFrame), Number(endFrame)));
		state.selectedClipId = null;
		state.selectedAnnotationId = null;
		const command: SelectionViewSelectionCommand = {
			type: 'selection/set',
			startFrame: start,
			endFrame: end,
			...(Object.keys(details).length ? { ...details, clipIds: [] } : {}),
			...clearedAnnotationSelectionDetails(project),
		};
		const next = updateSelection(command);
		if (carryPlayhead) carryPlayheadToSelectionStart(start, end);
		return next;
	}

	function clearDurableAnnotationSelection(project: Project) {
		if (!hasActiveTimelineAnnotations(project) || !project.selection?.annotationIds?.length) return false;
		const selection = project.selection;
		updateSelection({
			type: 'selection/set', startFrame: selection.startFrame, endFrame: selection.endFrame,
			trackIds: selection.trackIds || [], clipIds: selection.clipIds || [], annotationIds: [],
			frequencyRange: selection.frequencyRange || null,
		});
		return true;
	}

	function clearedAnnotationSelectionDetails(
		project: Project,
	): Partial<Pick<SelectionViewSelectionCommand, 'annotationIds'>> {
		return hasActiveTimelineAnnotations(project) && project.selection?.annotationIds?.length ? { annotationIds: [] } : {};
	}

	/**
	 * Audacity's own `Select All`: the whole project's time range *and* every
	 * track (`DoSelectTimeAndTracks(project, true, true)`). The track-only
	 * variant below is a separate upstream command, `SelAllTracks`, and the two
	 * are not interchangeable — a macro opening with `SelectAll` hands the steps
	 * after it the whole project, not whatever range happened to be selected.
	 *
	 * The range ends at the content, not at the timeline's visible extent, which
	 * deliberately runs past it so there is somewhere to drag to.
	 */
	function selectAll() {
		const project = getProject();
		if (!project) return null;
		const trackIds = project.tracks.map((track) => track.id);
		const next = applySelectionRange(project, 0, projectDurationFrames(project), { trackIds }, false);
		if (!state.selectedTrackId && trackIds.length) {
			state.selectedTrackId = trackIds[0];
			synchronizeMicrophoneMeterTarget();
		}
		return next.selection;
	}

	function selectAllTracks() {
		const project = getProject();
		if (!project) return null;
		const selection = project.selection || { startFrame: 0, endFrame: 0 };
		const trackIds = project.tracks.map((track) => track.id);
		// Widening the selection's track scope leaves its time range exactly as it
		// was, so it is not a new time selection and does not move the playhead.
		const next = applySelectionRange(
			project, selection.startFrame, selection.endFrame, { trackIds }, true, false,
		);
		if (!state.selectedTrackId && trackIds.length) {
			state.selectedTrackId = trackIds[0];
			synchronizeMicrophoneMeterTarget();
		}
		return next.selection;
	}

	/**
	 * These commands read the playhead to place one endpoint of the selection, so
	 * the selection they make must not then move it: the next such command would
	 * measure from an anchor its predecessor had already shifted.
	 */
	function setPlayheadAnchoredSelection(
		startFrame: unknown,
		endFrame: unknown,
		project = getProject(),
	) {
		return project ? applySelectionRange(project, startFrame, endFrame, {}, true, false) : null;
	}

	function selectLeftOfPlaybackPosition(requestedStartFrame: unknown = null) {
		const playbackFrame = normalizeTimelineFrame(engine.getPositionFrames());
		let startFrame = requestedStartFrame == null
			? (activeSelection()?.startFrame ?? 0)
			: normalizeTimelineFrame(requestedStartFrame);
		if (startFrame >= playbackFrame) startFrame = 0;
		return setPlayheadAnchoredSelection(startFrame, playbackFrame)?.selection ?? null;
	}

	function selectRightOfPlaybackPosition(requestedEndFrame: unknown = null) {
		const project = getProject();
		if (!project) return null;
		const playbackFrame = normalizeTimelineFrame(engine.getPositionFrames());
		let endFrame = requestedEndFrame == null
			? (activeSelection()?.endFrame ?? projectDurationFrames(project))
			: normalizeTimelineFrame(requestedEndFrame);
		if (endFrame <= playbackFrame) endFrame = projectDurationFrames(project);
		return setPlayheadAnchoredSelection(playbackFrame, endFrame, project)?.selection ?? null;
	}

	function selectTrackStartToCursor() {
		const range = selectedTracksTimeRange();
		return setPlayheadAnchoredSelection(
			range?.startFrame ?? 0, normalizeTimelineFrame(engine.getPositionFrames()),
		)?.selection ?? null;
	}

	function selectCursorToTrackEnd() {
		const range = selectedTracksTimeRange();
		const playbackFrame = normalizeTimelineFrame(engine.getPositionFrames());
		return range && range.endFrame > playbackFrame
			? setPlayheadAnchoredSelection(playbackFrame, range.endFrame)?.selection ?? null
			: selectTrackStartToCursor();
	}

	function selectTrackStartToEnd() {
		const range = selectedTracksTimeRange();
		if (!range) return null;
		return setSelection(range.startFrame, range.endFrame).selection;
	}

	function selectedTracksTimeRange() {
		const project = getProject();
		if (!project) return null;
		const requestedIds = project.selection?.trackIds?.length
			? project.selection.trackIds
			: state.selectedTrackId ? [state.selectedTrackId] : [];
		const tracks = requestedIds.flatMap((trackId) => {
			const track = findTrack(project, trackId);
			return track ? [track] : [];
		});
		const ranges: Array<[number, number]> = [];
		for (const track of tracks) {
			if (track.type === 'label') {
				for (const label of track.labels || []) {
					if (isFiniteFrame(label.startFrame) && isFiniteFrame(label.endFrame)) {
						ranges.push([label.startFrame, label.endFrame]);
					}
				}
			} else {
				for (const clipId of track.clipIds || []) {
					const clip = findClip(project, clipId);
					if (clip && isFiniteFrame(clip.timelineStartFrame) && isFiniteFrame(clip.durationFrames)) {
						ranges.push([clip.timelineStartFrame, clip.timelineStartFrame + clip.durationFrames]);
					}
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

	function persistBooleanPreference(stateKey: SelectionViewBooleanPreferenceKey, settingKey: string) {
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

	function toggleScrollViewToPlayhead() {
		return persistPlaybackFollowPreference(
			'scrollViewToPlayhead', 'timeline-update-while-playing',
			'pinnedPlayhead', 'timeline-pinned-playhead',
		);
	}

	function togglePinnedPlayhead() {
		return persistPlaybackFollowPreference(
			'pinnedPlayhead', 'timeline-pinned-playhead',
			'scrollViewToPlayhead', 'timeline-update-while-playing',
		);
	}

	function persistPlaybackFollowPreference(
		stateKey: 'scrollViewToPlayhead' | 'pinnedPlayhead',
		settingKey: string,
		exclusiveStateKey: 'scrollViewToPlayhead' | 'pinnedPlayhead',
		exclusiveSettingKey: string,
	) {
		state[stateKey] = !state[stateKey];
		void persistSetting(productSettingKey(settingKey), state[stateKey]);
		if (state[stateKey] && state[exclusiveStateKey]) {
			state[exclusiveStateKey] = false;
			void persistSetting(productSettingKey(exclusiveSettingKey), false);
		}
		publishDocumentSnapshot();
		return state[stateKey];
	}

	function toggleRulerPlayback() {
		return persistBooleanPreference('playbackOnRulerClick', 'timeline-ruler-playback');
	}

	async function selectAtZeroCrossings() {
		// Selected clips are a selection: the snap takes the range they span and
		// leaves a drawn time range on the boundaries it found, so either way of
		// selecting audio ends with edges that sit on zero crossings.
		const projectAtStart = getProject();
		const selection = resolveSelectionRange(projectAtStart, { selectedClipId: state.selectedClipId });
		if (!projectAtStart || !selection || state.analysisProcessing) return null;
		const generation = ++zeroCrossingGeneration;
		const radius = Math.max(1, Math.round(projectSampleRate() * 0.01));
		const renderStart = Math.max(0, selection.startFrame - radius);
		const renderEnd = Math.min(projectDurationFrames(projectAtStart), selection.endFrame + radius);
		if (renderEnd <= renderStart) return null;
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
			const snapEdge = (frame: number) => frame < renderStart || frame >= renderEnd
				? frame
				: renderStart + findNearestAudioZeroCrossing(
					channels, frame - renderStart, { maximumDistance: radius },
				);
			const startFrame = snapEdge(selection.startFrame);
			const endFrame = snapEdge(selection.endFrame);
			const next = commit({
				type: 'selection/set',
				startFrame: Math.min(startFrame, endFrame),
				endFrame: Math.max(startFrame, endFrame),
				// A clip selection becomes the time selection it described, on
				// the tracks those clips sat on: the snapped edges are a range,
				// and leaving the clip identifiers behind would claim both.
				...(activeSelection() ? {} : { trackIds: selection.trackIds ?? [], clipIds: [] }),
			});
			setStatus(copy.zeroCrossingsAligned, 'success');
			return next.selection;
		} catch (error) {
			if (generation === zeroCrossingGeneration && getProject() === projectAtStart) handleError(error);
			return null;
		} finally {
			if (generation === zeroCrossingGeneration
				&& getProject()?.id === projectAtStart.id) {
				state.analysisProcessing = false;
				publishDocumentSnapshot();
			}
		}
	}

	function setSnapSettings(settings: CommandObject = {}) {
		const project = getProject();
		if (!project || !hasCoreEditingProjectAuthority(project)) throw new Error(copy.v2Required);
		return commit({ type: 'snap/set', settings });
	}

	function snapTimelineFrame(value: unknown, overrides: SelectionViewSnapOverrides = {}) {
		const project = getProject();
		const frame = Number(value);
		if (!Number.isFinite(frame)) throw new TypeError(copy.timelineFramesFinite);
		const rounded = Math.round(frame);
		if (!project || !hasCoreEditingProjectAuthority(project)) return Math.max(0, rounded);
		return snapAudioEditorFrameWithProject(rounded, project, { minimumFrame: 0, ...overrides });
	}

	function setZoom(pixelsPerSecond: unknown) {
		const project = getProject();
		if (!project) return state.pixelsPerSecond;
		const durationSeconds = editorTimelineDurationFrames(project, projectSampleRate()) / projectSampleRate();
		const minimum = state.timelineViewportWidth > 0 ? state.timelineViewportWidth / durationSeconds : 1;
		state.pixelsPerSecond = Math.max(
			minimum,
			Math.min(MAX_PIXELS_PER_SECOND, Number(pixelsPerSecond) || DEFAULT_PIXELS_PER_SECOND),
		);
		synchronizeAutomaticSampleEditMode();
		updatePlayhead(engine.getPositionFrames());
		publishDocumentSnapshot();
		return state.pixelsPerSecond;
	}

	return Object.freeze({
		clipNavigation,
		selectAll,
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
		setExactSelection,
		snapTimelineFrame,
		togglePinnedPlayhead,
		toggleRmsWaveform,
		toggleRulerPlayback,
		toggleScrollViewToPlayhead,
		toggleVerticalRulers,
	});
}

function isFiniteFrame(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function hasActiveTimelineAnnotations(project: SelectionViewProject): boolean {
	return isActiveAudioEditorProjectSchema(project)
		&& Array.isArray(project.timelineAnnotations);
}
