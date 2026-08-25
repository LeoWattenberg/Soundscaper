/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { projectForCommandConsumers } from '../common/editor/project-current-runtime.ts';
import {
	applySoundscaperProjectCommandV29,
	snapshotSoundscaperProjectCommandV29,
	type SoundscaperNativePluginBindingCommandV29,
	type SoundscaperNativePluginStateCommandV29,
	type SoundscaperProjectCommandOptionsV29,
} from './editor-project-v29-commands.ts';
import {
	borrowSoundscaperProjectV29FromV30,
	restoreSoundscaperProjectV30FromV29,
} from './editor-project-v30-foundation.ts';
import {
	validateSoundscaperProjectV30,
	type SoundscaperProjectV30,
} from './editor-project-v30-validation.ts';

export type SoundscaperProjectCommandOptionsV30 = SoundscaperProjectCommandOptionsV29;
export type SoundscaperNativePluginBindingCommandV30 = SoundscaperNativePluginBindingCommandV29;
export type SoundscaperNativePluginStateCommandV30 = SoundscaperNativePluginStateCommandV29;

/** Snapshot V30 commands through the unchanged V29 command wire. */
export function snapshotSoundscaperProjectCommandV30(
	command: AudioEditorCommand | SoundscaperNativePluginStateCommandV30,
): AudioEditorCommand | SoundscaperNativePluginStateCommandV30 {
	return snapshotSoundscaperProjectCommandV29(command);
}

/** Run the inherited exact-V29 command owner while retaining V30 assistance custody. */
export function applySoundscaperProjectCommandV30(
	projectValue: SoundscaperProjectV30 | unknown,
	commandValue: AudioEditorCommand | SoundscaperNativePluginStateCommandV30,
	options: SoundscaperProjectCommandOptionsV30 = {},
): SoundscaperProjectV30 {
	validateSoundscaperProjectV30(projectValue);
	const borrowed = borrowSoundscaperProjectV29FromV30(projectValue);
	const applied = applySoundscaperProjectCommandV29(
		borrowed.project,
		commandValue,
		options,
	);
	if (applied === borrowed.project) return projectValue as SoundscaperProjectV30;
	return restoreSoundscaperProjectV30FromV29(applied, borrowed.assistanceAssets);
}

/** The shared command projection, now gated on exact V30 authority. */
export function soundscaperProjectForCommandConsumersV30(
	projectValue: SoundscaperProjectV30 | unknown,
): Record<string, unknown> {
	validateSoundscaperProjectV30(projectValue);
	return projectForCommandConsumers(
		projectValue as SoundscaperProjectV30 & Record<string, unknown>,
	) as Record<string, unknown>;
}
