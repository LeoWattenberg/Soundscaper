/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	applyAssistanceAssetUpsertCommandV1,
	hasAssistanceAssetUpsertCommandTypeV1,
	snapshotAssistanceAssetUpsertCommandV1,
	type AssistanceAssetUpsertCommandV1,
} from '../common/editor/assistance/assistance-asset-command-v1.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsAssistance,
} from './editor-project-feature-requirements-assistance.ts';
import {
	applyFramescaperProjectCommandTimelineImage,
	snapshotFramescaperProjectCommandTimelineImage,
	type FramescaperProjectCommandOptionsTimelineImage,
	type FramescaperProjectCommandTimelineImage,
} from './editor-project-timeline-image-commands.ts';
import { FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { assertFramescaperProjectAssistanceProfile } from './editor-domain-runtime-profile.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from './editor-project-assistance-foundation.ts';
import {
	validateFramescaperProjectAssistance,
	type FramescaperProjectAssistance,
} from './editor-project-assistance.ts';

export type FramescaperProjectCommandAssistance =
	| FramescaperProjectCommandTimelineImage
	| AssistanceAssetUpsertCommandV1;
export type FramescaperProjectCommandOptionsAssistance = FramescaperProjectCommandOptionsTimelineImage;

export function snapshotFramescaperProjectCommandAssistance(value: unknown): FramescaperProjectCommandAssistance {
	return hasAssistanceAssetUpsertCommandTypeV1(value)
		? snapshotAssistanceAssetUpsertCommandV1(value)
		: snapshotFramescaperProjectCommandTimelineImage(value);
}

/** Execute inherited timelineImage image semantics without allowing assistance custody to be dropped. */
export function applyFramescaperProjectCommandAssistance(
	profile: unknown,
	projectValue: unknown,
	commandValue: unknown,
	options: FramescaperProjectCommandOptionsAssistance = {},
): FramescaperProjectAssistance {
	assertFramescaperProjectAssistanceProfile(profile);
	validateFramescaperProjectAssistance(profile, projectValue);
	const project = projectValue as FramescaperProjectAssistance;
	const command = snapshotFramescaperProjectCommandAssistance(commandValue);
	if (hasAssistanceAssetUpsertCommandTypeV1(command)) {
		return applyAssistanceCommand(
			profile,
			project,
			snapshotAssistanceAssetUpsertCommandV1(command),
			options,
		);
	}
	const applied = applyFramescaperProjectCommandTimelineImage(
		FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE,
		framescaperProjectTimelineImageFoundationShapeAssistance(project),
		command,
		options,
	) as unknown as Record<string, unknown>;
	applied.schemaVersion =  1;
	applied.assistanceAssets = structuredClone(project.assistanceAssets);
	applied.featureRequirements = reconcileFramescaperProjectFeatureRequirementsAssistance(profile, applied);
	validateFramescaperProjectAssistance(profile, applied);
	return applied as unknown as FramescaperProjectAssistance;
}

function applyAssistanceCommand(
	profile: unknown,
	project: FramescaperProjectAssistance,
	command: AssistanceAssetUpsertCommandV1,
	options: FramescaperProjectCommandOptionsAssistance,
): FramescaperProjectAssistance {
	const assistanceAssets = applyAssistanceAssetUpsertCommandV1(project.assistanceAssets, command);
	if (command.commands.length > 0) {
		const childCommand = command.commands.length === 1
			? command.commands[0]!
			: { type: 'batch' as const, commands: command.commands };
		const applied = applyFramescaperProjectCommandTimelineImage(
			FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE,
			framescaperProjectTimelineImageFoundationShapeAssistance(project),
			childCommand,
			options,
		) as unknown as Record<string, unknown>;
		applied.schemaVersion =  1;
		applied.assistanceAssets = structuredClone(assistanceAssets);
		applied.featureRequirements = reconcileFramescaperProjectFeatureRequirementsAssistance(profile, applied);
		validateFramescaperProjectAssistance(profile, applied);
		return applied as unknown as FramescaperProjectAssistance;
	}
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	draft.assistanceAssets = assistanceAssets;
	const revision = Number(project.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper assistance revision overflowed.');
	draft.revision = revision;
	draft.updatedAt = timestamp(options.now);
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsAssistance(profile, draft);
	validateFramescaperProjectAssistance(profile, draft);
	return draft as unknown as FramescaperProjectAssistance;
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper assistance timestamp is invalid.');
	return date.toISOString();
}
