/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	reconcileFramescaperProjectFeatureRequirementsVisual,
} from './editor-project-feature-requirements-visual.ts';
import { FRAMESCAPER_TRANSITIONS_PROJECT_CANDIDATE_PROFILE } from './editor-domain-runtime-profile.ts';
import {
	applyFramescaperProjectCommandTransitions,
	type FramescaperProjectCommandOptionsTransitions,
} from './editor-project-transitions-commands.ts';
import {
	framescaperProjectTransitionsFoundationVisual,
	normalizeFramescaperProjectVisualModelsVisual,
	validateFramescaperProjectVisual,
	type FramescaperProjectVisual,
} from './editor-project-visual-validation.ts';

/** Apply inherited authority to its exact transitions projection, then restore visual-owned state. */
export function applyInheritedFramescaperProjectCommandVisual(
	profile: unknown,
	project: FramescaperProjectVisual,
	command: unknown,
	options: FramescaperProjectCommandOptionsTransitions,
): FramescaperProjectVisual {
	const visualTimelineClipIds = ownedIds(
		(project as unknown as Readonly<Record<string, unknown>>).clips, isVisual,
	);
	const visualSelection = selectedVisualClipIds(command, visualTimelineClipIds);
	const inheritedCommand = visualSelection === null ? command : {
		...(command as Readonly<Record<string, unknown>>),
		clipIds: (command as Readonly<{ readonly clipIds: readonly unknown[] }>).clipIds
			.filter((id) => !visualTimelineClipIds.has(String(id))),
	};
	const foundation = framescaperProjectTransitionsFoundationVisual(profile, project);
	const applied = applyFramescaperProjectCommandTransitions(
		FRAMESCAPER_TRANSITIONS_PROJECT_CANDIDATE_PROFILE,
		foundation,
		inheritedCommand as never,
		options,
	) as unknown as Record<string, unknown>;
	const original = structuredClone(project) as unknown as Record<string, unknown>;
	const visualSourceIds = ownedIds(original.sources, isVisual);
	const originalBin = record(original.projectBin, 'projectBin');
	const visualBinClipIds = ownedIds(originalBin.clips, isVisual);
	const originalTracks = records(original.tracks, 'tracks');
	const appliedTracks = records(applied.tracks, 'tracks');
	const survivingTrackIds = new Set(appliedTracks.map(({ id }) => String(id)));
	const visualTrackByClipId = trackByClipId(originalTracks, visualTimelineClipIds);
	const retainedVisualTimelineClipIds = new Set([...visualTimelineClipIds].filter(
		(id) => survivingTrackIds.has(visualTrackByClipId.get(id) ?? ''),
	));
	applied.schemaVersion =  1;
	applied.sources = mergeCollections(original.sources, applied.sources, visualSourceIds, 'sources');
	applied.clips = mergeCollections(
		original.clips,
		applied.clips,
		retainedVisualTimelineClipIds,
		'clips',
	);
	const appliedBin = record(applied.projectBin, 'projectBin');
	appliedBin.clips = mergeCollections(originalBin.clips, appliedBin.clips, visualBinClipIds, 'projectBin.clips');
	const originalTrackById = new Map(originalTracks.map((track) => [String(track.id), track]));
	for (const track of appliedTracks) {
		const prior = originalTrackById.get(String(track.id));
		if (!prior || !Array.isArray(track.clipIds) || !Array.isArray(prior.clipIds)) continue;
		track.clipIds = mergeIds(prior.clipIds, track.clipIds, retainedVisualTimelineClipIds);
	}
	const sourceIds = new Set(records(applied.sources, 'sources').map(({ id }) => String(id)));
	applied.videoAdjustmentLayers = retainedAdjustmentLayers(
		original.videoAdjustmentLayers,
		survivingTrackIds,
	);
	applied.videoVisualPresets = structuredClone(original.videoVisualPresets);
	applied.videoMaskMattes = retainedMaskMattes(original.videoMaskMattes, sourceIds);
	applied.videoFreezeFallbacks = records(original.videoFreezeFallbacks, 'videoFreezeFallbacks')
		.filter(({ renderedSourceId }) => sourceIds.has(String(renderedSourceId)));
	if (visualSelection !== null) {
		const selection = record(applied.selection, 'selection');
		selection.clipIds = visualSelection.filter(
			(id) => !visualTimelineClipIds.has(id) || retainedVisualTimelineClipIds.has(id),
		);
	}
	normalizeFramescaperProjectVisualModelsVisual(applied);
	applied.featureRequirements = reconcileFramescaperProjectFeatureRequirementsVisual(profile, applied);
	validateFramescaperProjectVisual(profile, applied);
	return applied as unknown as FramescaperProjectVisual;
}

function trackByClipId(
	tracks: readonly Record<string, unknown>[],
	clipIds: ReadonlySet<string>,
): ReadonlyMap<string, string> {
	const result = new Map<string, string>();
	for (const track of tracks) {
		if (!Array.isArray(track.clipIds)) continue;
		for (const clipId of track.clipIds.map(String)) {
			if (clipIds.has(clipId)) result.set(clipId, String(track.id));
		}
	}
	return result;
}

function retainedAdjustmentLayers(
	value: unknown,
	trackIds: ReadonlySet<string>,
): Record<string, unknown>[] {
	const retained: Record<string, unknown>[] = [];
	for (const layer of records(value, 'videoAdjustmentLayers')) {
		if (!Array.isArray(layer.targetTrackIds)) continue;
		const targetTrackIds = layer.targetTrackIds.map(String).filter((id) => trackIds.has(id));
		if (targetTrackIds.length > 0) retained.push({ ...layer, targetTrackIds });
	}
	return retained;
}

function retainedMaskMattes(
	value: unknown,
	sourceIds: ReadonlySet<string>,
): Record<string, unknown>[] {
	const retained: Record<string, unknown>[] = [];
	for (const mask of records(value, 'videoMaskMattes')) {
		const inputs = records(mask.inputs, 'videoMaskMattes.inputs');
		const missingInputNames = new Set(inputs
			.filter(({ sourceRef }) => !sourceIds.has(String(sourceRef)))
			.map(({ name }) => String(name)));
		const nodes = records(mask.nodes, 'videoMaskMattes.nodes');
		if (nodes.some((node) => (
			(node.kind === 'raster' || node.kind === 'alpha')
			&& missingInputNames.has(String(node.inputName))
		))) continue;
		retained.push({
			...mask,
			inputs: inputs.filter(({ sourceRef }) => sourceIds.has(String(sourceRef))),
		});
	}
	return retained;
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
