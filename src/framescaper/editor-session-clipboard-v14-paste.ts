/* SPDX-License-Identifier: AGPL-3.0-only */

import { snapshotInertEditorCommand } from '../common/editor/commands/editor-command-snapshot.ts';
import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import type { CurrentAudioEditorMutationCommandV2 } from '../common/editor/commands/clipboard-command-v2.ts';
import { normalizeAudioEditorClipboardDescriptorV7, type AudioEditorClipboardV7 } from '../common/editor/commands/clipboard-codec-v7.ts';
import { CUBE_LUT_PROFILE_EFFECT_TYPE_V1 } from '../common/editor/video-cube-lut-profile-v1.ts';
import { FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import type { FramescaperProjectCommand } from './editor-project-commands.ts';
import { prepareFramescaperSessionClipboardPasteV13, type FramescaperSessionClipboardPasteV13 } from './editor-session-clipboard-v13-paste.ts';
import { framescaperClipboardDescriptorMetadataProjectionV14, framescaperClipboardProjectMetadataProjectionV14 } from './editor-session-clipboard-resource-projection-v14.ts';
import { normalizeFramescaperSessionClipboardV14, framescaperSessionClipboardMetadataProjectionV14, type FramescaperSessionClipboardV14 } from './editor-session-clipboard-v14.ts';

type DataRecord = Record<string, unknown>;
export interface FramescaperSessionClipboardPasteV14 extends Omit<FramescaperSessionClipboardPasteV13, 'command' | 'foundationCommand'> {
	readonly command: FramescaperProjectCommand;
	readonly foundationCommand: FramescaperProjectCommand;
	readonly cubeLuts: FramescaperSessionClipboardV14['cubeLuts'];
}

/** Existing rich metadata allocation is resource-free and transient. Restore
 * the single complete descriptor and its already allocated effect IDs before
 * the named current command owner admits/publishes any authored leaf. */
export function prepareFramescaperSessionClipboardPasteV14(profile: unknown, project: unknown, value: unknown,
	baseValue: CurrentAudioEditorMutationCommandV2, createId: (prefix?: string) => string): FramescaperSessionClipboardPasteV14 {
	const metadataProject = framescaperClipboardProjectMetadataProjectionV14(profile, project);
	const clipboard = normalizeFramescaperSessionClipboardV14(value);
	const base = snapshotInertEditorCommand(baseValue, 'Frame14 clipboard command');
	const originalPaste = findPaste(base);
	const descriptor = normalizeAudioEditorClipboardDescriptorV7(originalPaste.clipboard);
	if (JSON.stringify(descriptor) !== JSON.stringify(clipboard.descriptor)) throw new RangeError('The Frame14 clipboard and paste descriptors must match exactly.');
	const projected = projectCommand(base, descriptor);
	const prepared = prepareFramescaperSessionClipboardPasteV13(FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE,
		metadataProject, framescaperSessionClipboardMetadataProjectionV14(clipboard), projected, createId);
	return Object.freeze({ ...prepared,
		command: restoreCommand(prepared.command, descriptor, originalPaste),
		foundationCommand: restoreCommand(prepared.foundationCommand, descriptor, originalPaste), cubeLuts: clipboard.cubeLuts });
}

function projectCommand(value: unknown, descriptor: AudioEditorClipboardV7): AudioEditorCommand {
	const command = structuredClone(value) as DataRecord;
	if (command.type === 'batch') command.commands = (command.commands as readonly unknown[]).map(child => projectCommand(child, descriptor));
	if (command.type === 'clipboard/paste') {
		command.clipboard = framescaperClipboardDescriptorMetadataProjectionV14(descriptor);
		const ids = command.videoEffectIds as Readonly<Record<string, readonly string[]>>;
		command.videoEffectIds = Object.fromEntries(descriptor.tracks.flatMap(track => track.clips.map(clip => {
			const key = clip.key as string;
			const effects = (clip.videoEffects ?? []) as readonly Readonly<Record<string, unknown>>[];
			return [key, effects.flatMap((effect, index) => effect.type === CUBE_LUT_PROFILE_EFFECT_TYPE_V1 ? [] : [ids[key]?.[index]])];
		})));
	}
	return command as AudioEditorCommand;
}

function restoreCommand(value: unknown, descriptor: AudioEditorClipboardV7, originalPaste: DataRecord): FramescaperProjectCommand {
	const command = structuredClone(value) as DataRecord;
	if (command.type === 'batch') command.commands = (command.commands as readonly unknown[]).map(child => restoreCommand(child, descriptor, originalPaste));
	if (command.type === 'clipboard/paste') {
		const full = new Map(descriptor.tracks.flatMap(track => track.clips.map(clip => [clip.key, clip] as const)));
		const projected = command.clipboard as AudioEditorClipboardV7;
		const tracks = projected.tracks.map(track => ({ ...track, clips: track.clips.map(clip => {
				const original = full.get(clip.key);
				if (!original) throw new ReferenceError('Frame14 prepared paste lost its descriptor binding.');
				return { ...clip, ...(original.videoEffects === undefined ? {} : { videoEffects: original.videoEffects }),
					...(original.videoKeyframes === undefined ? {} : { videoKeyframes: original.videoKeyframes }) };
			}) }));
		command.clipboard = normalizeAudioEditorClipboardDescriptorV7({ ...projected, schemaVersion: 7, tracks });
		const ids = originalPaste.videoEffectIds as Readonly<Record<string, readonly string[]>>;
		command.videoEffectIds = Object.fromEntries(projected.tracks.flatMap(track => track.clips.flatMap(clip =>
			Object.hasOwn(ids, clip.key as string) ? [[clip.key, ids[clip.key as string]]] : [])));
	}
	return command as FramescaperProjectCommand;
}

function findPaste(value: unknown): DataRecord {
	const matches: DataRecord[] = [], stack = [value];
	while (stack.length > 0) {
		const command = stack.pop() as DataRecord;
		if (command.type === 'batch') stack.push(...command.commands as readonly unknown[]);
		if (command.type === 'clipboard/paste') matches.push(command);
	}
	if (matches.length !== 1) throw new RangeError('Frame14 paste requires exactly one clipboard command.');
	return matches[0]!;
}
