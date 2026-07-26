import { useCallback, useEffect } from 'react';

import { AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE } from '../../project-bin-dnd.js';
import { compatibleMediaTrack } from './geometry.ts';
import { NEW_AUDIO_TRACK_DROP_TARGET } from './constants.ts';
import {
	dataTransferHasType,
	projectBinPayloadFromDataTransfer,
} from './interaction-helpers.js';

export function useTimelineProjectBinDnd({
	controller,
	mutationsBlocked,
	state,
	model,
	hitTesting,
	menuActions,
}) {
	const { setDraggingClipIds, setProjectBinDragPreview } = state;
	const { project } = model;
	const { clearProjectBinDragState, timelineDropTargetAt } = hitTesting;
	const { run } = menuActions;

	const onTimelineDragOver = useCallback((event) => {
		const binDrag = dataTransferHasType(event.dataTransfer, AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE);
		const fileDrag = dataTransferHasType(event.dataTransfer, 'Files');
		if (!binDrag && !fileDrag) return;
		event.preventDefault();
		if (mutationsBlocked || !project) {
			event.dataTransfer.dropEffect = 'none';
			clearProjectBinDragState();
			return;
		}
		event.dataTransfer.dropEffect = 'copy';
		if (!binDrag) {
			setProjectBinDragPreview(null);
			setDraggingClipIds(null);
			return;
		}
		const payload = projectBinPayloadFromDataTransfer(event.dataTransfer);
		const clip = payload && String(payload.projectId) === String(project.id)
			? project.projectBin?.clips.find((item) => String(item.id) === String(payload.clipId))
			: null;
		if (!clip) {
			event.dataTransfer.dropEffect = 'none';
			clearProjectBinDragState();
			return;
		}
		const target = timelineDropTargetAt(event);
		const itemClips = clip.binItemId
			? project.projectBin.clips.filter((candidate) => candidate.binItemId === clip.binItemId)
			: [clip];
		const compatibleTracks = itemClips.map((itemClip) => (
			target.trackId ? compatibleMediaTrack(project, target.trackId, itemClip.kind) : null
		));
		const previewCreatesTrack = target.createTrack
			|| Boolean(target.trackId && compatibleTracks.some((candidate) => !candidate));
		const previews = itemClips.map((itemClip, index) => {
			const previewTrack = compatibleTracks[index];
			return {
				clip: itemClip,
				clipId: itemClip.id,
				trackId: previewCreatesTrack
					? `${NEW_AUDIO_TRACK_DROP_TARGET}-${index}`
					: previewTrack?.id || target.trackId,
				timelineStartFrame: target.timelineStartFrame,
			};
		});
		const activePreview = previews.find((preview) => preview.clipId === clip.id) || previews[0];
		const preview = {
			...activePreview,
			createTrack: previewCreatesTrack,
			previews,
		};
		setProjectBinDragPreview((current) => (
			current?.clipId === preview.clipId
			&& current.trackId === preview.trackId
			&& current.timelineStartFrame === preview.timelineStartFrame
			&& current.createTrack === preview.createTrack
				? current
				: preview
		));
		setDraggingClipIds((current) => (
			current?.size === previews.length
			&& previews.every((item) => current.has(String(item.clipId)))
				? current
				: new Set(previews.map((item) => String(item.clipId)))
		));
	}, [clearProjectBinDragState, mutationsBlocked, project, timelineDropTargetAt]);

	const onTimelineDragLeave = useCallback((event) => {
		const rect = event.currentTarget.getBoundingClientRect();
		if (
			event.clientX >= rect.left
			&& event.clientX < rect.right
			&& event.clientY >= rect.top
			&& event.clientY < rect.bottom
		) return;
		clearProjectBinDragState();
	}, [clearProjectBinDragState]);

	const onTimelineDrop = useCallback((event) => {
		const binDrag = dataTransferHasType(event.dataTransfer, AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE);
		const files = [...(event.dataTransfer?.files || [])];
		if (!binDrag && !files.length) return;
		event.preventDefault();
		const payload = binDrag ? projectBinPayloadFromDataTransfer(event.dataTransfer) : null;
		const target = timelineDropTargetAt(event);
		clearProjectBinDragState(true);
		if (mutationsBlocked || !project) return;
		if (payload) {
			if (String(payload.projectId) !== String(project.id)) return;
			const clip = project.projectBin?.clips.find((item) => String(item.id) === String(payload.clipId));
			if (!clip) return;
			run(() => controller.actions.projectBin.place(clip.id, {
				...(target.trackId ? { trackId: target.trackId } : {}),
				timelineStartFrame: target.timelineStartFrame,
			}));
			return;
		}
		if (files.length) {
			run(() => controller.actions.project.importFiles(files, {
				destination: 'timeline',
				...(target.trackId ? { trackId: target.trackId } : {}),
				timelineStartFrame: target.timelineStartFrame,
			}));
		}
	}, [clearProjectBinDragState, controller, mutationsBlocked, project, run, timelineDropTargetAt]);

	useEffect(() => {
		const finishHtmlDrag = () => clearProjectBinDragState(true);
		globalThis.addEventListener('dragend', finishHtmlDrag, true);
		return () => globalThis.removeEventListener('dragend', finishHtmlDrag, true);
	}, [clearProjectBinDragState]);

	return { onTimelineDragOver, onTimelineDragLeave, onTimelineDrop };
}
