/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareFramescaperVideoTransitionAllocationsNativeMedia } from './editor-project-native-media-transition-allocation.ts';
import type { FramescaperProjectCommandNativeMedia } from './editor-project-native-media-commands.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import {
	applyFramescaperProjectCommandTimelineImage,
	type FramescaperProjectCommandBatchTimelineImage,
	type FramescaperProjectCommandTimelineImage,
} from './editor-project-timeline-image-commands.ts';
import { framescaperProjectNativeMediaFoundationShapeTimelineImage } from './editor-project-timeline-image-foundation.ts';
import type { FramescaperImageCommandTimelineImage } from './editor-project-timeline-image-image-command.ts';
import { validateFramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';

/** Allocate inherited transition identities without allowing nativeMedia to observe image commands. */
export function prepareFramescaperVideoTransitionAllocationsTimelineImage(
	profile: unknown,
	project: unknown,
	command: FramescaperProjectCommandTimelineImage,
	createId: (prefix?: string) => string,
): FramescaperProjectCommandTimelineImage {
	validateFramescaperProjectTimelineImage(profile, project);
	if (isImage(command)) return command;
	if (!isBatch(command)) {
		return prepareFramescaperVideoTransitionAllocationsNativeMedia(
			FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
			framescaperProjectNativeMediaFoundationShapeTimelineImage(project),
			command,
			createId,
		);
	}
	let current = project;
	const output: FramescaperProjectCommandTimelineImage[] = [];
	let inherited: FramescaperProjectCommandNativeMedia[] = [];
	const apply = (prepared: FramescaperProjectCommandTimelineImage): void => {
		current = applyFramescaperProjectCommandTimelineImage(profile, current, prepared, {
			now: String((current as Readonly<{ updatedAt: unknown }>).updatedAt),
		});
	};
	const flushInherited = (): void => {
		if (inherited.length === 0) return;
		const carrier = inherited.length === 1
			? inherited[0]!
			: { type: 'batch' as const, commands: inherited };
		const prepared = prepareFramescaperVideoTransitionAllocationsNativeMedia(
			FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
			framescaperProjectNativeMediaFoundationShapeTimelineImage(current),
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
		const prepared = prepareFramescaperVideoTransitionAllocationsTimelineImage(
			profile, current, child, createId,
		);
		output.push(prepared);
		apply(prepared);
	}
	flushInherited();
	return Object.freeze({ type: 'batch', commands: Object.freeze(output) });
}

function isInheritedTree(command: FramescaperProjectCommandTimelineImage): command is FramescaperProjectCommandNativeMedia {
	return isBatch(command) ? command.commands.every(isInheritedTree) : !isImage(command);
}

function isBatch(command: FramescaperProjectCommandTimelineImage): command is FramescaperProjectCommandBatchTimelineImage {
	return command.type === 'batch' && 'commands' in command && Array.isArray(command.commands);
}

function isImage(command: FramescaperProjectCommandTimelineImage): command is FramescaperImageCommandTimelineImage {
	return command.type === 'image-source/set' || command.type === 'image-clip/set';
}
