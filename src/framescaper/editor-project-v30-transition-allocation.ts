/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareFramescaperVideoTransitionAllocationsV28 } from './editor-project-v28-transition-allocation.ts';
import type { FramescaperProjectCommandV28 } from './editor-project-v28-commands.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import {
	applyFramescaperProjectCommandV30,
	type FramescaperProjectCommandBatchV30,
	type FramescaperProjectCommandV30,
} from './editor-project-v30-commands.ts';
import { framescaperProjectV28FoundationShapeV30 } from './editor-project-v30-foundation.ts';
import type { FramescaperImageCommandV30 } from './editor-project-v30-image-command.ts';
import { validateFramescaperProjectV30 } from './editor-project-v30.ts';

/** Allocate inherited transition identities without allowing V28 to observe image commands. */
export function prepareFramescaperVideoTransitionAllocationsV30(
	profile: unknown,
	project: unknown,
	command: FramescaperProjectCommandV30,
	createId: (prefix?: string) => string,
): FramescaperProjectCommandV30 {
	validateFramescaperProjectV30(profile, project);
	if (isImage(command)) return command;
	if (!isBatch(command)) {
		return prepareFramescaperVideoTransitionAllocationsV28(
			FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
			framescaperProjectV28FoundationShapeV30(project),
			command,
			createId,
		);
	}
	let current = project;
	const output: FramescaperProjectCommandV30[] = [];
	let inherited: FramescaperProjectCommandV28[] = [];
	const apply = (prepared: FramescaperProjectCommandV30): void => {
		current = applyFramescaperProjectCommandV30(profile, current, prepared, {
			now: String((current as Readonly<{ updatedAt: unknown }>).updatedAt),
		});
	};
	const flushInherited = (): void => {
		if (inherited.length === 0) return;
		const carrier = inherited.length === 1
			? inherited[0]!
			: { type: 'batch' as const, commands: inherited };
		const prepared = prepareFramescaperVideoTransitionAllocationsV28(
			FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
			framescaperProjectV28FoundationShapeV30(current),
			carrier,
			createId,
		);
		output.push(prepared);
		apply(prepared);
		inherited = [];
	};
	for (const child of command.commands) {
		if (isInheritedTree(child)) {
			inherited.push(child);
			continue;
		}
		flushInherited();
		const prepared = prepareFramescaperVideoTransitionAllocationsV30(
			profile, current, child, createId,
		);
		output.push(prepared);
		apply(prepared);
	}
	flushInherited();
	return Object.freeze({ type: 'batch', commands: Object.freeze(output) });
}

function isInheritedTree(command: FramescaperProjectCommandV30): command is FramescaperProjectCommandV28 {
	return isBatch(command) ? command.commands.every(isInheritedTree) : !isImage(command);
}

function isBatch(command: FramescaperProjectCommandV30): command is FramescaperProjectCommandBatchV30 {
	return command.type === 'batch' && 'commands' in command && Array.isArray(command.commands);
}

function isImage(command: FramescaperProjectCommandV30): command is FramescaperImageCommandV30 {
	return command.type === 'image-source/set' || command.type === 'image-clip/set';
}
