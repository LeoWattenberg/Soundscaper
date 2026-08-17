/* SPDX-License-Identifier: AGPL-3.0-only */

import { createMasteringSequenceRuntimeHandlers } from '../common/editor/commands/mastering-sequence-runtime.ts';
import { snapshotInertEditorCommand } from '../common/editor/commands/editor-command-snapshot.ts';
import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import {
	SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION,
} from '../common/editor/project-schema-version.ts';
import { projectForCommandConsumers } from '../common/editor/project-current-runtime.ts';
import { reconcileProjectOwnedFeatureRequirements } from '../common/editor/project-owned-feature-requirements.ts';
import {
	applySoundscaperProjectCommandV21,
	type SoundscaperProjectCommandOptionsV21,
} from './editor-project-v21-commands.ts';
import { reconcileSoundscaperProjectFeatureRequirementsV23 } from './editor-project-feature-requirements-v23.ts';
import {
	normalizeMasteringSequencesV23,
	validateSoundscaperProjectV23,
	type SoundscaperProjectV23,
} from './editor-project-v23-validation.ts';

/**
 * Applying commands to an exact V23 document.
 *
 * **Mastering-sequence commands never reach the inherited command path.** That
 * path deliberately rebuilds `mixer` and `automationLanes` from the *previous*
 * project and reconciles feature requirements, discarding whatever a command
 * wrote to product-owned state. Product-owned state therefore gets an explicit
 * branch, exactly as automation lanes, the mixer graph and freeze already do —
 * falling through would not fail, it would silently drop the edit.
 *
 * **Every other command is lent to the V21 applier.** V23 adds one field that no
 * V21 command reads or writes, so borrowing gives V23 precisely V21's semantics
 * for the hundred-odd inherited commands instead of a second copy of them that
 * can drift. The field is detached for the borrowed pass and reattached
 * afterwards; the manifest is reconciled down first so it agrees with the state
 * V21 is about to validate, and reconciled back up after.
 */

export type SoundscaperProjectCommandOptionsV23 = SoundscaperProjectCommandOptionsV21;

const MASTERING_HANDLERS = createMasteringSequenceRuntimeHandlers();

export function snapshotSoundscaperProjectCommandV23(command: AudioEditorCommand): AudioEditorCommand {
	return snapshotInertEditorCommand(command, 'Soundscaper V23 command');
}

export function applySoundscaperProjectCommandV23(
	projectValue: SoundscaperProjectV23 | unknown,
	commandValue: AudioEditorCommand,
	options: SoundscaperProjectCommandOptionsV23 = {},
): SoundscaperProjectV23 {
	validateSoundscaperProjectV23(projectValue);
	const project = projectValue as SoundscaperProjectV23;
	const command = snapshotSoundscaperProjectCommandV23(commandValue);
	if (commandTouchesMasteringSequences(command)) {
		return applyMasteringSequenceCommand(project, command, options);
	}
	return applyInheritedCommand(project, command, options);
}

/** True for a mastering-sequence command, including one nested inside a batch. */
/** The V10 projection command consumers read, gated on exact V23 authority. */
export function soundscaperProjectForCommandConsumersV23(
	projectValue: SoundscaperProjectV23 | unknown,
): Record<string, unknown> {
	validateSoundscaperProjectV23(projectValue);
	return projectForCommandConsumers(
		projectValue as SoundscaperProjectV23 & Record<string, unknown>,
	) as Record<string, unknown>;
}

function commandTouchesMasteringSequences(command: AudioEditorCommand): boolean {
	if (command.type.startsWith('mastering-sequence/')) return true;
	if (command.type !== 'batch') return false;
	const children = (command as unknown as { readonly commands?: readonly AudioEditorCommand[] }).commands;
	return Array.isArray(children) && children.some(commandTouchesMasteringSequences);
}

function applyMasteringSequenceCommand(
	project: SoundscaperProjectV23,
	command: AudioEditorCommand,
	options: SoundscaperProjectCommandOptionsV23,
): SoundscaperProjectV23 {
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	applyMasteringSequenceTree(draft, command);
	if (JSON.stringify(draft) === JSON.stringify(project)) return project;
	return finalize(draft, project, options);
}

function applyMasteringSequenceTree(draft: Record<string, unknown>, command: AudioEditorCommand): void {
	if (command.type === 'batch') {
		const children = (command as unknown as { readonly commands?: readonly AudioEditorCommand[] }).commands;
		for (const child of children ?? []) applyMasteringSequenceTree(draft, child);
		return;
	}
	if (!command.type.startsWith('mastering-sequence/')) {
		// A batch mixing product-owned and inherited commands would need both paths
		// in one transaction, and neither path can be run twice safely.
		throw new RangeError('A mastering-sequence batch cannot also contain inherited commands.');
	}
	const handler = MASTERING_HANDLERS[command.type as keyof typeof MASTERING_HANDLERS];
	if (typeof handler !== 'function') {
		throw new RangeError(`Unknown mastering-sequence command ${command.type}.`);
	}
	handler(draft as never, command as never);
}

function applyInheritedCommand(
	project: SoundscaperProjectV23,
	command: AudioEditorCommand,
	options: SoundscaperProjectCommandOptionsV23,
): SoundscaperProjectV23 {
	const borrowed = structuredClone(project) as unknown as Record<string, unknown>;
	const sequences = borrowed.masteringSequences;
	delete borrowed.masteringSequences;
	borrowed.schemaVersion = SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION;
	borrowed.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		borrowed,
		borrowed.featureRequirements as never,
	);
	const applied = applySoundscaperProjectCommandV21(
		borrowed, command, options,
	) as unknown as Record<string, unknown>;
	const draft = structuredClone(applied) as Record<string, unknown>;
	draft.schemaVersion = SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION;
	draft.masteringSequences = normalizeMasteringSequencesV23(sequences);
	draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		draft,
		draft.featureRequirements as never,
	);
	draft.featureRequirements = reconcileSoundscaperProjectFeatureRequirementsV23(
		draft,
		draft.featureRequirements as never,
	);
	// The borrowed pass already refused a no-op by returning its input unchanged,
	// so an unchanged result here means the command changed nothing at all.
	if (JSON.stringify(draft) === JSON.stringify(project)) return project;
	validateSoundscaperProjectV23(draft);
	return draft as unknown as SoundscaperProjectV23;
}

function finalize(
	draft: Record<string, unknown>,
	project: SoundscaperProjectV23,
	options: SoundscaperProjectCommandOptionsV23,
): SoundscaperProjectV23 {
	const revision = Number(project.revision) + 1;
	if (!Number.isSafeInteger(revision)) {
		throw new RangeError('Soundscaper V23 project revision overflowed.');
	}
	draft.revision = revision;
	draft.updatedAt = timestamp(options.now);
	draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		draft,
		draft.featureRequirements as never,
	);
	draft.featureRequirements = reconcileSoundscaperProjectFeatureRequirementsV23(
		draft,
		draft.featureRequirements as never,
	);
	validateSoundscaperProjectV23(draft);
	return draft as unknown as SoundscaperProjectV23;
}

function timestamp(now: Date | string | undefined): string {
	if (typeof now === 'string') return new Date(now).toISOString();
	return (now ?? new Date()).toISOString();
}
