/* SPDX-License-Identifier: AGPL-3.0-only */
import { clipCanLoop, clipHasLoopRepeats, clipLoopTransformFields, clipLoopUpdateFields, normalizeInactiveClipLoop, readClipLoop, trimClipLoopPeriod, type LoopAudioClip } from '../../audio-clip-loop.ts';
import { isAudioMediaKind } from '../../audio-media-kind.ts';
import { secondsToFrames } from '../../design-system-adapters/control-values.ts';

interface Session {
	readonly kind: string;
	readonly clipId: string;
	readonly trackId: string;
	readonly startX: number;
	readonly original: LoopAudioClip;
	readonly clipIds?: readonly string[];
	readonly originals?: Readonly<Record<string, LoopAudioClip>>;
}

export function sameLoopPointerClip(current: LoopAudioClip, original: LoopAudioClip): boolean {
	current = normalizeInactiveClipLoop(current);
	original = normalizeInactiveClipLoop(original);
	return current.sourceId === original.sourceId && current.durationFrames === original.durationFrames && current.timelineStartFrame === original.timelineStartFrame
		&& current.sourceStartFrame === original.sourceStartFrame && current.sourceDurationFrames === original.sourceDurationFrames
		&& current.reversed === original.reversed && JSON.stringify(readClipLoop(current)) === JSON.stringify(readClipLoop(original));
}

/** Preview and commit both use the final pointer position. */
export function loopPointerPreview(session: Session, sourceFrameCount: number, clientX: number, pixelsPerSecond: number, sampleRate: number) {
	if (!clipCanLoop(session.original) || !['clip-loop', 'trim-left', 'trim-right'].includes(session.kind)) return null;
	if (session.kind !== 'clip-loop' && !clipHasLoopRepeats(session.original)) return null;
	const original = normalizeInactiveClipLoop(session.original);
	const loop = readClipLoop(original) ?? { periodFrames: original.durationFrames, offsetFrames: 0 };
	const delta = Math.round((clientX - session.startX) * sampleRate / pixelsPerSecond);
	let loopChange;
	let guideFrame: number | null = null;
	if (session.kind === 'clip-loop') {
		let durationFrames = Math.max(1, original.durationFrames + delta);
		const boundary = Math.max(1, Math.round((durationFrames + loop.offsetFrames) / loop.periodFrames)) * loop.periodFrames - loop.offsetFrames;
		if (boundary > 0 && Math.abs(boundary - durationFrames) * pixelsPerSecond / sampleRate < 4) {
			durationFrames = boundary;
			guideFrame = (session.original.timelineStartFrame ?? 0) + boundary;
		}
		loopChange = { ...loop, durationFrames, sourceStartFrame: original.sourceStartFrame, sourceDurationFrames: original.sourceDurationFrames };
	} else loopChange = trimClipLoopPeriod(session.original, sourceFrameCount, session.kind === 'trim-left' ? 'left' : 'right', delta);
	return { clipId: session.clipId, trackId: session.trackId, ...clipLoopUpdateFields(original, loopChange), loopChange, guideFrame, waveformPreviewKind: 'trim' };
}

/** Keep the waveform and repetition boundaries in sync with the eventual stretch. */
export function clipStretchPointerPreview(session: Session, clientX: number, pixelsPerSecond: number, sampleRate: number,
	trackIdForClip: (clipId: string) => string | undefined = () => session.trackId) {
	const deltaFrames = secondsToFrames(Math.abs(clientX - session.startX) / pixelsPerSecond, { sampleRate }) * Math.sign(clientX - session.startX);
	const startFrame = session.original.timelineStartFrame ?? 0;
	const change = session.kind === 'stretch-left' ? Math.max(-startFrame, Math.min(session.original.durationFrames - 1, deltaFrames)) : 0;
	const durationFrames = session.kind === 'stretch-left' ? session.original.durationFrames - change : Math.max(1, session.original.durationFrames + deltaFrames);
	const originals = (session.clipIds ?? [session.clipId]).flatMap(clipId => {
		const clip = clipId === session.clipId ? session.original : session.originals?.[clipId];
		return clip && isAudioMediaKind(clip.kind) ? [{ clipId, clip }] : [];
	});
	let factor = durationFrames / session.original.durationFrames;
	if (session.kind === 'stretch-left' && originals.length > 1) {
		factor = Math.min(factor, ...originals.map(({ clip }) => ((clip.timelineStartFrame ?? 0) + clip.durationFrames) / clip.durationFrames));
	}
	const previewFor = (clipId: string, stored: LoopAudioClip) => {
		const original = normalizeInactiveClipLoop(stored);
		const nextDuration = Math.max(1, Math.round(original.durationFrames * factor));
		return {
			clipId, trackId: trackIdForClip(clipId), durationFrames: nextDuration,
			timelineStartFrame: (original.timelineStartFrame ?? 0) + (session.kind === 'stretch-left' ? original.durationFrames - nextDuration : 0),
			sourceStartFrame: original.sourceStartFrame, sourceDurationFrames: original.sourceDurationFrames,
			opaqueExtensions: original.opaqueExtensions,
			...clipLoopTransformFields(original, { durationFrames: nextDuration }),
			...(readClipLoop(stored) ? { waveformPreviewKind: 'rate-stretch' as const } : {}),
		};
	};
	const previews = originals.map(({ clipId, clip }) => previewFor(clipId, clip));
	const active = previews.find(preview => preview.clipId === session.clipId) ?? previewFor(session.clipId, session.original);
	return { ...active, ...(previews.length > 1 ? { previews } : {}) };
}
