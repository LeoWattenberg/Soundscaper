/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';
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
import { assertFramescaperProjectVisualCandidateProfile } from './editor-domain-runtime-profile.ts';
import { validateFramescaperProjectVisual, type FramescaperProjectVisual } from './editor-project-visual.ts';

export interface FramescaperVisualClipboardV8 {
	readonly schemaVersion: 8;
	readonly kind: 'framescaper-visual-fragment';
	readonly originProjectId: string;
	readonly originRevision: number;
	readonly sources: readonly (VideoStillSourceV1 | VideoGeneratorSourceV1)[];
	readonly clips: readonly (VideoStillClipV1 | VideoGeneratorClipV1)[];
	readonly adjustmentLayers: readonly VideoAdjustmentLayerV1[];
	readonly presets: readonly VideoVisualPresetV1[];
	readonly maskMattes: readonly VideoMaskMatteGraphV1[];
	readonly freezeFallbacks: readonly VideoFreezeFallbackV1[];
}

export interface FramescaperVisualClipboardPasteV8 {
	readonly sources: readonly (VideoStillSourceV1 | VideoGeneratorSourceV1)[];
	readonly clips: readonly (VideoStillClipV1 | VideoGeneratorClipV1)[];
	readonly adjustmentLayers: readonly VideoAdjustmentLayerV1[];
	readonly presets: readonly VideoVisualPresetV1[];
	readonly maskMattes: readonly VideoMaskMatteGraphV1[];
	readonly freezeFallbacks: readonly VideoFreezeFallbackV1[];
}

const FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'originProjectId', 'originRevision', 'sources', 'clips',
	'adjustmentLayers', 'presets', 'maskMattes', 'freezeFallbacks',
]);

export function createFramescaperVisualClipboardV8(
	profile: unknown,
	project: unknown,
): FramescaperVisualClipboardV8 {
	assertFramescaperProjectVisualCandidateProfile(profile);
	validateFramescaperProjectVisual(profile, project);
	const candidate = project as FramescaperProjectVisual;
	return normalizeFramescaperVisualClipboardV8({
		schemaVersion: 8,
		kind: 'framescaper-visual-fragment',
		originProjectId: candidate.id,
		originRevision: candidate.revision,
		sources: candidate.sources.filter(({ kind }) => kind === 'still' || kind === 'generator'),
		clips: candidate.clips.filter(({ kind }) => kind === 'still' || kind === 'generator'),
		adjustmentLayers: candidate.videoAdjustmentLayers,
		presets: candidate.videoVisualPresets,
		maskMattes: candidate.videoMaskMattes,
		freezeFallbacks: candidate.videoFreezeFallbacks,
	});
}

export function normalizeFramescaperVisualClipboardV8(value: unknown): FramescaperVisualClipboardV8 {
	const record = readClosedDomainRecord(value, 'Framescaper visual clipboard V8', FIELDS);
	if (field(record, 'schemaVersion') !== 8) throw new RangeError('Framescaper visual clipboard requires V8 recopy.');
	if (field(record, 'kind') !== 'framescaper-visual-fragment') throw new RangeError('Framescaper visual clipboard kind is invalid.');
	const sources = collection(record, 'sources').map((source) => {
		const kind = own(source, 'kind');
		if (kind === 'still') return normalizeVideoStillSourceV1(source);
		if (kind === 'generator') return normalizeVideoGeneratorSourceV1(source);
		throw new RangeError('V8 visual clipboard source kind is unsupported.');
	});
	const clips = collection(record, 'clips').map((clip) => {
		const kind = own(clip, 'kind');
		if (kind === 'still') return normalizeVideoStillClipV1(clip);
		if (kind === 'generator') return normalizeVideoGeneratorClipV1(clip);
		throw new RangeError('V8 visual clipboard clip kind is unsupported.');
	});
	return Object.freeze({
		schemaVersion: 8 as const,
		kind: 'framescaper-visual-fragment' as const,
		originProjectId: text(field(record, 'originProjectId'), 'originProjectId'),
		originRevision: integer(field(record, 'originRevision')),
		sources: Object.freeze(sources),
		clips: Object.freeze(clips),
		adjustmentLayers: Object.freeze(collection(record, 'adjustmentLayers').map(normalizeVideoAdjustmentLayerV1)),
		presets: Object.freeze(collection(record, 'presets').map(normalizeVideoVisualPresetV1)),
		maskMattes: Object.freeze(collection(record, 'maskMattes').map(normalizeVideoMaskMatteGraphV1)),
		freezeFallbacks: Object.freeze(collection(record, 'freezeFallbacks').map(normalizeVideoFreezeFallbackV1)),
	});
}

