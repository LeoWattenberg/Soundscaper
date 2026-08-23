/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	reconcileFramescaperProjectFeatureRequirementsV24,
} from './editor-project-feature-requirements-v24.ts';
import { FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE } from './editor-project-runtime-profile-v22.ts';
import {
	applyFramescaperProjectCommandV22,
	type FramescaperProjectCommandOptionsV22,
} from './editor-project-v22-commands.ts';
import {
	framescaperProjectV22FoundationV24,
	normalizeFramescaperProjectVisualModelsV24,
	validateFramescaperProjectV24,
	type FramescaperProjectV24,
} from './editor-project-v24-validation.ts';

/** Apply inherited authority to its exact V22 projection, then restore V24-owned state. */
export function applyInheritedFramescaperProjectCommandV24(
	profile: unknown,
	project: FramescaperProjectV24,
	command: unknown,
	options: FramescaperProjectCommandOptionsV22,
): FramescaperProjectV24 {
	const visualTimelineClipIds = ownedIds(
		(project as unknown as Readonly<Record<string, unknown>>).clips, isVisual,
	);
	const visualSelection = selectedVisualClipIds(command, visualTimelineClipIds);
	const inheritedCommand = visualSelection === null ? command : {
		...(command as Readonly<Record<string, unknown>>),
		clipIds: (command as Readonly<{ readonly clipIds: readonly unknown[] }>).clipIds
			.filter((id) => !visualTimelineClipIds.has(String(id))),
	};
	const foundation = framescaperProjectV22FoundationV24(profile, project);
	const applied = applyFramescaperProjectCommandV22(
		FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE,
		foundation,
		inheritedCommand as never,
		options,
	) as unknown as Record<string, unknown>;
	const original = structuredClone(project) as unknown as Record<string, unknown>;
	const visualSourceIds = ownedIds(original.sources, isVisual);
	const originalBin = record(original.projectBin, 'projectBin');
	const visualBinClipIds = ownedIds(originalBin.clips, isVisual);
	applied.schemaVersion = 24;
	applied.sources = mergeCollections(original.sources, applied.sources, visualSourceIds, 'sources');
	applied.clips = mergeCollections(original.clips, applied.clips, visualTimelineClipIds, 'clips');
	const appliedBin = record(applied.projectBin, 'projectBin');
	appliedBin.clips = mergeCollections(originalBin.clips, appliedBin.clips, visualBinClipIds, 'projectBin.clips');
	const originalTracks = new Map(records(original.tracks, 'tracks').map((track) => [String(track.id), track]));
	for (const track of records(applied.tracks, 'tracks')) {
		const prior = originalTracks.get(String(track.id));
		if (!prior || !Array.isArray(track.clipIds) || !Array.isArray(prior.clipIds)) continue;
		track.clipIds = mergeIds(prior.clipIds, track.clipIds, visualTimelineClipIds);
	}
	for (const field of [
		'videoAdjustmentLayers', 'videoVisualPresets', 'videoMaskMattes', 'videoFreezeFallbacks',
	]) applied[field] = structuredClone(original[field]);
	if (visualSelection !== null) {
		const selection = record(applied.selection, 'selection');
		selection.clipIds = visualSelection;
	}
	normalizeFramescaperProjectVisualModelsV24(applied);
	applied.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV24(profile, applied);
	validateFramescaperProjectV24(profile, applied);
	return applied as unknown as FramescaperProjectV24;
}

function selectedVisualClipIds(
	command: unknown,
	visualIds: ReadonlySet<string>,
): string[] | null {
	if (!command || typeof command !== 'object' || Array.isArray(command)) return null;
	const value = command as Readonly<Record<string, unknown>>;
	if (value.type !== 'selection/set' || !Array.isArray(value.clipIds)
		|| !value.clipIds.some((id) => visualIds.has(String(id)))) return null;
	return value.clipIds.map(String);
}

function mergeCollections(
	originalValue: unknown,
	updatedValue: unknown,
	ownedIdsValue: ReadonlySet<string>,
	name: string,
): Record<string, unknown>[] {
	const original = records(originalValue, name);
	const updated = records(updatedValue, name);
	const updatedById = new Map(updated.map((item) => [String(item.id), item]));
	const output: Record<string, unknown>[] = [];
	for (const item of original) {
		const id = String(item.id);
		if (ownedIdsValue.has(id)) output.push(item);
		else if (updatedById.has(id)) {
			output.push(updatedById.get(id)!);
			updatedById.delete(id);
		}
	}
	output.push(...updatedById.values());
	return output;
}

function mergeIds(
	originalValue: readonly unknown[],
	updatedValue: readonly unknown[],
	ownedIdsValue: ReadonlySet<string>,
): string[] {
	const updated = updatedValue.map(String);
	const updatedSet = new Set(updated);
	const output: string[] = [];
	for (const value of originalValue) {
		const id = String(value);
		if (ownedIdsValue.has(id)) output.push(id);
		else if (updatedSet.delete(id)) output.push(id);
	}
	for (const id of updated) if (updatedSet.delete(id)) output.push(id);
	return output;
}

function ownedIds(value: unknown, owns: (value: Record<string, unknown>) => boolean): ReadonlySet<string> {
	return new Set(records(value, 'owned collection').filter(owns).map(({ id }) => String(id)));
}

function isVisual(value: Record<string, unknown>): boolean {
	return value.kind === 'still' || value.kind === 'generator';
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
