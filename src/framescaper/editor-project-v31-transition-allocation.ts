/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	applyAssistanceAssetUpsertCommandV1,
	hasAssistanceAssetUpsertCommandTypeV1,
	snapshotAssistanceAssetUpsertCommandV1,
} from '../common/editor/assistance/assistance-asset-command-v1.ts';
import type { FramescaperProjectCommandV31 } from './editor-project-v31-commands.ts';
import { prepareFramescaperVideoTransitionAllocationsV28 } from './editor-project-v28-transition-allocation.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import { assertFramescaperProjectV31Profile } from './editor-project-runtime-profile-v31.ts';
import { framescaperProjectV28FoundationShapeV31 } from './editor-project-v31-foundation.ts';
import { validateFramescaperProjectV31 } from './editor-project-v31.ts';

export function prepareFramescaperVideoTransitionAllocationsV31(
	profile: unknown,
	project: unknown,
	command: FramescaperProjectCommandV31,
	createId: (prefix?: string) => string,
): FramescaperProjectCommandV31 {
	assertFramescaperProjectV31Profile(profile);
	validateFramescaperProjectV31(profile, project);
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
		const prepared = prepareFramescaperVideoTransitionAllocationsV28(
			FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
			framescaperProjectV28FoundationShapeV31(project),
			childCommand,
			createId,
		);
		const commands = prepared.type === 'batch' && 'commands' in prepared
			&& Array.isArray(prepared.commands)
			? prepared.commands
			: [prepared];
		return snapshotAssistanceAssetUpsertCommandV1({ ...compound, commands });
	}
	return prepareFramescaperVideoTransitionAllocationsV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV28FoundationShapeV31(project),
		command,
		createId,
	);
}
