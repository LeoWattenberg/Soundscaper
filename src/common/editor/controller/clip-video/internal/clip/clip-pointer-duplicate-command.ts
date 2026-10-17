/* SPDX-License-Identifier: AGPL-3.0-only */
import { createClipboardDescriptor, preparePasteCommand } from '../../../../commands/clipboard-runtime.js';
import type { AudioEditorClipboard, AudioEditorCommand } from '../../../../commands/protocol.ts';
import type { ClipTransformClip, ClipTransformProject } from './clip-domain-types.ts';
import type { PreparedTransform } from './clip-transform-command-adapter.ts';

export interface ClipPointerDuplicateRuntime {
	createId(prefix: string): string;
	createDuplicateClipboard?: (project: ClipTransformProject, options: Readonly<{ startFrame: number; endFrame: number; trackIds: readonly string[]; clipIds: readonly string[] }>) => AudioEditorClipboard;
	prepareDuplicateCommand?: (descriptor: AudioEditorClipboard, command: AudioEditorCommand) => AudioEditorCommand;
}

/** Reuse the native duplicate carrier so camera links and product leaves keep their owner. */
export function prepareClipPointerDuplicateCommand(runtime: ClipPointerDuplicateRuntime, project: ClipTransformProject,
	activeClip: ClipTransformClip, clips: readonly ClipTransformClip[], transforms: readonly PreparedTransform[], before: readonly AudioEditorCommand[] = []) {
	const startFrame = Math.min(...clips.map(clip => clip.timelineStartFrame));
	const endFrame = Math.max(...clips.map(clip => clip.timelineStartFrame + clip.durationFrames));
	const selected = new Set(clips.map(clip => clip.id));
	const trackIds = project.tracks.filter(track => track.clipIds?.some(id => selected.has(id))).map(track => track.id);
	const options = { startFrame, endFrame, trackIds, clipIds: [...selected] };
	const descriptor = runtime.createDuplicateClipboard?.(project, options) ?? createClipboardDescriptor(project, options) as AudioEditorClipboard;
	const trackMap: Record<string, string> = {};
	for (const transform of transforms) {
		const owner = project.tracks.find(track => track.clipIds?.includes(transform.clipId));
		if (!owner || !transform.trackId) throw new RangeError('Duplicated clips require a destination track.');
		trackMap[owner.id] = transform.trackId;
	}
	const activeTransform = transforms.find(transform => transform.clipId === activeClip.id);
	if (!activeTransform) throw new RangeError('The active duplicate requires a destination.');
	const delta = Number(activeTransform.changes.timelineStartFrame) - activeClip.timelineStartFrame;
	const paste = preparePasteCommand(descriptor, { atFrame: startFrame + delta, trackMap, mode: 'overlap' }, (prefix = 'clip') => runtime.createId(prefix));
	const command: AudioEditorCommand = { type: 'batch', commands: [...before, paste] };
	const prepared = runtime.prepareDuplicateCommand?.(descriptor, command) ?? command;
	return { command: prepared, activeClipId: paste.clipIds?.[`${activeClip.id}:${activeClip.timelineStartFrame}:${activeClip.timelineStartFrame + activeClip.durationFrames}`] as string | undefined };
}
