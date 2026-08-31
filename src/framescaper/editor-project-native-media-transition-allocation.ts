/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperProjectCommandBatchFinishing,
	FramescaperProjectCommandFinishing,
} from './editor-project-finishing-commands.ts';
import { prepareFramescaperVideoTransitionAllocationsFinishing } from './editor-project-finishing-transition-allocation.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { isFramescaperProfessionalSourceCollectionCommandTypeProfessionalMedia } from './editor-project-professional-media-source-command.ts';
import {
	applyFramescaperProjectCommandNativeMedia,
	projectFramescaperInheritedCommandForFinishingNativeMedia,
	snapshotFramescaperProjectCommandNativeMedia,
	type FramescaperProjectCommandNativeMedia,
} from './editor-project-native-media-commands.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import {
	validateFramescaperProjectNativeMedia,
	type FramescaperProjectNativeMedia,
} from './editor-project-native-media.ts';

export function prepareFramescaperVideoTransitionAllocationsNativeMedia(
	profile: unknown,
	project: unknown,
	command: FramescaperProjectCommandNativeMedia,
	createId: (prefix?: string) => string,
): FramescaperProjectCommandNativeMedia {
	validateFramescaperProjectNativeMedia(profile, project);
	const authoritative = snapshotFramescaperProjectCommandNativeMedia(command);
	if (authoritative.type === 'batch' && 'commands' in authoritative && Array.isArray(authoritative.commands)) {
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
			const prepared = prepareInheritedTransitionAllocationsNativeMedia(
				current as FramescaperProjectNativeMedia,
				(inherited.length === 1 ? inherited[0] : {
					type: 'batch', commands: inherited,
				}) as FramescaperProjectCommandFinishing,
				createId,
			);
			if (inherited.length === 1) commands.push(prepared);
			else if (prepared.type === 'batch' && 'commands' in prepared
				&& Array.isArray(prepared.commands)) commands.push(...prepared.commands);
			else throw new TypeError('Inherited nativeMedia batch preparation lost its command batch.');
			applyPrepared(prepared);
			inherited = [];
		};
		for (const child of authoritative.commands) {
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
	if (authoritative.type === 'openfx-effect/set'
		|| authoritative.type === 'video-source/professional-state-set'
		|| authoritative.type === 'video-source/professional-add'
		|| authoritative.type === 'video-source/professional-remove') return authoritative;
	return prepareInheritedTransitionAllocationsNativeMedia(
		project as FramescaperProjectNativeMedia,
		authoritative as FramescaperProjectCommandFinishing,
		createId,
	);
}

function prepareInheritedTransitionAllocationsNativeMedia(
	project: FramescaperProjectNativeMedia,
	command: FramescaperProjectCommandFinishing,
	createId: (prefix?: string) => string,
): FramescaperProjectCommandNativeMedia {
	const projected = projectFramescaperInheritedCommandForFinishingNativeMedia(project, command);
	const prepared = prepareFramescaperVideoTransitionAllocationsFinishing(
		FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
		framescaperProjectFinishingFoundationShapeNativeMedia(project),
		projected,
		createId,
	);
	return snapshotFramescaperProjectCommandNativeMedia(
		restorePreparedAllocationsNativeMedia(command, prepared),
	);
}

function restorePreparedAllocationsNativeMedia(
	authoritative: FramescaperProjectCommandFinishing,
	prepared: FramescaperProjectCommandFinishing,
): FramescaperProjectCommandFinishing {
	if (authoritative.type !== prepared.type) {
		throw new TypeError('Inherited nativeMedia transition preparation changed its command type.');
	}
	const authoritativeBatch = isFinishingBatchNativeMedia(authoritative);
	const preparedBatch = isFinishingBatchNativeMedia(prepared);
	if (authoritativeBatch !== preparedBatch) {
		throw new TypeError('Inherited nativeMedia transition preparation changed its command shape.');
	}
	if (authoritativeBatch && preparedBatch) {
		if (authoritative.commands.length !== prepared.commands.length) {
			throw new TypeError('Inherited nativeMedia transition preparation changed its batch arity.');
		}
		return Object.freeze({
			type: 'batch' as const,
			commands: Object.freeze(authoritative.commands.map((child, index) => (
				restorePreparedAllocationsNativeMedia(child, prepared.commands[index]!)
			))),
		});
	}
	const restored = structuredClone(authoritative) as unknown as Record<string, unknown>;
	const allocations = Object.getOwnPropertyDescriptor(prepared, 'videoTransitionAllocations');
	if (allocations !== undefined) {
		restored.videoTransitionAllocations = structuredClone(allocations.value);
	}
	return Object.freeze(restored) as FramescaperProjectCommandFinishing;
}

function isFinishingBatchNativeMedia(
	command: FramescaperProjectCommandFinishing,
): command is FramescaperProjectCommandBatchFinishing {
	return command.type === 'batch' && 'commands' in command && Array.isArray(command.commands);
}

function isInheritedCommandTree(command: FramescaperProjectCommandNativeMedia): boolean {
	if (command.type === 'batch' && 'commands' in command && Array.isArray(command.commands)) {
		return command.commands.every(isInheritedCommandTree);
	}
	return command.type !== 'openfx-effect/set'
		&& command.type !== 'video-source/professional-state-set'
		&& !isFramescaperProfessionalSourceCollectionCommandTypeProfessionalMedia(command.type);
}
