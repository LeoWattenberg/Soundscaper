/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	collectClipTransformIds as collectLegacyClipTransformIds,
	collectClipTrimIds as collectLegacyClipTrimIds,
} from '../../../../commands/clip-basic-runtime.js';
import {
	prepareOverwriteClipCommand as prepareLegacyOverwriteClipCommand,
	prepareTransformClipsCommand as prepareLegacyTransformClipsCommand,
} from '../../../../commands/clip-transform-runtime.js';
import type { AudioEditorCommand, CommandObject } from '../../../../commands/protocol.ts';
import type { ClipTransformProject } from './clip-domain-types.ts';

export interface PreparedTransform {
	readonly clipId: string;
	readonly trackId?: string;
	readonly changes: CommandObject;
}

export function trimCommand(
	clipId: string,
	changes: CommandObject,
): Extract<AudioEditorCommand, { readonly type: 'clip/trim' }> {
	return { type: 'clip/trim', clipId, ...changes } as Extract<AudioEditorCommand, { readonly type: 'clip/trim' }>;
}

export function collectClipTransformIds(
	project: ClipTransformProject,
	activeClipId: string,
	options: Readonly<{ allOnTrack?: boolean; clipIds?: readonly string[] }> = {},
): string[] {
	return (collectLegacyClipTransformIds as (
		project: ClipTransformProject,
		activeClipId: string,
		options: Readonly<{ allOnTrack?: boolean; clipIds?: readonly string[] }>,
	) => string[])(project, activeClipId, options);
}

export function collectClipTrimIds(
	project: ClipTransformProject,
	activeClipId: string,
	edge: 'left' | 'right',
): string[] {
	return (collectLegacyClipTrimIds as (
		project: ClipTransformProject,
		activeClipId: string,
		edge: 'left' | 'right',
	) => string[])(project, activeClipId, edge);
}

export function prepareTransformClipsCommand(
	project: ClipTransformProject,
	transforms: readonly PreparedTransform[],
	options: Readonly<{ overwrite?: boolean }>,
	idFactory: (prefix: string) => string,
): Extract<AudioEditorCommand, { readonly type: 'clip/transform-many' }> {
	const imageIds = new Set(project.clips.filter(clip => clip.kind === 'image' || clip.kind === 'still' || clip.kind === 'generator').map(clip => clip.id));
	const imageMoves = transforms.filter(transform => imageIds.has(transform.clipId));
	if (imageMoves.length && options.overwrite) throw new RangeError('Still image moves cannot overwrite other media.');
	const inherited = transforms.filter(transform => !imageIds.has(transform.clipId));
	const prepared = inherited.length ? (prepareLegacyTransformClipsCommand as unknown as (
		project: ClipTransformProject,
		transforms: readonly PreparedTransform[],
		options: Readonly<{ overwrite?: boolean }>,
		idFactory: (prefix: string) => string,
	) => Extract<AudioEditorCommand, { readonly type: 'clip/transform-many' }>)(
		project, inherited, options, idFactory,
	) : { type: 'clip/transform-many' as const, transforms: [], overwrite: false, splitClipIds: {} };
	return imageMoves.length ? { ...prepared, transforms: [...prepared.transforms, ...imageMoves] } : prepared;
}

export function prepareOverwriteClipCommand(
	project: ClipTransformProject,
	clipId: string,
	options: Readonly<{ trackId?: string | null; changes?: CommandObject }>,
	idFactory: (prefix: string) => string,
): Extract<AudioEditorCommand, { readonly type: 'clip/overwrite' }> {
	return (prepareLegacyOverwriteClipCommand as (
		project: ClipTransformProject,
		clipId: string,
		options: Readonly<{ trackId?: string | null; changes?: CommandObject }>,
		idFactory: (prefix: string) => string,
	) => Extract<AudioEditorCommand, { readonly type: 'clip/overwrite' }>)(
		project, clipId, options, idFactory,
	);
}
