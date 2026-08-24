/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperProjectCommandV27 } from './editor-project-v27-commands.ts';
import { prepareFramescaperVideoTransitionAllocationsV27 } from './editor-project-v27-transition-allocation.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v27.ts';
import { isFramescaperProfessionalSourceCollectionCommandTypeV25 } from './editor-project-v25-source-command.ts';
import {
	applyFramescaperProjectCommandV28,
	type FramescaperProjectCommandV28,
} from './editor-project-v28-commands.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';
import { validateFramescaperProjectV28 } from './editor-project-v28.ts';

export function prepareFramescaperVideoTransitionAllocationsV28(
	profile: unknown,
	project: unknown,
	command: FramescaperProjectCommandV28,
	createId: (prefix?: string) => string,
): FramescaperProjectCommandV28 {
	validateFramescaperProjectV28(profile, project);
	if (command.type === 'batch' && 'commands' in command && Array.isArray(command.commands)) {
		let current = project;
		const commands: FramescaperProjectCommandV28[] = [];
		let inherited: FramescaperProjectCommandV28[] = [];
		const applyPrepared = (prepared: FramescaperProjectCommandV28): void => {
			current = applyFramescaperProjectCommandV28(profile, current, prepared, {
				now: String((current as Readonly<{ updatedAt: unknown }>).updatedAt),
			});
		};
		// V27 batches intentionally admit temporarily invalid siblings (for example
		// an adjacent video/audio lane pair), so inherited runs must be preflighted
		// and simulated as one atomic command rather than one child at a time.
		const flushInherited = (): void => {
			if (inherited.length === 0) return;
			const prepared = prepareFramescaperVideoTransitionAllocationsV27(
				FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
				framescaperProjectV27FoundationShapeV28(current),
				inherited.length === 1 ? inherited[0] : { type: 'batch', commands: inherited },
				createId,
			) as FramescaperProjectCommandV28;
			if (inherited.length === 1) commands.push(prepared);
			else if (prepared.type === 'batch' && 'commands' in prepared
				&& Array.isArray(prepared.commands)) commands.push(...prepared.commands);
			else throw new TypeError('Inherited V28 batch preparation lost its command batch.');
			applyPrepared(prepared);
			inherited = [];
		};
		for (const child of command.commands) {
			if (isInheritedCommandTree(child)) {
				inherited.push(child);
				continue;
			}
			flushInherited();
			const prepared = prepareFramescaperVideoTransitionAllocationsV28(
				profile, current, child, createId,
			);
			commands.push(prepared);
			applyPrepared(prepared);
		}
		flushInherited();
		return Object.freeze({
			type: 'batch' as const,
			commands: Object.freeze(commands),
		});
	}
	if (command.type === 'openfx-effect/set'
		|| command.type === 'video-source/professional-state-set'
		|| command.type === 'video-source/professional-add'
		|| command.type === 'video-source/professional-remove') return command;
	return prepareFramescaperVideoTransitionAllocationsV27(
		FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV27FoundationShapeV28(project),
		command as FramescaperProjectCommandV27,
		createId,
	) as FramescaperProjectCommandV28;
}

function isInheritedCommandTree(command: FramescaperProjectCommandV28): boolean {
	if (command.type === 'batch' && 'commands' in command && Array.isArray(command.commands)) {
		return command.commands.every(isInheritedCommandTree);
	}
	return command.type !== 'openfx-effect/set'
		&& command.type !== 'video-source/professional-state-set'
		&& !isFramescaperProfessionalSourceCollectionCommandTypeV25(command.type);
}
