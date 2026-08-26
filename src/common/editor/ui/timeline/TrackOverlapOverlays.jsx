import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';

import { validateVideoTrackComposition } from '../../video-timeline.js';

export function createVideoOverlapPresentation(
	clips,
	overscanStartFrame,
	overscanEndFrame,
	pixelsPerSecond,
	sampleRate,
) {
	const ordered = clips
		.filter((clip) => !clip.isRecordingPreview && Number(clip.durationFrames) > 0)
		.slice()
		.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || String(left.id).localeCompare(String(right.id)));
	const overlaps = [];
	const invalidClipIds = new Set();
	let invalid = false;
	try {
		validateVideoTrackComposition({
			id: 'video-drag-preview',
			type: 'video',
			clipIds: ordered.map((clip) => clip.id),
		}, new Map(ordered.map((clip) => [clip.id, clip])));
	} catch {
		invalid = true;
	}
	for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
		const left = ordered[leftIndex];
		const leftStart = left.timelineStartFrame;
		const leftEnd = leftStart + left.durationFrames;
		for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
			const right = ordered[rightIndex];
			const rightStart = right.timelineStartFrame;
			const rightEnd = rightStart + right.durationFrames;
			if (rightStart >= leftEnd) break;
			const startFrame = Math.max(leftStart, rightStart);
			const endFrame = Math.min(leftEnd, rightEnd);
			if (endFrame <= startFrame) continue;
			const thirdClipActive = ordered.some((candidate, candidateIndex) => {
				if (candidateIndex === leftIndex || candidateIndex === rightIndex) return false;
				const candidateStart = candidate.timelineStartFrame;
				const candidateEnd = candidateStart + candidate.durationFrames;
				return candidateStart < endFrame && candidateEnd > startFrame;
			});
			const valid = leftStart < rightStart && leftEnd < rightEnd && !thirdClipActive;
			if (!valid) {
				invalid = true;
				invalidClipIds.add(left.id);
				invalidClipIds.add(right.id);
			}
			const visibleStartFrame = Math.max(startFrame, overscanStartFrame);
			const visibleEndFrame = Math.min(endFrame, overscanEndFrame);
			if (visibleEndFrame <= visibleStartFrame) continue;
			overlaps.push({
				id: `${left.id}:${right.id}:${startFrame}:${endFrame}`,
				left: CLIP_CONTENT_OFFSET
					+ (visibleStartFrame - overscanStartFrame) / sampleRate * pixelsPerSecond,
				width: Math.max(2, (visibleEndFrame - visibleStartFrame) / sampleRate * pixelsPerSecond),
				valid,
				label: valid
					? `Automatic crossfade between ${left.title || left.id} and ${right.title || right.id}`
					: `Invalid video overlap between ${left.title || left.id} and ${right.title || right.id}`,
			});
		}
	}
	return {
		invalid,
		invalidClipIds,
		overlays: overlaps,
	};
}

export function createCrossfadeOverlays(clips, overscanStartFrame, pixelsPerSecond, sampleRate) {
	const ordered = clips
		.filter((clip) => !clip.isRecordingPreview && clip.isVisible)
		.slice()
		.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || String(left.id).localeCompare(String(right.id)));
	const overlays = [];
	for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
		const left = ordered[leftIndex];
		const leftEnd = left.timelineStartFrame + left.durationFrames;
		for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
			const right = ordered[rightIndex];
			if (right.timelineStartFrame >= leftEnd) break;
			const startFrame = Math.max(left.timelineStartFrame, right.timelineStartFrame);
			const endFrame = Math.min(leftEnd, right.timelineStartFrame + right.durationFrames);
			if (endFrame <= startFrame) continue;
			overlays.push({
				id: `${left.id}:${right.id}:${startFrame}:${endFrame}`,
				left: (startFrame - overscanStartFrame) / sampleRate * pixelsPerSecond,
				width: Math.max(2, (endFrame - startFrame) / sampleRate * pixelsPerSecond),
				label: `Automatic crossfade between ${left.name || left.id} and ${right.name || right.id}`,
			});
		}
	}
	return overlays;
}

export function AutomaticCrossfadeOverlays({ overlays }) {
	return overlays.map((overlay) => (
		<div
			key={overlay.id}
			className={`audio-editor-automatic-crossfade${overlay.valid === false ? ' audio-editor-automatic-crossfade--invalid' : ''}`}
			data-automatic-crossfade={overlay.valid === false ? undefined : 'true'}
			data-invalid-video-overlap={overlay.valid === false ? 'true' : undefined}
			style={{ left: overlay.left, width: overlay.width }}
			role="img"
			aria-label={overlay.label}
			title={overlay.label}
		/>
	));
}
