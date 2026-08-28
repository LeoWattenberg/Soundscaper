/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperProjectCommandFinishing } from './editor-project-finishing-commands.ts';
import { prepareFramescaperVideoTransitionAllocationsFinishing } from './editor-project-finishing-transition-allocation.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { isFramescaperProfessionalSourceCollectionCommandTypeProfessionalMedia } from './editor-project-professional-media-source-command.ts';
import {
	applyFramescaperProjectCommandNativeMedia,
	type FramescaperProjectCommandNativeMedia,
} from './editor-project-native-media-commands.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import { validateFramescaperProjectNativeMedia } from './editor-project-native-media.ts';

export function prepareFramescaperVideoTransitionAllocationsNativeMedia(
	profile: unknown,
	project: unknown,
	command: FramescaperProjectCommandNativeMedia,
	createId: (prefix?: string) => string,
): FramescaperProjectCommandNativeMedia {
	validateFramescaperProjectNativeMedia(profile, project);
	if (command.type === 'batch' && 'commands' in command && Array.isArray(command.commands)) {
		let current = project;
		const commands: FramescaperProjectCommandNativeMedia[] = [];
		let inherited: FramescaperProjectCommandNativeMedia[] = [];
		const applyPrepared = (prepared: FramescaperProjectCommandNativeMedia): void => {
			current = applyFramescaperProjectCommandNativeMedia(profile, current, prepared, {
				now: String((current as Readonly<{ updatedAt: unknown }>).updatedAt),
			});
		};
		// finishing batches intentionally admit temporarily invalid siblings (for example
		// an adjacent video/audio lane pair), so inherited runs must be preflighted
		// and simulated as one atomic command rather than one child at a time.
		const flushInherited = (): void => {
			if (inherited.length === 0) return;
			const prepared = prepareFramescaperVideoTransitionAllocationsFinishing(
				FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
				framescaperProjectFinishingFoundationShapeNativeMedia(current),
				inherited.length === 1 ? inherited[0] : { type: 'batch', commands: inherited },
				createId,
			) as FramescaperProjectCommandNativeMedia;
			if (inherited.length === 1) commands.push(prepared);
			else if (prepared.type === 'batch' && 'commands' in prepared
				&& Array.isArray(prepared.commands)) commands.push(...prepared.commands);
			else throw new TypeError('Inherited nativeMedia batch preparation lost its command batch.');
			applyPrepared(prepared);
			inherited = [];
		};
		for (const child of command.commands) {
			if (isInheritedCommandTree(child)) {
				inherited.push(child);
				continue;
			}
			flushInherited();
			const prepared = prepareFramescaperVideoTransitionAllocationsNativeMedia(
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
	return prepareFramescaperVideoTransitionAllocationsFinishing(
		FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
		framescaperProjectFinishingFoundationShapeNativeMedia(project),
		command as FramescaperProjectCommandFinishing,
		createId,
	) as FramescaperProjectCommandNativeMedia;
}

function isInheritedCommandTree(command: FramescaperProjectCommandNativeMedia): boolean {
	if (command.type === 'batch' && 'commands' in command && Array.isArray(command.commands)) {
		return command.commands.every(isInheritedCommandTree);
	}
	return command.type !== 'openfx-effect/set'
		&& command.type !== 'video-source/professional-state-set'
		&& !isFramescaperProfessionalSourceCollectionCommandTypeProfessionalMedia(command.type);
}
