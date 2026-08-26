/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import {
	applyAssistanceAssetUpsertCommandV1,
	hasAssistanceAssetUpsertCommandTypeV1,
	snapshotAssistanceAssetUpsertCommandV1,
	type AssistanceAssetUpsertCommandV1,
} from '../common/editor/assistance/assistance-asset-command-v1.ts';
import { projectForCommandConsumers } from '../common/editor/project-current-runtime.ts';
import { reconcileProjectOwnedFeatureRequirements } from '../common/editor/project-owned-feature-requirements.ts';
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
	reconcileSoundscaperProjectFeatureRequirementsV30,
} from './editor-project-feature-requirements-v30.ts';
import {
	validateSoundscaperProjectV30,
	type SoundscaperProjectV30,
} from './editor-project-v30-validation.ts';

export type SoundscaperProjectCommandOptionsV30 = SoundscaperProjectCommandOptionsV29;
export type SoundscaperNativePluginBindingCommandV30 = SoundscaperNativePluginBindingCommandV29;
export type SoundscaperNativePluginStateCommandV30 = SoundscaperNativePluginStateCommandV29;
export type SoundscaperProjectCommandV30 =
	| AudioEditorCommand
	| SoundscaperNativePluginStateCommandV30
	| AssistanceAssetUpsertCommandV1;

/** Snapshot V30's assistance command or the inherited V29 command wire. */
export function snapshotSoundscaperProjectCommandV30(
	command: SoundscaperProjectCommandV30,
): SoundscaperProjectCommandV30 {
	if (hasAssistanceAssetUpsertCommandTypeV1(command)) {
		return snapshotAssistanceAssetUpsertCommandV1(command);
	}
	return snapshotSoundscaperProjectCommandV29(command);
}

/** Run the inherited exact-V29 command owner while retaining V30 assistance custody. */
export function applySoundscaperProjectCommandV30(
	projectValue: SoundscaperProjectV30 | unknown,
	commandValue: SoundscaperProjectCommandV30,
	options: SoundscaperProjectCommandOptionsV30 = {},
): SoundscaperProjectV30 {
	validateSoundscaperProjectV30(projectValue);
	const project = projectValue as SoundscaperProjectV30;
	const command = snapshotSoundscaperProjectCommandV30(commandValue);
	if (hasAssistanceAssetUpsertCommandTypeV1(command)) {
		return applyAssistanceCommand(
			project,
			snapshotAssistanceAssetUpsertCommandV1(command),
			options,
		);
	}
	const borrowed = borrowSoundscaperProjectV29FromV30(projectValue);
	const applied = applySoundscaperProjectCommandV29(
		borrowed.project,
		command,
		options,
	);
	if (applied === borrowed.project) return projectValue as SoundscaperProjectV30;
	return restoreSoundscaperProjectV30FromV29(applied, borrowed.assistanceAssets);
}

function applyAssistanceCommand(
	project: SoundscaperProjectV30,
	command: AssistanceAssetUpsertCommandV1,
	options: SoundscaperProjectCommandOptionsV30,
): SoundscaperProjectV30 {
	const assistanceAssets = applyAssistanceAssetUpsertCommandV1(project.assistanceAssets, command);
	if (command.commands.length > 0) {
		const borrowed = borrowSoundscaperProjectV29FromV30(project);
		const childCommand: AudioEditorCommand = command.commands.length === 1
			? command.commands[0]!
			: { type: 'batch', commands: command.commands };
		const applied = applySoundscaperProjectCommandV29(borrowed.project, childCommand, options);
		if (applied !== borrowed.project) {
			return restoreSoundscaperProjectV30FromV29(applied, assistanceAssets);
		}
	}
	return finalizeAssistanceCommand(project, assistanceAssets, options);
}

function finalizeAssistanceCommand(
	project: SoundscaperProjectV30,
	assistanceAssets: SoundscaperProjectV30['assistanceAssets'],
	options: SoundscaperProjectCommandOptionsV30,
): SoundscaperProjectV30 {
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	draft.assistanceAssets = assistanceAssets;
	const revision = Number(project.revision) + 1;
	if (!Number.isSafeInteger(revision)) {
		throw new RangeError('Soundscaper V30 project revision overflowed.');
	}
	draft.revision = revision;
	draft.updatedAt = timestamp(options.now);
	draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		draft,
		draft.featureRequirements as never,
	);
	draft.featureRequirements = reconcileSoundscaperProjectFeatureRequirementsV30(
		draft,
		draft.featureRequirements as never,
	);
	validateSoundscaperProjectV30(draft);
	return draft as unknown as SoundscaperProjectV30;
}

function timestamp(now: Date | string | undefined): string {
	if (typeof now === 'string') return new Date(now).toISOString();
	return (now ?? new Date()).toISOString();
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