/** Prepare a detached visual fragment using caller-owned fresh and destination identities. */
export function prepareFramescaperVisualClipboardPasteV8(
	clipboardValue: unknown,
	options: Readonly<{
		sourceIdMap: ReadonlyMap<string, string>;
		clipIdMap: ReadonlyMap<string, string>;
		adjustmentLayerIdMap: ReadonlyMap<string, string>;
		presetIdMap: ReadonlyMap<string, string>;
		maskMatteIdMap: ReadonlyMap<string, string>;
		projectReferenceIdMap: ReadonlyMap<string, string>;
	}>,
): FramescaperVisualClipboardPasteV8 {
	const clipboard = normalizeFramescaperVisualClipboardV8(clipboardValue);
	const sourceIds = allocationMap(options?.sourceIdMap, 'sourceIdMap');
	const clipIds = allocationMap(options?.clipIdMap, 'clipIdMap');
	const adjustmentIds = allocationMap(options?.adjustmentLayerIdMap, 'adjustmentLayerIdMap');
	const presetIds = allocationMap(options?.presetIdMap, 'presetIdMap');
	const maskIds = allocationMap(options?.maskMatteIdMap, 'maskMatteIdMap');
	const references = allocationMap(options?.projectReferenceIdMap, 'projectReferenceIdMap');
	const usedSources = new Set<string>();
	const usedClips = new Set<string>();
	const usedAdjustments = new Set<string>();
	const usedPresets = new Set<string>();
	const usedMasks = new Set<string>();
	const usedReferences = new Set<string>();
	const oldIds = new Set<string>([
		...sourceIds.keys(), ...clipIds.keys(), ...adjustmentIds.keys(),
		...presetIds.keys(), ...maskIds.keys(), ...references.keys(),
	]);
	const freshIds = new Set<string>();
	const fresh = (map: ReadonlyMap<string, string>, used: Set<string>, source: string, name: string): string => {
		const target = allocated(map, source, name);
		if (oldIds.has(target)) throw new RangeError(`A V8 paste ${name} allocation must be fresh.`);
		if (freshIds.has(target)) throw new RangeError('V8 paste top-level allocations must be unique.');
		freshIds.add(target);
		used.add(source);
		return target;
	};
	const reference = (source: string, name: string): string => {
		if (sourceIds.has(source)) {
			usedSources.add(source);
			return allocated(sourceIds, source, name);
		}
		usedReferences.add(source);
		return allocated(references, source, name);
	};
	const sources = clipboard.sources.map((source) => {
		const id = fresh(sourceIds, usedSources, source.id, 'source');
		if (source.kind === 'still') return normalizeVideoStillSourceV1({ ...source, id });
		const generator = source.generator.kind === 'external-generator'
			? { ...source.generator, inputs: source.generator.inputs.map((input) => ({
				...input,
				sourceRef: reference(input.sourceRef, 'external-generator input'),
			})) }
			: source.generator;
		return normalizeVideoGeneratorSourceV1({ ...source, id, generator });
	});
	const clips = clipboard.clips.map((clip) => {
		const candidate = {
			...clip,
			id: fresh(clipIds, usedClips, clip.id, 'clip'),
			sourceId: reference(clip.sourceId, 'clip source'),
			sequenceId: reference(clip.sequenceId, 'clip sequence'),
		};
		return clip.kind === 'still'
			? normalizeVideoStillClipV1(candidate)
			: normalizeVideoGeneratorClipV1(candidate);
	});
	const adjustmentLayers = clipboard.adjustmentLayers.map((layer) => normalizeVideoAdjustmentLayerV1({
		...layer,
		id: fresh(adjustmentIds, usedAdjustments, layer.id, 'adjustment layer'),
		sequenceId: reference(layer.sequenceId, 'adjustment-layer sequence'),
		targetTrackIds: layer.targetTrackIds.map((id) => reference(id, 'adjustment-layer track')),
		effectIds: layer.effectIds.map((id) => reference(id, 'adjustment-layer effect')),
	}));
	const presets = clipboard.presets.map((preset) => normalizeVideoVisualPresetV1({
		...preset,
		id: fresh(presetIds, usedPresets, preset.id, 'preset'),
	}));
	const maskMattes = clipboard.maskMattes.map((graph) => normalizeVideoMaskMatteGraphV1({
		...graph,
		id: fresh(maskIds, usedMasks, graph.id, 'mask/matte'),
		inputs: graph.inputs.map((input) => ({
			...input,
			sourceRef: reference(input.sourceRef, 'mask/matte input'),
		})),
	}));
	const freezeFallbacks = clipboard.freezeFallbacks.map((fallback) => normalizeVideoFreezeFallbackV1({
		...fallback,
		renderedSourceId: reference(fallback.renderedSourceId, 'freeze fallback source'),
	}));
	for (const target of references.values()) {
		if (freshIds.has(target)) throw new RangeError('A V8 paste reference cannot collide with a fresh identity.');
	}
	for (const [map, used, name] of [
		[sourceIds, usedSources, 'source'],
		[clipIds, usedClips, 'clip'],
		[adjustmentIds, usedAdjustments, 'adjustment layer'],
		[presetIds, usedPresets, 'preset'],
		[maskIds, usedMasks, 'mask/matte'],
		[references, usedReferences, 'project reference'],
	] as const) assertNoUnusedAllocations(map, used, name);
	return Object.freeze({
		sources: Object.freeze(sources),
		clips: Object.freeze(clips),
		adjustmentLayers: Object.freeze(adjustmentLayers),
		presets: Object.freeze(presets),
		maskMattes: Object.freeze(maskMattes),
		freezeFallbacks: Object.freeze(freezeFallbacks),
	});
}

