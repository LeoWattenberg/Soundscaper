/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	applyAssistanceAssetUpsertCommandV1,
	hasAssistanceAssetUpsertCommandTypeV1,
	snapshotAssistanceAssetUpsertCommandV1,
	type AssistanceAssetUpsertCommandV1,
} from '../common/editor/assistance/assistance-asset-command-v1.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV31,
} from './editor-project-feature-requirements-v31.ts';
import {
	applyFramescaperProjectCommandV28,
	snapshotFramescaperProjectCommandV28,
	type FramescaperProjectCommandOptionsV28,
	type FramescaperProjectCommandV28,
} from './editor-project-v28-commands.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import { assertFramescaperProjectV31Profile } from './editor-project-runtime-profile-v31.ts';
import { framescaperProjectV28FoundationShapeV31 } from './editor-project-v31-foundation.ts';
import {
	validateFramescaperProjectV31,
	type FramescaperProjectV31,
} from './editor-project-v31.ts';

export type FramescaperProjectCommandV31 =
	| FramescaperProjectCommandV28
	| AssistanceAssetUpsertCommandV1;
export type FramescaperProjectCommandOptionsV31 = FramescaperProjectCommandOptionsV28;

export function snapshotFramescaperProjectCommandV31(value: unknown): FramescaperProjectCommandV31 {
	return hasAssistanceAssetUpsertCommandTypeV1(value)
		? snapshotAssistanceAssetUpsertCommandV1(value)
		: snapshotFramescaperProjectCommandV28(value);
}

/** Execute exact inherited F28 semantics without allowing F31 custody to be dropped. */
export function applyFramescaperProjectCommandV31(
	profile: unknown,
	projectValue: unknown,
	commandValue: unknown,
	options: FramescaperProjectCommandOptionsV31 = {},
): FramescaperProjectV31 {
	assertFramescaperProjectV31Profile(profile);
	validateFramescaperProjectV31(profile, projectValue);
	const project = projectValue as FramescaperProjectV31;
	const command = snapshotFramescaperProjectCommandV31(commandValue);
	if (hasAssistanceAssetUpsertCommandTypeV1(command)) {
		return applyAssistanceCommand(
			profile,
			project,
			snapshotAssistanceAssetUpsertCommandV1(command),
			options,
		);
	}
	const applied = applyFramescaperProjectCommandV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV28FoundationShapeV31(project),
		command,
		options,
	) as unknown as Record<string, unknown>;
	applied.schemaVersion = 31;
	applied.assistanceAssets = structuredClone(project.assistanceAssets);
	applied.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV31(profile, applied);
	validateFramescaperProjectV31(profile, applied);
	return applied as unknown as FramescaperProjectV31;
}

function applyAssistanceCommand(
	profile: unknown,
	project: FramescaperProjectV31,
	command: AssistanceAssetUpsertCommandV1,
	options: FramescaperProjectCommandOptionsV31,
): FramescaperProjectV31 {
	const assistanceAssets = applyAssistanceAssetUpsertCommandV1(project.assistanceAssets, command);
	if (command.commands.length > 0) {
		const childCommand = command.commands.length === 1
			? command.commands[0]!
			: { type: 'batch' as const, commands: command.commands };
		const applied = applyFramescaperProjectCommandV28(
			FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
			framescaperProjectV28FoundationShapeV31(project),
			childCommand,
			options,
		) as unknown as Record<string, unknown>;
		applied.schemaVersion = 31;
		applied.assistanceAssets = structuredClone(assistanceAssets);
		applied.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV31(profile, applied);
		validateFramescaperProjectV31(profile, applied);
		return applied as unknown as FramescaperProjectV31;
	}
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	draft.assistanceAssets = assistanceAssets;
	const revision = Number(project.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper F31 revision overflowed.');
	draft.revision = revision;
	draft.updatedAt = timestamp(options.now);
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV31(profile, draft);
	validateFramescaperProjectV31(profile, draft);
	return draft as unknown as FramescaperProjectV31;
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper F31 timestamp is invalid.');
	return date.toISOString();
}
