/* SPDX-License-Identifier: AGPL-3.0-only */
import { clipLoopUpdateFields, readClipLoop, trimClipLoopPeriod, type LoopAudioClip } from '../../audio-clip-loop.ts';

interface Session {
	readonly kind: string;
	readonly clipId: string;
	readonly trackId: string;
	readonly startX: number;
	readonly original: LoopAudioClip;
}

export function sameLoopPointerClip(current: LoopAudioClip, original: LoopAudioClip): boolean {
	return current.sourceId === original.sourceId && current.durationFrames === original.durationFrames && current.timelineStartFrame === original.timelineStartFrame
		&& current.sourceStartFrame === original.sourceStartFrame && current.sourceDurationFrames === original.sourceDurationFrames
		&& current.reversed === original.reversed && JSON.stringify(readClipLoop(current)) === JSON.stringify(readClipLoop(original));
}

/** Preview and commit both use the final pointer position. */
export function loopPointerPreview(session: Session, sourceFrameCount: number, clientX: number, pixelsPerSecond: number, sampleRate: number) {
	const loop = readClipLoop(session.original);
	if (!loop || !['clip-loop', 'trim-left', 'trim-right'].includes(session.kind)) return null;
	const delta = Math.round((clientX - session.startX) * sampleRate / pixelsPerSecond);
	let loopChange;
	let guideFrame: number | null = null;
	if (session.kind === 'clip-loop') {
		let durationFrames = Math.max(1, session.original.durationFrames + delta);
		const boundary = Math.max(1, Math.round((durationFrames + loop.offsetFrames) / loop.periodFrames)) * loop.periodFrames - loop.offsetFrames;
		if (boundary > 0 && Math.abs(boundary - durationFrames) * pixelsPerSecond / sampleRate < 4) {
			durationFrames = boundary;
			guideFrame = (session.original.timelineStartFrame ?? 0) + boundary;
		}
		loopChange = { periodFrames: loop.periodFrames, durationFrames };
	} else loopChange = trimClipLoopPeriod(session.original, sourceFrameCount, session.kind === 'trim-left' ? 'left' : 'right', delta);
	return { clipId: session.clipId, trackId: session.trackId, ...clipLoopUpdateFields(session.original, loopChange), loopChange, guideFrame, waveformPreviewKind: 'trim' };
}
