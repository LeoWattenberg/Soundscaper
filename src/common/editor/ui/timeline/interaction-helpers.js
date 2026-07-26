import {
	AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE,
	getActiveProjectBinDragPayload,
	parseProjectBinDragPayload,
} from '../../project-bin-dnd.js';

const VIEWPORT_MENU_MARGIN = 8;

export function dataTransferHasType(dataTransfer, type) {
	return Array.from(dataTransfer?.types || []).includes(type);
}

export function viewportMenuAnchor(anchor, items) {
	if (!anchor?.getBoundingClientRect) return null;
	return {
		getBoundingClientRect() {
			const rect = anchor.getBoundingClientRect();
			const menuHeight = 10 + (items || []).reduce((height, item) => height + (item.divider ? 9 : 32), 0);
			const menuWidth = 220;
			const top = rect.bottom + menuHeight <= globalThis.innerHeight - VIEWPORT_MENU_MARGIN
				? rect.bottom
				: Math.max(VIEWPORT_MENU_MARGIN, rect.top - menuHeight);
			const left = Math.max(
				VIEWPORT_MENU_MARGIN,
				Math.min(rect.left, globalThis.innerWidth - menuWidth - VIEWPORT_MENU_MARGIN),
			);
			return { ...rect, top, bottom: top, left, right: left + rect.width };
		},
	};
}

export function projectBinPayloadFromDataTransfer(dataTransfer) {
	let serialized = '';
	try {
		serialized = dataTransfer?.getData?.(AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE) || '';
	} catch {
		// Browsers can protect drag data until drop; the in-memory payload covers same-document drags.
	}
	return parseProjectBinDragPayload(serialized) || getActiveProjectBinDragPayload();
}


export function createClipTrimPreview(projectIndex, session, requestedDelta, edge) {
	const originals = session.clipIds
		.map((clipId) => session.originals?.[clipId])
		.filter(Boolean);
	if (!originals.length) return null;
	let lowerBound = Number.NEGATIVE_INFINITY;
	let upperBound = Number.POSITIVE_INFINITY;
	for (const clip of originals) {
		const source = projectIndex.sourceById.get(clip.sourceId);
		if (!source) return null;
		const sourceDurationFrames = clip.sourceDurationFrames || clip.durationFrames;
		const sourceFramesPerTimelineFrame = sourceDurationFrames / clip.durationFrames;
		const sourceExtension = edge === 'left'
			? (clip.reversed
				? source.frameCount - clip.sourceStartFrame - sourceDurationFrames
				: clip.sourceStartFrame)
			: (clip.reversed
				? clip.sourceStartFrame
				: source.frameCount - clip.sourceStartFrame - sourceDurationFrames);
		if (edge === 'left') {
			lowerBound = Math.max(
				lowerBound,
				-Math.min(clip.timelineStartFrame, Math.floor(sourceExtension / sourceFramesPerTimelineFrame)),
			);
			upperBound = Math.min(upperBound, clip.durationFrames - 1);
		} else {
			lowerBound = Math.max(lowerBound, 1 - clip.durationFrames);
			upperBound = Math.min(upperBound, Math.floor(sourceExtension / sourceFramesPerTimelineFrame));
		}
	}
	const deltaFrames = Math.max(lowerBound, Math.min(upperBound, requestedDelta));
	const previews = originals.map((clip) => {
		const source = projectIndex.sourceById.get(clip.sourceId);
		const track = projectIndex.trackByClipId.get(clip.id);
		const sourceDurationFrames = clip.sourceDurationFrames || clip.durationFrames;
		const durationFrames = edge === 'left'
			? clip.durationFrames - deltaFrames
			: clip.durationFrames + deltaFrames;
		const sourceExtension = edge === 'left'
			? (clip.reversed
				? source.frameCount - clip.sourceStartFrame - sourceDurationFrames
				: clip.sourceStartFrame)
			: (clip.reversed
				? clip.sourceStartFrame
				: source.frameCount - clip.sourceStartFrame - sourceDurationFrames);
		const nextSourceDurationFrames = Math.max(1, Math.min(
			sourceDurationFrames + sourceExtension,
			Math.round(sourceDurationFrames * durationFrames / clip.durationFrames),
		));
		const removedSourceFrames = sourceDurationFrames - nextSourceDurationFrames;
		const trimsSourceStart = edge === 'left' ? !clip.reversed : clip.reversed;
		return {
			clipId: clip.id,
			trackId: track?.id,
			...(edge === 'left' ? {
				timelineStartFrame: clip.timelineStartFrame + deltaFrames,
				sourceStartFrame: clip.sourceStartFrame + (clip.reversed ? 0 : removedSourceFrames),
			} : {
				timelineStartFrame: clip.timelineStartFrame,
				sourceStartFrame: clip.reversed
					? clip.sourceStartFrame + removedSourceFrames
					: clip.sourceStartFrame,
			}),
			sourceDurationFrames: nextSourceDurationFrames,
			durationFrames,
			trimStartFrames: Math.max(0, (clip.trimStartFrames || 0) + (trimsSourceStart ? removedSourceFrames : 0)),
			trimEndFrames: Math.max(0, (clip.trimEndFrames || 0) + (trimsSourceStart ? 0 : removedSourceFrames)),
			fadeInFrames: Math.min(clip.fadeInFrames || 0, durationFrames),
			fadeOutFrames: Math.min(clip.fadeOutFrames || 0, durationFrames),
		};
	});
	const active = previews.find((preview) => preview.clipId === session.clipId);
	return active ? { ...active, previews } : null;
}
