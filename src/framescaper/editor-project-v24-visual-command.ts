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

export type FramescaperVisualSourceV24 = VideoStillSourceV1 | VideoGeneratorSourceV1;
export type FramescaperVisualClipV24 = VideoStillClipV1 | VideoGeneratorClipV1;
export type FramescaperVisualClipPlacementV24 =
	| Readonly<{ readonly scope: 'timeline'; readonly trackId: string }>
	| Readonly<{ readonly scope: 'project-bin' }>;

export interface FramescaperVideoVisualSourceSetCommandV24 {
	readonly type: 'video-visual-source/set';
	readonly sourceId: string;
	readonly expectedSource: FramescaperVisualSourceV24 | null;
	readonly source: FramescaperVisualSourceV24 | null;
}

export interface FramescaperVideoVisualClipSetCommandV24 {
	readonly type: 'video-visual-clip/set';
	readonly clipId: string;
	readonly expectedClip: FramescaperVisualClipV24 | null;
	readonly expectedPlacement: FramescaperVisualClipPlacementV24 | null;
	readonly clip: FramescaperVisualClipV24 | null;
	readonly placement: FramescaperVisualClipPlacementV24 | null;
}

export interface FramescaperVideoAdjustmentLayerSetCommandV24 {
	readonly type: 'video-adjustment-layer/set';
	readonly adjustmentLayerId: string;
	readonly expectedAdjustmentLayer: VideoAdjustmentLayerV1 | null;
	readonly adjustmentLayer: VideoAdjustmentLayerV1 | null;
}

export interface FramescaperVideoVisualPresetSetCommandV24 {
	readonly type: 'video-visual-preset/set';
	readonly presetId: string;
	readonly expectedPreset: VideoVisualPresetV1 | null;
	readonly preset: VideoVisualPresetV1 | null;
}

export interface FramescaperVideoMaskMatteSetCommandV24 {
	readonly type: 'video-mask-matte/set';
	readonly maskMatteId: string;
	readonly expectedMaskMatte: VideoMaskMatteGraphV1 | null;
	readonly maskMatte: VideoMaskMatteGraphV1 | null;
}

export interface FramescaperVideoFreezeFallbackSetCommandV24 {
	readonly type: 'video-freeze-fallback/set';
	readonly renderedSourceId: string;
	readonly expectedFreezeFallback: VideoFreezeFallbackV1 | null;
	readonly freezeFallback: VideoFreezeFallbackV1 | null;
}

export type FramescaperOwnedVisualCommandV24 =
	| FramescaperVideoVisualSourceSetCommandV24
	| FramescaperVideoVisualClipSetCommandV24
	| FramescaperVideoAdjustmentLayerSetCommandV24
	| FramescaperVideoVisualPresetSetCommandV24
	| FramescaperVideoMaskMatteSetCommandV24
	| FramescaperVideoFreezeFallbackSetCommandV24;

