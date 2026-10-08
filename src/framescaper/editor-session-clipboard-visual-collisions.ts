/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { sampleFrameToVideoFrame, scaleSampleFrame, type RationalRate } from '../common/editor/timeline-time.ts';
import {
	normalizeVideoGeneratorClipV1, normalizeVideoStillClipV1,
	type VideoGeneratorClipV1, type VideoStillClipV1,
} from '../common/editor/video-visual-model-v24.ts';
import type { FramescaperProjectFinishing } from './editor-project-finishing.ts';
import type { FramescaperProjectCommandFinishing } from './editor-project-finishing-commands.ts';

type VisualClip = VideoGeneratorClipV1 | VideoStillClipV1;
type Paste = Extract<AudioEditorCommand, { readonly type: 'clipboard/paste' }>;
interface CollisionGeometry {
	readonly clips: readonly Readonly<Record<string, unknown>>[];
	readonly tracks: readonly Readonly<{ id: string; clipIds?: readonly string[] }>[];
	readonly sequences: readonly Readonly<{ id: string; rate: RationalRate }>[];
	readonly sampleRate: number;
	readonly selection: Readonly<{ startFrame: number; endFrame: number; trackIds: readonly string[]; clipIds: readonly string[] }>;
}

/** Native pictures answer to the same overwrite/ripple span as inherited camera clips. */
export function prepareVisualClipboardCollisions(project: FramescaperProjectFinishing,
	command: AudioEditorCommand): Readonly<{
		foundationCommand: AudioEditorCommand;
		commands: readonly FramescaperProjectCommandFinishing[];
	}> {
	// The caller has validated finishing authority; its inherited index signature
	// intentionally leaves these canonical fields opaque to unrelated consumers.
	const current = project as unknown as CollisionGeometry;
	const clips = new Map<string, VisualClip>();
	for (const clip of current.clips) {
		if (clip.kind === 'generator') clips.set(String(clip.id), normalizeVideoGeneratorClipV1(clip));
		if (clip.kind === 'still') clips.set(String(clip.id), normalizeVideoStillClipV1(clip));
	}
	const owners = new Map(current.tracks.flatMap(track => Array.isArray(track.clipIds)
		? track.clipIds.map(id => [id, track.id] as const) : []));
	const commands: FramescaperProjectCommandFinishing[] = [];
	const removed = new Set<string>();
	const visit = (value: AudioEditorCommand): AudioEditorCommand => {
		if (value.type === 'batch') return { ...value, commands: value.commands.map(visit) };
		if (value.type !== 'clipboard/paste') return value;
		for (const id of value.collisionClipIds ?? []) {
			const clip = clips.get(id);
			if (!clip) continue;
			const trackId = owners.get(id);
			if (!trackId) throw new ReferenceError(`Visual paste collision ${id} has no picture track.`);
			const sequence = current.sequences.find(item => item.id === clip.sequenceId);
			if (!sequence) throw new ReferenceError('A visual paste collision requires its sequence clock.');
			const duration = Math.max(1, scaleSampleFrame(value.clipboard.durationFrames,
				value.clipboard.sampleRate, current.sampleRate, 'point'));
			const start = sampleFrameToVideoFrame(value.atFrame, sequence.rate, current.sampleRate, 'point');
			const count = Math.max(1, sampleFrameToVideoFrame(duration, sequence.rate, current.sampleRate, 'point'));
			const end = start + count;
			const clipStart = clip.sequenceStartFrame;
			const clipEnd = clipStart + clip.sequenceFrameCount;
			if (value.mode === 'overlap' && clipStart < end && clipEnd > start) {
				const left = clipStart < start ? segment(clip, clipStart, start, clip.id, clipStart) : null;
				const right = clipEnd > end ? segment(clip, end, clipEnd,
					left ? splitId(value, clip.id) : clip.id, end) : null;
				commands.push(mutation(clip, left ?? right, trackId));
				if (left && right) commands.push(mutation(null, right, trackId));
				if (!left && !right) removed.add(id);
			} else if (value.mode === 'insert-track' || value.mode === 'insert-all') {
				if (clipEnd <= start) continue;
				if (clipStart >= start) commands.push(mutation(clip, { ...clip, sequenceStartFrame: clipStart + count }, trackId));
				else {
					commands.push(mutation(clip, segment(clip, clipStart, start, clip.id, clipStart), trackId));
					commands.push(mutation(null, segment(clip, start, clipEnd, splitId(value, clip.id), end), trackId));
				}
			}
		}
		return Array.isArray(value.collisionClipIds)
			? { ...value, collisionClipIds: value.collisionClipIds.filter(id => !clips.has(id)) } : value;
	};
	const foundationCommand = visit(command);
	if (removed.size) {
		commands.unshift({ type: 'selection/set', startFrame: current.selection.startFrame,
			endFrame: current.selection.endFrame, trackIds: current.selection.trackIds,
			clipIds: current.selection.clipIds.filter(id => !removed.has(id)) });
		for (const presentation of project.videoVisualPresentations) {
			if (presentation.owner.kind === 'clip' && removed.has(presentation.owner.id)) commands.unshift({
				type: 'video-visual-presentation/set', presentationId: presentation.id,
				expectedPresentation: presentation, presentation: null,
			});
		}
	}
	return { foundationCommand, commands };
}

function splitId(paste: Paste, id: string): string {
	const result = paste.splitClipIds?.[id];
	if (!result) throw new TypeError(`A stable split visual clip ID is required for ${id}.`);
	return result;
}

function segment(clip: VisualClip, start: number, end: number, id: string, sequenceStartFrame: number): VisualClip {
	const placement = { ...clip, id, sequenceStartFrame, sequenceFrameCount: end - start };
	if (clip.kind === 'still') return normalizeVideoStillClipV1(placement);
	const ratio = clip.sourceFrameCount / clip.sequenceFrameCount;
	const elapsed = Math.min(clip.sourceFrameCount - 1, Math.round((start - clip.sequenceStartFrame) * ratio));
	const sourceEnd = Math.min(clip.sourceFrameCount, Math.round((end - clip.sequenceStartFrame) * ratio));
	return normalizeVideoGeneratorClipV1({ ...placement, sourceInFrame: clip.sourceInFrame + elapsed,
		sourceFrameCount: Math.max(1, sourceEnd - elapsed) });
}

function mutation(expectedClip: VisualClip | null, clip: VisualClip | null, trackId: string): FramescaperProjectCommandFinishing {
	const clipId = expectedClip?.id ?? clip?.id;
	if (!clipId) throw new TypeError('A native paste collision must retain a clip identity.');
	const placement = { scope: 'timeline' as const, trackId };
	return { type: 'video-visual-clip/set', clipId, expectedClip,
		expectedPlacement: expectedClip ? placement : null, clip, placement: clip ? placement : null };
}
