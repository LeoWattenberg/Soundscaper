/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';
import { normalizeVideoFreezeFallbackV1, type VideoFreezeFallbackV1 } from '../common/editor/video-freeze-v24.ts';
import { normalizeVideoMaskMatteGraphV1, type VideoMaskMatteGraphV1 } from '../common/editor/video-mask-matte-v24.ts';
import { normalizeVideoVisualPresetV1, type VideoVisualPresetV1 } from '../common/editor/video-visual-preset-v24.ts';
import {
	normalizeVideoAdjustmentLayerV1,
	normalizeVideoGeneratorClipV1,
	normalizeVideoGeneratorSourceV1,
	normalizeVideoStillClipV1,
	normalizeVideoStillSourceV1,
	type VideoAdjustmentLayerV1,
	type VideoGeneratorClipV1,
	type VideoGeneratorSourceV1,
	type VideoStillClipV1,
	type VideoStillSourceV1,
} from '../common/editor/video-visual-model-v24.ts';

export type FramescaperVisualSourceVisual = VideoStillSourceV1 | VideoGeneratorSourceV1;
export type FramescaperVisualClipVisual = VideoStillClipV1 | VideoGeneratorClipV1;
export type FramescaperVisualClipPlacementVisual =
	| Readonly<{ readonly scope: 'timeline'; readonly trackId: string }>
	| Readonly<{ readonly scope: 'project-bin' }>;

export interface FramescaperVideoVisualSourceSetCommandVisual {
	readonly type: 'video-visual-source/set';
	readonly sourceId: string;
	readonly expectedSource: FramescaperVisualSourceVisual | null;
	readonly source: FramescaperVisualSourceVisual | null;
}

export interface FramescaperVideoVisualClipSetCommandVisual {
	readonly type: 'video-visual-clip/set';
	readonly clipId: string;
	readonly expectedClip: FramescaperVisualClipVisual | null;
	readonly expectedPlacement: FramescaperVisualClipPlacementVisual | null;
	readonly clip: FramescaperVisualClipVisual | null;
	readonly placement: FramescaperVisualClipPlacementVisual | null;
}

export interface FramescaperVideoAdjustmentLayerSetCommandVisual {
	readonly type: 'video-adjustment-layer/set';
	readonly adjustmentLayerId: string;
	readonly expectedAdjustmentLayer: VideoAdjustmentLayerV1 | null;
	readonly adjustmentLayer: VideoAdjustmentLayerV1 | null;
}

export interface FramescaperVideoVisualPresetSetCommandVisual {
	readonly type: 'video-visual-preset/set';
	readonly presetId: string;
	readonly expectedPreset: VideoVisualPresetV1 | null;
	readonly preset: VideoVisualPresetV1 | null;
}

export interface FramescaperVideoMaskMatteSetCommandVisual {
	readonly type: 'video-mask-matte/set';
	readonly maskMatteId: string;
	readonly expectedMaskMatte: VideoMaskMatteGraphV1 | null;
	readonly maskMatte: VideoMaskMatteGraphV1 | null;
}

export interface FramescaperVideoFreezeFallbackSetCommandVisual {
	readonly type: 'video-freeze-fallback/set';
	readonly renderedSourceId: string;
	readonly expectedFreezeFallback: VideoFreezeFallbackV1 | null;
	readonly freezeFallback: VideoFreezeFallbackV1 | null;
}

export type FramescaperOwnedVisualCommandVisual =
	| FramescaperVideoVisualSourceSetCommandVisual
	| FramescaperVideoVisualClipSetCommandVisual
	| FramescaperVideoAdjustmentLayerSetCommandVisual
	| FramescaperVideoVisualPresetSetCommandVisual
	| FramescaperVideoMaskMatteSetCommandVisual
	| FramescaperVideoFreezeFallbackSetCommandVisual;