function collection(record: Readonly<Record<string, unknown>>, key: string): unknown[] {
	return [...readClosedDomainArray(field(record, key), `V8 clipboard ${key}`, 0, 100_000)];
}

function field(record: Readonly<Record<string, unknown>>, key: string): unknown {
	return readClosedDomainField(record, key, 'Framescaper visual clipboard V8');
}

function allocationMap(value: unknown, name: string): ReadonlyMap<string, string> {
	if (!value || typeof value !== 'object'
		|| typeof (value as ReadonlyMap<unknown, unknown>).get !== 'function'
		|| typeof (value as ReadonlyMap<unknown, unknown>).has !== 'function'
		|| typeof (value as ReadonlyMap<unknown, unknown>).entries !== 'function'
		|| !Number.isSafeInteger((value as ReadonlyMap<unknown, unknown>).size)
		|| (value as ReadonlyMap<unknown, unknown>).size > 100_000) {
		throw new TypeError(`V8 paste ${name} must be a bounded map.`);
	}
	return value as ReadonlyMap<string, string>;
}

function allocated(map: ReadonlyMap<string, string>, source: string, name: string): string {
	const value = map.get(source);
	if (value === undefined) throw new ReferenceError(`V8 paste has no mapping for ${name} ${source}.`);
	return stableId(value, `mapped ${name}`);
}

function assertNoUnusedAllocations(
	map: ReadonlyMap<string, string>,
	used: ReadonlySet<string>,
	name: string,
): void {
	for (const [source, target] of map) {
		stableId(source, `${name} allocation source`);
		stableId(target, `${name} allocation target`);
		if (!used.has(source)) throw new RangeError(`V8 ${name} paste contains an unused allocation ${source}.`);
	}
}

function own(value: unknown, key: string): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('V8 clipboard item must be an object.');
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`V8 clipboard ${key} must be data.`);
	return descriptor.value;
}

function text(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 128) throw new TypeError(`${name} is invalid.`);
	return value;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
		throw new TypeError(`${name} must be a stable ID.`);
	}
	return value;
}

function integer(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError('originRevision is invalid.');
	return Number(value);
}