const TYPES = new Set<string>([
	'video-visual-source/set', 'video-visual-clip/set', 'video-adjustment-layer/set',
	'video-visual-preset/set', 'video-mask-matte/set', 'video-freeze-fallback/set',
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function isFramescaperOwnedVisualCommandTypeV24(type: string): boolean {
	return TYPES.has(type);
}

export function snapshotFramescaperOwnedVisualCommandV24(value: unknown): FramescaperOwnedVisualCommandV24 {
	const type = commandType(value);
	if (type === 'video-visual-source/set') return sourceCommand(value);
	if (type === 'video-visual-clip/set') return clipCommand(value);
	if (type === 'video-adjustment-layer/set') return adjustmentCommand(value);
	if (type === 'video-visual-preset/set') return presetCommand(value);
	if (type === 'video-mask-matte/set') return maskCommand(value);
	if (type === 'video-freeze-fallback/set') return freezeCommand(value);
	throw new RangeError('Framescaper V24 visual command type is unsupported.');
}

export function applyFramescaperOwnedVisualCommandV24(
	project: Record<string, unknown>,
	command: FramescaperOwnedVisualCommandV24,
): void {
	if (command.type === 'video-visual-source/set') return applySource(project, command);
	if (command.type === 'video-visual-clip/set') return applyClip(project, command);
	if (command.type === 'video-adjustment-layer/set') {
		return replaceById(project, 'videoAdjustmentLayers', 'id', command.adjustmentLayerId,
			command.expectedAdjustmentLayer, command.adjustmentLayer, 'V24 adjustment layer');
	}
	if (command.type === 'video-visual-preset/set') {
		return replaceById(project, 'videoVisualPresets', 'id', command.presetId,
			command.expectedPreset, command.preset, 'V24 visual preset');
	}
	if (command.type === 'video-mask-matte/set') {
		return replaceById(project, 'videoMaskMattes', 'id', command.maskMatteId,
			command.expectedMaskMatte, command.maskMatte, 'V24 mask/matte');
	}
	return replaceById(project, 'videoFreezeFallbacks', 'renderedSourceId', command.renderedSourceId,
		command.expectedFreezeFallback, command.freezeFallback, 'V24 freeze fallback');
}

function sourceCommand(value: unknown): FramescaperVideoVisualSourceSetCommandV24 {
	const record = exact(value, ['type', 'sourceId', 'expectedSource', 'source'], 'visual source command');
	const sourceId = stableId(field(record, 'sourceId'), 'sourceId');
	const expectedSource = optionalSource(field(record, 'expectedSource'));
	const source = optionalSource(field(record, 'source'));
	assertMutation(expectedSource, source, 'visual source');
	assertIdentity(sourceId, expectedSource, source, 'visual source');
	return Object.freeze({ type: 'video-visual-source/set', sourceId, expectedSource, source });
}

function clipCommand(value: unknown): FramescaperVideoVisualClipSetCommandV24 {
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
		throw new RangeError('A V24 visual clip and its placement are present or absent together.');
	}
	return Object.freeze({ type: 'video-visual-clip/set', clipId, expectedClip, expectedPlacement, clip, placement });
}

function adjustmentCommand(value: unknown): FramescaperVideoAdjustmentLayerSetCommandV24 {
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

function presetCommand(value: unknown): FramescaperVideoVisualPresetSetCommandV24 {
	const record = exact(value, ['type', 'presetId', 'expectedPreset', 'preset'], 'visual preset command');
	const presetId = stableId(field(record, 'presetId'), 'presetId');
	const expectedPreset = optional(field(record, 'expectedPreset'), normalizeVideoVisualPresetV1);
	const preset = optional(field(record, 'preset'), normalizeVideoVisualPresetV1);
	assertMutation(expectedPreset, preset, 'visual preset');
	assertIdentity(presetId, expectedPreset, preset, 'visual preset');
	return Object.freeze({ type: 'video-visual-preset/set', presetId, expectedPreset, preset });
}

function maskCommand(value: unknown): FramescaperVideoMaskMatteSetCommandV24 {
	const record = exact(value, ['type', 'maskMatteId', 'expectedMaskMatte', 'maskMatte'], 'mask/matte command');
	const maskMatteId = stableId(field(record, 'maskMatteId'), 'maskMatteId');
	const expectedMaskMatte = optional(field(record, 'expectedMaskMatte'), normalizeVideoMaskMatteGraphV1);
	const maskMatte = optional(field(record, 'maskMatte'), normalizeVideoMaskMatteGraphV1);
	assertMutation(expectedMaskMatte, maskMatte, 'mask/matte');
	assertIdentity(maskMatteId, expectedMaskMatte, maskMatte, 'mask/matte');
	return Object.freeze({ type: 'video-mask-matte/set', maskMatteId, expectedMaskMatte, maskMatte });
}

function freezeCommand(value: unknown): FramescaperVideoFreezeFallbackSetCommandV24 {
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

function applySource(project: Record<string, unknown>, command: FramescaperVideoVisualSourceSetCommandV24): void {
	const sources = records(project.sources, 'sources');
	const current = sources.find(({ id, kind }) => id === command.sourceId
		&& (kind === 'still' || kind === 'generator')) ?? null;
	if (!same(current, command.expectedSource)) throw new Error('The expected V24 visual source is stale.');
	const index = sources.indexOf(current as Record<string, unknown>);
	if (command.source === null) sources.splice(index, 1);
	else if (index < 0) sources.push(command.source as unknown as Record<string, unknown>);
	else sources[index] = command.source as unknown as Record<string, unknown>;
	project.sources = sources;
}

function applyClip(project: Record<string, unknown>, command: FramescaperVideoVisualClipSetCommandV24): void {
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
		throw new Error('The expected V24 visual clip or placement is stale.');
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
		if (!target || target.type !== 'video') throw new ReferenceError('A V24 visual clip requires a video track.');
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
	if (replacement === null) values.splice(index, 1);
	else if (index < 0) values.push(replacement as Record<string, unknown>);
	else values[index] = replacement as Record<string, unknown>;
	project[fieldName] = values;
}

function optionalSource(value: unknown): FramescaperVisualSourceV24 | null {
	if (value === null) return null;
	const kind = itemKind(value);
	if (kind === 'still') return normalizeVideoStillSourceV1(value);
	if (kind === 'generator') return normalizeVideoGeneratorSourceV1(value);
	throw new RangeError('V24 visual source kind is unsupported.');
}

function optionalClip(value: unknown): FramescaperVisualClipV24 | null {
	if (value === null) return null;
	const kind = itemKind(value);
	if (kind === 'still') return normalizeVideoStillClipV1(value);
	if (kind === 'generator') return normalizeVideoGeneratorClipV1(value);
	throw new RangeError('V24 visual clip kind is unsupported.');
}

function optionalPlacement(value: unknown): FramescaperVisualClipPlacementV24 | null {
	if (value === null) return null;
	const discriminant = readClosedDomainRecord(value, 'V24 visual clip placement', ['scope', 'trackId'], ['scope']);
	const scope = field(discriminant, 'scope');
	if (scope === 'project-bin') {
		readClosedDomainRecord(value, 'V24 project-bin placement', ['scope']);
		return Object.freeze({ scope });
	}
	if (scope === 'timeline') {
		const placement = readClosedDomainRecord(value, 'V24 timeline placement', ['scope', 'trackId']);
		return Object.freeze({ scope, trackId: stableId(field(placement, 'trackId'), 'placement trackId') });
	}
	throw new RangeError('V24 visual clip placement scope is unsupported.');
}

function optional<T>(value: unknown, normalize: (value: unknown) => T): T | null {
	return value === null ? null : normalize(value);
}

function assertMutation(before: unknown, after: unknown, label: string): void {
	if (before === null && after === null) throw new RangeError(`A V24 ${label} command must mutate state.`);
}

function assertIdentity(
	id: string, before: unknown, after: unknown, label: string, key = 'id',
): void {
	for (const value of [before, after]) {
		if (value !== null && (value as unknown as Readonly<Record<string, unknown>>)[key] !== id) {
			throw new RangeError(`A V24 ${label} command cannot change identity.`);
		}
	}
}

function commandType(value: unknown): string {
	const type = field(record(value, 'Framescaper V24 visual command'), 'type');
	if (typeof type !== 'string') throw new TypeError('Framescaper V24 command.type must be a string.');
	return type;
}

function itemKind(value: unknown): unknown {
	return field(record(value, 'V24 visual item'), 'kind');
}

function exact(value: unknown, fields: readonly string[], name: string): Readonly<Record<string, unknown>> {
	return readClosedDomainRecord(value, `Framescaper V24 ${name}`, fields);
}

function field(record: Readonly<Record<string, unknown>>, name: string): unknown {
	return readClosedDomainField(record, name, 'Framescaper V24 command');
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`Framescaper V24 ${name} must be a stable ID.`);
	return value;
}

function assertUnlocked(track: Record<string, unknown> | undefined, name: string): void {
	if (track?.locked === true) throw new Error(`The V24 visual clip ${name} track is locked.`);
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
