/* SPDX-License-Identifier: AGPL-3.0-only */

import { clipHasLoopRepeats, readClipLoop, trimClipLoopPeriod } from '../../../../audio-clip-loop.ts';
import { resolveAudioWarpGroupTrimDelta } from '../../../../audio-warp-clip-edit.ts';
import type { AudioEditorCommand } from '../../../../commands/protocol.ts';
import { clipTrimSourceFrameCount } from '../../clip-trim-source-frame-count.ts';
import type { ClipTransformClip, ClipTransformProject } from './clip-domain-types.ts';
import { trimCommand } from './clip-transform-command-adapter.ts';

/** Looped members trim their period; ordinary members trim their own edge by the shared delta. */
export function prepareGroupedLoopTrimCommand(
	project: ClipTransformProject,
	clips: readonly ClipTransformClip[],
	edge: 'left' | 'right',
	requestedDelta: number,
	minimumDurationFrames = 1,
): AudioEditorCommand | null {
	let lowerBound = -Infinity, upperBound = Infinity;
	const sourceCount = (clip: ClipTransformClip) => {
		const source = project.sources.find(value => value.id === clip.sourceId);
		if (!source) throw new Error('Clip source not found.');
		return clipTrimSourceFrameCount(source);
	};
	for (const clip of clips) {
		const loop = clipHasLoopRepeats(clip) ? readClipLoop(clip) : null;
		const period = loop?.periodFrames ?? clip.durationFrames;
		const ratio = clip.sourceDurationFrames / period;
		const trimsSourceStart = (edge === 'left') !== Boolean(clip.reversed);
		const extension = trimsSourceStart ? clip.sourceStartFrame : sourceCount(clip) - clip.sourceStartFrame - clip.sourceDurationFrames;
		const extensionFrames = Math.floor(extension / ratio);
		const removableFrames = period - Math.min(period, Math.max(1, minimumDurationFrames));
		lowerBound = Math.max(lowerBound, edge === 'left' ? -Math.min(extensionFrames, loop ? Infinity : clip.timelineStartFrame) : -removableFrames);
		upperBound = Math.min(upperBound, edge === 'left' ? removableFrames : extensionFrames);
	}
	const delta = resolveAudioWarpGroupTrimDelta(project as unknown as Parameters<typeof resolveAudioWarpGroupTrimDelta>[0],
		clips as Parameters<typeof resolveAudioWarpGroupTrimDelta>[1], edge === 'left',
		{ deltaFrames: Math.max(lowerBound, Math.min(upperBound, requestedDelta)), lowerBound, upperBound });
	if (!delta) return null;
	const commands = clips.map((clip): AudioEditorCommand => {
		if (clipHasLoopRepeats(clip)) return { type: 'clip/update', clipId: clip.id,
			changes: { loop: trimClipLoopPeriod(clip, sourceCount(clip), edge, delta) } };
		const durationFrames = clip.durationFrames + (edge === 'left' ? -delta : delta);
		if (clip.warpMap != null) return trimCommand(clip.id, {
			...(edge === 'left' ? { timelineStartFrame: clip.timelineStartFrame + delta } : {}), durationFrames,
		});
		const sourceDurationFrames = Math.max(1, Math.round(clip.sourceDurationFrames * durationFrames / clip.durationFrames));
		const removed = clip.sourceDurationFrames - sourceDurationFrames;
		const trimsSourceStart = (edge === 'left') !== Boolean(clip.reversed);
		return trimCommand(clip.id, {
			...(edge === 'left' ? { timelineStartFrame: clip.timelineStartFrame + delta } : {}), durationFrames,
			sourceStartFrame: clip.sourceStartFrame + (trimsSourceStart ? removed : 0), sourceDurationFrames,
			trimStartFrames: Math.max(0, (clip.trimStartFrames ?? 0) + (trimsSourceStart ? removed : 0)),
			trimEndFrames: Math.max(0, (clip.trimEndFrames ?? 0) + (trimsSourceStart ? 0 : removed)),
		});
	});
	return commands.length === 1 ? commands[0]! : { type: 'batch', commands };
}