const TYPES = new Set<string>([
	'video-visual-source/set', 'video-visual-clip/set', 'video-adjustment-layer/set',
	'video-visual-preset/set', 'video-mask-matte/set', 'video-freeze-fallback/set',
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function isFramescaperOwnedVisualCommandTypeVisual(type: string): boolean {
	return TYPES.has(type);
}

export function snapshotFramescaperOwnedVisualCommandVisual(value: unknown): FramescaperOwnedVisualCommandVisual {
	const type = commandType(value);
	if (type === 'video-visual-source/set') return sourceCommand(value);
	if (type === 'video-visual-clip/set') return clipCommand(value);
	if (type === 'video-adjustment-layer/set') return adjustmentCommand(value);
	if (type === 'video-visual-preset/set') return presetCommand(value);
	if (type === 'video-mask-matte/set') return maskCommand(value);
	if (type === 'video-freeze-fallback/set') return freezeCommand(value);
	throw new RangeError('Framescaper visual visual command type is unsupported.');
}

export function applyFramescaperOwnedVisualCommandVisual(
	project: Record<string, unknown>,
	command: FramescaperOwnedVisualCommandVisual,
): void {
	if (command.type === 'video-visual-source/set') return applySource(project, command);
	if (command.type === 'video-visual-clip/set') return applyClip(project, command);
	if (command.type === 'video-adjustment-layer/set') {
		return replaceById(project, 'videoAdjustmentLayers', 'id', command.adjustmentLayerId,
			command.expectedAdjustmentLayer, command.adjustmentLayer, 'visual adjustment layer');
	}
	if (command.type === 'video-visual-preset/set') {
		return replaceById(project, 'videoVisualPresets', 'id', command.presetId,
			command.expectedPreset, command.preset, 'visual visual preset');
	}
	if (command.type === 'video-mask-matte/set') {
		return replaceById(project, 'videoMaskMattes', 'id', command.maskMatteId,
			command.expectedMaskMatte, command.maskMatte, 'visual mask/matte');
	}
	return replaceById(project, 'videoFreezeFallbacks', 'renderedSourceId', command.renderedSourceId,
		command.expectedFreezeFallback, command.freezeFallback, 'visual freeze fallback');
}

function sourceCommand(value: unknown): FramescaperVideoVisualSourceSetCommandVisual {
	const record = exact(value, ['type', 'sourceId', 'expectedSource', 'source'], 'visual source command');
	const sourceId = stableId(field(record, 'sourceId'), 'sourceId');
	const expectedSource = optionalSource(field(record, 'expectedSource'));
	const source = optionalSource(field(record, 'source'));
	assertMutation(expectedSource, source, 'visual source');
	assertIdentity(sourceId, expectedSource, source, 'visual source');
	return Object.freeze({ type: 'video-visual-source/set', sourceId, expectedSource, source });
}

function clipCommand(value: unknown): FramescaperVideoVisualClipSetCommandVisual {
	const record = exact(value, [
		'type', 'clipId', 'expectedClip', 'expectedPlacement', 'clip', 'placement',
	], 'visual clip command');
	const clipId = stableId(field(record, 'clipId'), 'clipId');
	const expectedClip = optionalClip(field(record, 'expectedClip'));
	const clip = optionalClip(field(record, 'clip'));
	const expectedPlacement = optionalPlacement(field(record, 'expectedPlacement'));
	const placement = optionalPlacement(field(record, 'placement'));
	assertMutation(expectedClip, clip, 'visual clip');
	assertIdentity(clipId, expectedClip, clip, 'visual clip');
	if ((expectedClip === null) !== (expectedPlacement === null)
		|| (clip === null) !== (placement === null)) {
		throw new RangeError('A visual visual clip and its placement are present or absent together.');
	}
	return Object.freeze({ type: 'video-visual-clip/set', clipId, expectedClip, expectedPlacement, clip, placement });
}

function adjustmentCommand(value: unknown): FramescaperVideoAdjustmentLayerSetCommandVisual {
	const record = exact(value, [
		'type', 'adjustmentLayerId', 'expectedAdjustmentLayer', 'adjustmentLayer',
	], 'adjustment-layer command');
	const adjustmentLayerId = stableId(field(record, 'adjustmentLayerId'), 'adjustmentLayerId');
	const expectedAdjustmentLayer = optional(field(record, 'expectedAdjustmentLayer'), normalizeVideoAdjustmentLayerV1);
	const adjustmentLayer = optional(field(record, 'adjustmentLayer'), normalizeVideoAdjustmentLayerV1);
	assertMutation(expectedAdjustmentLayer, adjustmentLayer, 'adjustment layer');
	assertIdentity(adjustmentLayerId, expectedAdjustmentLayer, adjustmentLayer, 'adjustment layer');
	return Object.freeze({ type: 'video-adjustment-layer/set', adjustmentLayerId,
		expectedAdjustmentLayer, adjustmentLayer });
}

function presetCommand(value: unknown): FramescaperVideoVisualPresetSetCommandVisual {
	const record = exact(value, ['type', 'presetId', 'expectedPreset', 'preset'], 'visual preset command');
	const presetId = stableId(field(record, 'presetId'), 'presetId');
	const expectedPreset = optional(field(record, 'expectedPreset'), normalizeVideoVisualPresetV1);
	const preset = optional(field(record, 'preset'), normalizeVideoVisualPresetV1);
	assertMutation(expectedPreset, preset, 'visual preset');
	assertIdentity(presetId, expectedPreset, preset, 'visual preset');
	return Object.freeze({ type: 'video-visual-preset/set', presetId, expectedPreset, preset });
}

function maskCommand(value: unknown): FramescaperVideoMaskMatteSetCommandVisual {
	const record = exact(value, ['type', 'maskMatteId', 'expectedMaskMatte', 'maskMatte'], 'mask/matte command');
	const maskMatteId = stableId(field(record, 'maskMatteId'), 'maskMatteId');
	const expectedMaskMatte = optional(field(record, 'expectedMaskMatte'), normalizeVideoMaskMatteGraphV1);
	const maskMatte = optional(field(record, 'maskMatte'), normalizeVideoMaskMatteGraphV1);
	assertMutation(expectedMaskMatte, maskMatte, 'mask/matte');
	assertIdentity(maskMatteId, expectedMaskMatte, maskMatte, 'mask/matte');
	return Object.freeze({ type: 'video-mask-matte/set', maskMatteId, expectedMaskMatte, maskMatte });
}

function freezeCommand(value: unknown): FramescaperVideoFreezeFallbackSetCommandVisual {
	const record = exact(value, [
		'type', 'renderedSourceId', 'expectedFreezeFallback', 'freezeFallback',
	], 'freeze-fallback command');
	const renderedSourceId = stableId(field(record, 'renderedSourceId'), 'renderedSourceId');
	const expectedFreezeFallback = optional(field(record, 'expectedFreezeFallback'), normalizeVideoFreezeFallbackV1);
	const freezeFallback = optional(field(record, 'freezeFallback'), normalizeVideoFreezeFallbackV1);
	assertMutation(expectedFreezeFallback, freezeFallback, 'freeze fallback');
	assertIdentity(renderedSourceId, expectedFreezeFallback, freezeFallback, 'freeze fallback', 'renderedSourceId');
	return Object.freeze({ type: 'video-freeze-fallback/set', renderedSourceId,
		expectedFreezeFallback, freezeFallback });
}

function applySource(project: Record<string, unknown>, command: FramescaperVideoVisualSourceSetCommandVisual): void {
	const sources = records(project.sources, 'sources');
	const index = sources.findIndex(({ id, kind }) => id === command.sourceId
		&& (kind === 'still' || kind === 'generator'));
	const current = index < 0 ? null : sources[index]!;
	if (!same(current, command.expectedSource)) throw new Error('The expected visual visual source is stale.');
	if (command.source === null) {
		if (index < 0) throw new ReferenceError(`The visual visual source ${command.sourceId} is missing.`);
		sources.splice(index, 1);
	}
	else if (index < 0) sources.push(command.source as unknown as Record<string, unknown>);
	else sources[index] = command.source as unknown as Record<string, unknown>;
	project.sources = sources;
}

function applyClip(project: Record<string, unknown>, command: FramescaperVideoVisualClipSetCommandVisual): void {
	const timeline = records(project.clips, 'clips');
	const bin = record(project.projectBin, 'projectBin');
	const binClips = records(bin.clips, 'projectBin.clips');
	const tracks = records(project.tracks, 'tracks');
	const timelineIndex = timeline.findIndex(({ id, kind }) => id === command.clipId
		&& (kind === 'still' || kind === 'generator'));
	const binIndex = binClips.findIndex(({ id, kind }) => id === command.clipId
		&& (kind === 'still' || kind === 'generator'));
	const current = timelineIndex >= 0 ? timeline[timelineIndex]! : binIndex >= 0 ? binClips[binIndex]! : null;
	const owner = timelineIndex < 0 ? undefined : tracks.find((track) => (
		Array.isArray(track.clipIds) && track.clipIds.includes(command.clipId)
	));
	const currentPlacement = current === null ? null : timelineIndex >= 0
		? Object.freeze({ scope: 'timeline' as const, trackId: String(owner?.id) })
		: Object.freeze({ scope: 'project-bin' as const });
	if (!same(current, command.expectedClip) || !same(currentPlacement, command.expectedPlacement)) {
		throw new Error('The expected visual visual clip or placement is stale.');
	}
	assertUnlocked(owner, 'source');
	if (timelineIndex >= 0) timeline.splice(timelineIndex, 1);
	if (binIndex >= 0) binClips.splice(binIndex, 1);
	for (const track of tracks) {
		if (Array.isArray(track.clipIds)) track.clipIds = track.clipIds.filter((id) => id !== command.clipId);
	}
	const placement = command.placement;
	if (command.clip !== null && placement?.scope === 'timeline') {
		const target = tracks.find(({ id }) => id === placement.trackId);
		if (!target || target.type !== 'video') throw new ReferenceError('A visual visual clip requires a video track.');
		assertUnlocked(target, 'target');
		timeline.push(command.clip as unknown as Record<string, unknown>);
		(target.clipIds as unknown[]).push(command.clipId);
	} else if (command.clip !== null) {
		binClips.push(command.clip as unknown as Record<string, unknown>);
	}
	project.clips = timeline;
	bin.clips = binClips;
}

function replaceById(
	project: Record<string, unknown>, fieldName: string, idName: string, id: string,
	expected: unknown, replacement: unknown,
	label: string,
): void {
	const values = records(project[fieldName], fieldName);
	const index = values.findIndex((item) => item[idName] === id);
	const current = index < 0 ? null : values[index]!;
	if (!same(current, expected)) throw new Error(`The expected ${label} is stale.`);
	if (replacement === null) {
		if (index < 0) throw new ReferenceError(`The ${label} ${id} is missing.`);
		values.splice(index, 1);
	}
	else if (index < 0) values.push(replacement as Record<string, unknown>);
	else values[index] = replacement as Record<string, unknown>;
	project[fieldName] = values;
}

function optionalSource(value: unknown): FramescaperVisualSourceVisual | null {
	if (value === null) return null;
	const kind = itemKind(value);
	if (kind === 'still') return normalizeVideoStillSourceV1(value);
	if (kind === 'generator') return normalizeVideoGeneratorSourceV1(value);
	throw new RangeError('visual visual source kind is unsupported.');
}

function optionalClip(value: unknown): FramescaperVisualClipVisual | null {
	if (value === null) return null;
	const kind = itemKind(value);
	if (kind === 'still') return normalizeVideoStillClipV1(value);
	if (kind === 'generator') return normalizeVideoGeneratorClipV1(value);
	throw new RangeError('visual visual clip kind is unsupported.');
}

function optionalPlacement(value: unknown): FramescaperVisualClipPlacementVisual | null {
	if (value === null) return null;
	const discriminant = readClosedDomainRecord(value, 'visual visual clip placement', ['scope', 'trackId'], ['scope']);
	const scope = field(discriminant, 'scope');
	if (scope === 'project-bin') {
		readClosedDomainRecord(value, 'visual project-bin placement', ['scope']);
		return Object.freeze({ scope });
	}
	if (scope === 'timeline') {
		const placement = readClosedDomainRecord(value, 'visual timeline placement', ['scope', 'trackId']);
		return Object.freeze({ scope, trackId: stableId(field(placement, 'trackId'), 'placement trackId') });
	}
	throw new RangeError('visual visual clip placement scope is unsupported.');
}

function optional<T>(value: unknown, normalize: (value: unknown) => T): T | null {
	return value === null ? null : normalize(value);
}

function assertMutation(before: unknown, after: unknown, label: string): void {
	if (before === null && after === null) throw new RangeError(`A visual ${label} command must mutate state.`);
}

function assertIdentity(
	id: string, before: unknown, after: unknown, label: string, key = 'id',
): void {
	for (const value of [before, after]) {
		if (value !== null && (value as unknown as Readonly<Record<string, unknown>>)[key] !== id) {
			throw new RangeError(`A visual ${label} command cannot change identity.`);
		}
	}
}

function commandType(value: unknown): string {
	const type = field(record(value, 'Framescaper visual visual command'), 'type');
	if (typeof type !== 'string') throw new TypeError('Framescaper visual command.type must be a string.');
	return type;
}

function itemKind(value: unknown): unknown {
	return field(record(value, 'visual visual item'), 'kind');
}

function exact(value: unknown, fields: readonly string[], name: string): Readonly<Record<string, unknown>> {
	return readClosedDomainRecord(value, `Framescaper visual ${name}`, fields);
}

function field(record: Readonly<Record<string, unknown>>, name: string): unknown {
	return readClosedDomainField(record, name, 'Framescaper visual command');
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`Framescaper visual ${name} must be a stable ID.`);
	return value;
}

function assertUnlocked(track: Record<string, unknown> | undefined, name: string): void {
	if (track?.locked === true) throw new Error(`The visual visual clip ${name} track is locked.`);
}

function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
