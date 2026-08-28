/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	applyAssistanceAssetUpsertCommandV1,
	hasAssistanceAssetUpsertCommandTypeV1,
	snapshotAssistanceAssetUpsertCommandV1,
} from '../common/editor/assistance/assistance-asset-command-v1.ts';
import type { FramescaperProjectCommandAssistance } from './editor-project-assistance-commands.ts';
import { prepareFramescaperVideoTransitionAllocationsTimelineImage } from './editor-project-timeline-image-transition-allocation.ts';
import { FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { assertFramescaperProjectAssistanceProfile } from './editor-domain-runtime-profile.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from './editor-project-assistance-foundation.ts';
import { validateFramescaperProjectAssistance } from './editor-project-assistance.ts';

export function prepareFramescaperVideoTransitionAllocationsAssistance(
	profile: unknown,
	project: unknown,
	command: FramescaperProjectCommandAssistance,
	createId: (prefix?: string) => string,
): FramescaperProjectCommandAssistance {
	assertFramescaperProjectAssistanceProfile(profile);
	validateFramescaperProjectAssistance(profile, project);
	if (typeof createId !== 'function') throw new TypeError('A transition ID factory is required.');
	if (hasAssistanceAssetUpsertCommandTypeV1(command)) {
		const compound = snapshotAssistanceAssetUpsertCommandV1(command);
		applyAssistanceAssetUpsertCommandV1(
			(project as Readonly<{ assistanceAssets: unknown }>).assistanceAssets,
			compound,
		);
		if (compound.commands.length === 0) return compound;
		const childCommand = compound.commands.length === 1
			? compound.commands[0]!
			: { type: 'batch' as const, commands: compound.commands };
		const prepared = prepareFramescaperVideoTransitionAllocationsTimelineImage(
			FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE,
			framescaperProjectTimelineImageFoundationShapeAssistance(project),
			childCommand,
			createId,
		);
		const commands = prepared.type === 'batch' && 'commands' in prepared
			&& Array.isArray(prepared.commands)
			? prepared.commands
			: [prepared];
		return snapshotAssistanceAssetUpsertCommandV1({ ...compound, commands });
	}
	return prepareFramescaperVideoTransitionAllocationsTimelineImage(
		FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE,
		framescaperProjectTimelineImageFoundationShapeAssistance(project),
		command,
		createId,
	);
}
