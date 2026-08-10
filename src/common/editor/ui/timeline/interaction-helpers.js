import {
	AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE,
	getActiveProjectBinDragPayload,
	parseProjectBinDragPayload,
} from '../../project-bin-dnd.js';

const VIEWPORT_MENU_MARGIN = 8;
const VIEWPORT_MENU_WIDTH = 220;
// Mirrors the packaged menu metrics: 4px padding plus 1px border per edge,
// 32px per item, and a 1px rule inside 4px margins per divider.
const VIEWPORT_MENU_FRAME = 10;
const VIEWPORT_MENU_ITEM_HEIGHT = 32;
const VIEWPORT_MENU_DIVIDER_HEIGHT = 9;

export function dataTransferHasType(dataTransfer, type) {
	return Array.from(dataTransfer?.types || []).includes(type);
}

export function viewportMenuPlacement(anchor, items) {
	const rect = anchor?.getBoundingClientRect?.();
	if (!rect) return null;
	const menuHeight = VIEWPORT_MENU_FRAME + (items || []).reduce(
		(height, item) => height + (item.divider ? VIEWPORT_MENU_DIVIDER_HEIGHT : VIEWPORT_MENU_ITEM_HEIGHT),
		0,
	);
	const spaceBelow = globalThis.innerHeight - rect.bottom - VIEWPORT_MENU_MARGIN;
	const spaceAbove = rect.top - VIEWPORT_MENU_MARGIN;
	// Keep the menu under the control that opened it whenever that side has the most
	// room; a menu too tall for either side scrolls instead of covering its trigger.
	const opensDown = menuHeight <= spaceBelow || spaceBelow >= spaceAbove;
	const top = opensDown ? rect.bottom : Math.max(VIEWPORT_MENU_MARGIN, rect.top - menuHeight);
	const left = Math.max(
		VIEWPORT_MENU_MARGIN,
		Math.min(rect.left, globalThis.innerWidth - VIEWPORT_MENU_WIDTH - VIEWPORT_MENU_MARGIN),
	);
	const placed = { ...rect, top, bottom: top, left, right: left + rect.width };
	return {
		maxHeight: Math.max(
			VIEWPORT_MENU_FRAME + VIEWPORT_MENU_ITEM_HEIGHT,
			globalThis.innerHeight - top - VIEWPORT_MENU_MARGIN,
		),
		anchorEl: { getBoundingClientRect: () => placed },
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
			waveformPreviewKind: 'trim',
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
