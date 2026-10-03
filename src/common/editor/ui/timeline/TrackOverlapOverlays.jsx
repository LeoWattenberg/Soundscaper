import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';

import { automaticClipCrossfadeRanges, findPartialClipOverlaps } from '../../audio-clip-overlap.ts';
import { DEFAULT_CLIP_MICROFADE_SECONDS } from '../../clip-microfade.ts';
import { analyzeVideoClipOverlaps, projectVideoOverlapPresentation } from './video-overlap-presentation.ts';
import {
	clipCrossfadeCurvePath,
	crossfadeIntersection,
	MAXIMUM_CROSSFADE_POSITION,
	MINIMUM_CROSSFADE_POSITION,
} from './crossfade-visual-geometry.ts';

export function createVideoOverlapPresentation(
	clips,
	overscanStartFrame,
	overscanEndFrame,
	pixelsPerSecond,
	sampleRate,
) {
	return projectVideoOverlapPresentation(
		analyzeVideoClipOverlaps(clips), overscanStartFrame, overscanEndFrame, pixelsPerSecond, sampleRate,
	);
}

export function createCrossfadeOverlays(clips, overscanStartFrame, pixelsPerSecond, sampleRate) {
	const visibleClips = clips.filter((clip) => !clip.isRecordingPreview && clip.isVisible);
	const accessors = {
		id: (clip) => clip.id,
		startFrame: (clip) => clip.timelineStartFrame,
		durationFrames: (clip) => clip.durationFrames,
	};
	const ranges = automaticClipCrossfadeRanges(visibleClips, accessors);
	return findPartialClipOverlaps(visibleClips, accessors).filter(({ startFrame, endFrame }) => (
		pixelsPerSecond >= sampleRate
		|| endFrame - startFrame > Math.max(1, Math.round(sampleRate * DEFAULT_CLIP_MICROFADE_SECONDS))
	)).map(({ left, right, startFrame, endFrame }) => {
		const intersection = crossfadeIntersection(left.fadeOutShape ?? 1, right.fadeInShape ?? 1);
		return {
			id: `${left.id}:${right.id}:${startFrame}:${endFrame}`,
			outgoingClipId: String(left.id),
			incomingClipId: String(right.id),
			startFrame,
			endFrame,
			left: CLIP_CONTENT_OFFSET
				+ (startFrame - overscanStartFrame) / sampleRate * pixelsPerSecond,
			width: Math.max(2, (endFrame - startFrame) / sampleRate * pixelsPerSecond),
			label: `Automatic crossfade between ${left.name || left.id} and ${right.name || right.id}`,
			outgoingPath: clipCrossfadeCurvePath(left, ranges.get(String(left.id)) ?? {
				crossfadeInRanges: [], crossfadeOutRanges: [],
			}, startFrame, endFrame, 'out'),
			incomingPath: clipCrossfadeCurvePath(right, ranges.get(String(right.id)) ?? {
				crossfadeInRanges: [], crossfadeOutRanges: [],
			}, startFrame, endFrame, 'in'),
			intersectionPosition: intersection.position,
			intersectionGain: intersection.gain,
			minimumPosition: MINIMUM_CROSSFADE_POSITION,
			maximumPosition: MAXIMUM_CROSSFADE_POSITION,
		};
	});
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
