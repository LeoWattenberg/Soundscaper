/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAudioEditorSessionClipboard,
	normalizeAudioEditorSessionClipboard,
	type AudioEditorSessionClipboardSource,
} from '../common/editor/session-clipboard-codec.ts';
import type { AudioEditorClipboard } from '../common/editor/commands/protocol.ts';
import {
	normalizeVideoCaptionTrackV1,
	type VideoCaptionTrackV1,
} from '../common/editor/video-caption-track-v27.ts';
import {
	normalizeVideoColorContextV1,
	normalizeVideoSourceColorInterpretationV1,
	type VideoColorContextV1,
	type VideoSourceColorInterpretationV1,
} from '../common/editor/video-color-management-v27.ts';
import {
	normalizeVideoMotionAnalysisReferenceV1,
	normalizeVideoProcessorStackV1,
	type VideoMotionAnalysisReferenceV1,
	type VideoProcessorStackV1,
} from '../common/editor/video-motion-model-v27.ts';
import {
	normalizeVideoFinishingPresetV1,
	normalizeVideoVisualPresentationV1,
	type VideoFinishingPresetV1,
	type VideoVisualPresentationV1,
} from '../common/editor/video-visual-presentation-v27.ts';
import {
	normalizeFramescaperVisualClipboardV8,
	prepareFramescaperVisualClipboardPasteV8,
	type FramescaperVisualClipboardPasteV8,
	type FramescaperVisualClipboardV8,
} from './editor-session-clipboard-v8.ts';
import { validateFramescaperProjectV27, type FramescaperProjectV27 } from './editor-project-v27.ts';

export interface FramescaperSessionClipboardV11 {
	readonly schemaVersion: 11;
	readonly kind: 'framescaper-session-clipboard';
	readonly originProjectId: string;
	readonly originRevision: number;
	readonly descriptor: AudioEditorClipboard;
	readonly sources: readonly AudioEditorSessionClipboardSource[];
	readonly finishing: FramescaperFinishingClipboardV11;
}

export interface FramescaperFinishingClipboardV11 {
	readonly schemaVersion: 11;
	readonly kind: 'framescaper-finishing-fragment';
	readonly originProjectId: string;
	readonly originRevision: number;
	readonly visual: FramescaperVisualClipboardV8;
	readonly colorContexts: readonly VideoColorContextV1[];
	readonly sourceColorInterpretations: readonly VideoSourceColorInterpretationV1[];
	readonly visualPresentations: readonly VideoVisualPresentationV1[];
	readonly processorStacks: readonly VideoProcessorStackV1[];
	readonly motionAnalyses: readonly VideoMotionAnalysisReferenceV1[];
	readonly finishingPresets: readonly VideoFinishingPresetV1[];
	readonly captionTracks: readonly VideoCaptionTrackV1[];
}

export interface FramescaperVisualClipboardPasteOptionsV8 {
	readonly sourceIdMap: ReadonlyMap<string, string>;
	readonly clipIdMap: ReadonlyMap<string, string>;
	readonly adjustmentLayerIdMap: ReadonlyMap<string, string>;
	readonly presetIdMap: ReadonlyMap<string, string>;
	readonly maskMatteIdMap: ReadonlyMap<string, string>;
	readonly projectReferenceIdMap: ReadonlyMap<string, string>;
}

export interface FramescaperFinishingClipboardPasteOptionsV11 {
	readonly visual: FramescaperVisualClipboardPasteOptionsV8;
	readonly presentationIdMap: ReadonlyMap<string, string>;
	readonly processorStackIdMap: ReadonlyMap<string, string>;
	readonly processorIdMap: ReadonlyMap<string, string>;
	readonly motionAnalysisIdMap: ReadonlyMap<string, string>;
	readonly finishingPresetIdMap: ReadonlyMap<string, string>;
	readonly captionTrackIdMap: ReadonlyMap<string, string>;
	readonly projectReferenceIdMap: ReadonlyMap<string, string>;
}

export interface FramescaperFinishingClipboardPasteV11 {
	readonly visual: FramescaperVisualClipboardPasteV8;
	readonly colorContexts: readonly VideoColorContextV1[];
	readonly sourceColorInterpretations: readonly VideoSourceColorInterpretationV1[];
	readonly visualPresentations: readonly VideoVisualPresentationV1[];
	readonly processorStacks: readonly VideoProcessorStackV1[];
	readonly motionAnalyses: readonly VideoMotionAnalysisReferenceV1[];
	readonly finishingPresets: readonly VideoFinishingPresetV1[];
	readonly captionTracks: readonly VideoCaptionTrackV1[];
}

const FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'originProjectId', 'originRevision', 'visual',
	'colorContexts', 'sourceColorInterpretations', 'visualPresentations',
	'processorStacks', 'motionAnalyses', 'finishingPresets', 'captionTracks',
]);
const SESSION_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'originProjectId', 'originRevision', 'descriptor', 'sources', 'finishing',
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/** Bind the maintained edit descriptor and its V27 finishing payload as one selected V11 clipboard. */
export function createFramescaperSessionClipboardV11(
	profile: unknown,
	projectValue: unknown,
	descriptor: AudioEditorClipboard,
): FramescaperSessionClipboardV11 {
	validateFramescaperProjectV27(profile, projectValue);
	const project = projectValue as FramescaperProjectV27;
	if (records(project.subsequences, 'V27 clipboard subsequences').length > 0) {
		throw new Error(
			'The Framescaper V11 session clipboard cannot preserve a nested-sequence graph; '
			+ 'use .scape copy-only preservation.',
		);
	}
	if (records(project.multicameraGroups, 'V27 clipboard multicamera groups').length > 0) {
		throw new Error(
			'The Framescaper V11 session clipboard cannot preserve a multicamera graph; '
			+ 'use .scape copy-only preservation.',
		);
	}
	const session = createAudioEditorSessionClipboard(project, { descriptor });
	return normalizeFramescaperSessionClipboardV11({
		schemaVersion: 11,
		kind: 'framescaper-session-clipboard',
		originProjectId: project.id,
		originRevision: project.revision,
		descriptor: session.descriptor,
		sources: session.sources,
		finishing: createFramescaperFinishingClipboardV11(profile, project),
	});
}

/** Validate a persisted selected V11 wrapper and retain only descriptor-owned source rows. */
export function normalizeFramescaperSessionClipboardV11(value: unknown): FramescaperSessionClipboardV11 {
	const input = closedRecord(value, SESSION_FIELDS, 'Framescaper session clipboard V11');
	if (input.schemaVersion !== 11) throw new RangeError('Framescaper session clipboard requires V11 re-copy.');
	if (input.kind !== 'framescaper-session-clipboard') {
		throw new RangeError('Framescaper session clipboard kind is unsupported.');
	}
	const originProjectId = stableId(input.originProjectId, 'originProjectId');
	const originRevision = nonNegativeInteger(input.originRevision, 'originRevision');
	const session = normalizeAudioEditorSessionClipboard({
		schemaVersion: 1,
		originProjectId,
		descriptor: input.descriptor,
		sources: input.sources,
	});
	const finishing = normalizeFramescaperFinishingClipboardV11(input.finishing);
	if (finishing.originProjectId !== originProjectId || finishing.originRevision !== originRevision) {
		throw new RangeError('V11 session and finishing clipboard origins must match exactly.');
	}
	return deepFreeze({
		schemaVersion: 11 as const,
		kind: 'framescaper-session-clipboard' as const,
		originProjectId,
		originRevision,
		descriptor: session.descriptor,
		sources: session.sources,
		finishing,
	});
}

export function createFramescaperFinishingClipboardV11(
	profile: unknown,
	projectValue: unknown,
): FramescaperFinishingClipboardV11 {
	validateFramescaperProjectV27(profile, projectValue);
	const project = projectValue as FramescaperProjectV27;
	const visual = normalizeFramescaperVisualClipboardV8({
		schemaVersion: 8,
		kind: 'framescaper-visual-fragment',
		originProjectId: project.id,
		originRevision: project.revision,
		sources: records(project.sources, 'V27 clipboard sources')
			.filter(({ kind }) => kind === 'still' || kind === 'generator'),
		clips: records(project.clips, 'V27 clipboard clips')
			.filter(({ kind }) => kind === 'still' || kind === 'generator'),
		adjustmentLayers: project.videoAdjustmentLayers,
		presets: project.videoVisualPresets,
		maskMattes: project.videoMaskMattes,
		freezeFallbacks: project.videoFreezeFallbacks,
	});
	return normalizeFramescaperFinishingClipboardV11({
		schemaVersion: 11,
		kind: 'framescaper-finishing-fragment',
		originProjectId: project.id,
		originRevision: project.revision,
		visual,
		colorContexts: project.videoColorContexts,
		sourceColorInterpretations: project.videoSourceColorInterpretations,
		visualPresentations: project.videoVisualPresentations,
		processorStacks: project.videoProcessorStacks,
		motionAnalyses: project.videoMotionAnalyses,
		finishingPresets: project.videoFinishingPresets,
		captionTracks: project.videoCaptionTracks,
	});
}

export function normalizeFramescaperFinishingClipboardV11(
	value: unknown,
): FramescaperFinishingClipboardV11 {
	const input = closedRecord(value, FIELDS, 'Framescaper finishing clipboard V11');
	if (input.schemaVersion !== 11) throw new RangeError('Framescaper finishing clipboard requires V11 re-copy.');
	if (input.kind !== 'framescaper-finishing-fragment') {
		throw new RangeError('Framescaper finishing clipboard kind is unsupported.');
	}
	const originProjectId = stableId(input.originProjectId, 'originProjectId');
	const originRevision = nonNegativeInteger(input.originRevision, 'originRevision');
	const visual = normalizeFramescaperVisualClipboardV8(input.visual);
	if (visual.originProjectId !== originProjectId || visual.originRevision !== originRevision) {
		throw new RangeError('V11 and nested V8 clipboard origins must match exactly.');
	}
	return deepFreeze({
		schemaVersion: 11 as const,
		kind: 'framescaper-finishing-fragment' as const,
		originProjectId,
		originRevision,
		visual,
		colorContexts: uniqueKeyCollection(
			input.colorContexts, 'V11 color contexts', normalizeVideoColorContextV1, ({ sequenceId }) => sequenceId,
		),
		sourceColorInterpretations: uniqueKeyCollection(
			input.sourceColorInterpretations, 'V11 source interpretations',
			normalizeVideoSourceColorInterpretationV1, ({ sourceId }) => sourceId,
		),
		visualPresentations: uniqueCollection(
			input.visualPresentations, 'V11 visual presentations', normalizeVideoVisualPresentationV1,
		),
		processorStacks: uniqueCollection(
			input.processorStacks, 'V11 processor stacks', normalizeVideoProcessorStackV1,
		),
		motionAnalyses: uniqueCollection(
			input.motionAnalyses, 'V11 motion analyses', normalizeVideoMotionAnalysisReferenceV1,
		),
		finishingPresets: uniqueCollection(
			input.finishingPresets, 'V11 finishing presets', normalizeVideoFinishingPresetV1,
		),
		captionTracks: uniqueCollection(
			input.captionTracks, 'V11 caption tracks', normalizeVideoCaptionTrackV1,
		),
	});
}

export function prepareFramescaperFinishingClipboardPasteV11(
	clipboardValue: unknown,
	options: FramescaperFinishingClipboardPasteOptionsV11,
): FramescaperFinishingClipboardPasteV11 {
	const clipboard = normalizeFramescaperFinishingClipboardV11(clipboardValue);
	const maps = snapshotMaps(options);
	assertFreshAllocations(maps);
	const visual = prepareFramescaperVisualClipboardPasteV8(clipboard.visual, options.visual);
	const used = new Map<ReadonlyMap<string, string>, Set<string>>();
	for (const map of maps.owned) used.set(map, new Set());
	const reference = (source: string, candidates: readonly ReadonlyMap<string, string>[], name: string): string => {
		for (const map of candidates) {
			if (map.has(source)) return mapped(map, source, name);
		}
		const target = mapped(maps.references, source, name);
		used.get(maps.references)!.add(source);
		return target;
	};
	const fresh = (map: ReadonlyMap<string, string>, source: string, name: string): string => {
		used.get(map)!.add(source);
		return mapped(map, source, name);
	};
	const colorContexts = clipboard.colorContexts.map((context) => normalizeVideoColorContextV1({
		...context,
		sequenceId: reference(context.sequenceId, [], 'color-context sequence'),
	}));
	const sourceColorInterpretations = clipboard.sourceColorInterpretations.map((interpretation) => (
		normalizeVideoSourceColorInterpretationV1({
			...interpretation,
			sourceId: reference(interpretation.sourceId, [maps.visualSources], 'interpreted source'),
		})
	));
	const processorStacks = clipboard.processorStacks.map((stack) => normalizeVideoProcessorStackV1({
		...stack,
		id: fresh(maps.stacks, stack.id, 'processor stack'),
		sourceId: reference(stack.sourceId, [maps.visualSources], 'processor source'),
		processors: stack.processors.map((processor) => ({
			...processor,
			id: fresh(maps.processors, processor.id, 'video processor'),
			...('analysisId' in processor ? {
				analysisId: mapped(maps.analyses, processor.analysisId, 'processor analysis'),
			} : {}),
		})),
	}));
	const motionAnalyses = clipboard.motionAnalyses.map((analysis) => normalizeVideoMotionAnalysisReferenceV1({
		...analysis,
		id: fresh(maps.analyses, analysis.id, 'motion analysis'),
		sourceId: reference(analysis.sourceId, [maps.visualSources], 'analysis source'),
		processorStackId: mapped(maps.stacks, analysis.processorStackId, 'analysis processor stack'),
	}));
	const visualPresentations = clipboard.visualPresentations.map((presentation) => (
		normalizeVideoVisualPresentationV1({
			...presentation,
			id: fresh(maps.presentations, presentation.id, 'visual presentation'),
			owner: {
				...presentation.owner,
				id: reference(presentation.owner.id, ownerMaps(presentation.owner.kind, maps), 'presentation owner'),
			},
			processorStackId: presentation.processorStackId === null ? null
				: mapped(maps.stacks, presentation.processorStackId, 'presentation processor stack'),
			maskMatteIds: presentation.maskMatteIds.map((id) => reference(
				id, [maps.visualMasks], 'presentation mask/matte',
			)),
		})
	));
	const finishingPresets = clipboard.finishingPresets.map((preset) => normalizeVideoFinishingPresetV1({
		...preset,
		id: fresh(maps.presets, preset.id, 'finishing preset'),
	}));
	const captionTracks = clipboard.captionTracks.map((track) => normalizeVideoCaptionTrackV1({
		...structuredClone(track),
		id: fresh(maps.captions, track.id, 'caption track'),
		sequenceId: reference(track.sequenceId, [], 'caption sequence'),
	}));
	for (const map of maps.owned) assertNoUnused(map, used.get(map)!, 'V11');
	assertNoUnused(maps.references, used.get(maps.references)!, 'V11 project reference');
	return deepFreeze({
		visual, colorContexts, sourceColorInterpretations, visualPresentations,
		processorStacks, motionAnalyses, finishingPresets, captionTracks,
	});
}

interface ClipboardMaps {
	readonly visualSources: ReadonlyMap<string, string>;
	readonly visualClips: ReadonlyMap<string, string>;
	readonly visualAdjustments: ReadonlyMap<string, string>;
	readonly visualPresets: ReadonlyMap<string, string>;
	readonly visualMasks: ReadonlyMap<string, string>;
	readonly presentations: ReadonlyMap<string, string>;
	readonly stacks: ReadonlyMap<string, string>;
	readonly processors: ReadonlyMap<string, string>;
	readonly analyses: ReadonlyMap<string, string>;
	readonly presets: ReadonlyMap<string, string>;
	readonly captions: ReadonlyMap<string, string>;
	readonly references: ReadonlyMap<string, string>;
	readonly owned: readonly ReadonlyMap<string, string>[];
}

function snapshotMaps(options: FramescaperFinishingClipboardPasteOptionsV11): ClipboardMaps {
	const visualSources = allocationMap(options?.visual?.sourceIdMap, 'visual.sourceIdMap');
	const visualClips = allocationMap(options?.visual?.clipIdMap, 'visual.clipIdMap');
	const visualAdjustments = allocationMap(options?.visual?.adjustmentLayerIdMap, 'visual.adjustmentLayerIdMap');
	const visualPresets = allocationMap(options?.visual?.presetIdMap, 'visual.presetIdMap');
	const visualMasks = allocationMap(options?.visual?.maskMatteIdMap, 'visual.maskMatteIdMap');
	const presentations = allocationMap(options?.presentationIdMap, 'presentationIdMap');
	const stacks = allocationMap(options?.processorStackIdMap, 'processorStackIdMap');
	const processors = allocationMap(options?.processorIdMap, 'processorIdMap');
	const analyses = allocationMap(options?.motionAnalysisIdMap, 'motionAnalysisIdMap');
	const presets = allocationMap(options?.finishingPresetIdMap, 'finishingPresetIdMap');
	const captions = allocationMap(options?.captionTrackIdMap, 'captionTrackIdMap');
	const references = allocationMap(options?.projectReferenceIdMap, 'projectReferenceIdMap');
	return {
		visualSources, visualClips, visualAdjustments, visualPresets, visualMasks,
		presentations, stacks, processors, analyses, presets, captions, references,
		owned: [presentations, stacks, processors, analyses, presets, captions, references],
	};
}

function ownerMaps(kind: VideoVisualPresentationV1['owner']['kind'], maps: ClipboardMaps) {
	if (kind === 'source' || kind === 'generator') return [maps.visualSources];
	if (kind === 'clip') return [maps.visualClips];
	if (kind === 'adjustment-layer') return [maps.visualAdjustments];
	return [maps.visualMasks];
}

function assertFreshAllocations(maps: ClipboardMaps): void {
	const allOwned = [
		maps.visualSources, maps.visualClips, maps.visualAdjustments, maps.visualPresets,
		maps.visualMasks, maps.presentations, maps.stacks, maps.processors, maps.analyses,
		maps.presets, maps.captions,
	];
	const old = new Set([...allOwned, maps.references].flatMap((map) => [...map.keys()]));
	const fresh = new Set<string>();
	for (const map of allOwned) {
		for (const [source, targetValue] of map) {
			stableId(source, 'V11 allocation source');
			const target = stableId(targetValue, 'V11 allocation target');
			if (old.has(target)) throw new RangeError('Every V11 paste allocation must be fresh.');
			if (fresh.has(target)) throw new RangeError('V11 paste allocations must be globally unique.');
			fresh.add(target);
		}
	}
	for (const [source, target] of maps.references) {
		stableId(source, 'V11 reference source');
		if (fresh.has(stableId(target, 'V11 reference target'))) {
			throw new RangeError('A V11 project reference cannot collide with a fresh allocation.');
		}
	}
}

function mapped(map: ReadonlyMap<string, string>, source: string, name: string): string {
	const value = map.get(source);
	if (value === undefined) throw new ReferenceError(`V11 paste has no mapping for ${name} ${source}.`);
	return stableId(value, `mapped ${name}`);
}

function allocationMap(value: unknown, name: string): ReadonlyMap<string, string> {
	if (!value || typeof value !== 'object'
		|| typeof (value as ReadonlyMap<unknown, unknown>).get !== 'function'
		|| typeof (value as ReadonlyMap<unknown, unknown>).has !== 'function'
		|| typeof (value as ReadonlyMap<unknown, unknown>).entries !== 'function'
		|| !Number.isSafeInteger((value as ReadonlyMap<unknown, unknown>).size)
		|| (value as ReadonlyMap<unknown, unknown>).size > 100_000) {
		throw new TypeError(`V11 paste ${name} must be a bounded map.`);
	}
	return value as ReadonlyMap<string, string>;
}

function assertNoUnused(
	map: ReadonlyMap<string, string>,
	used: ReadonlySet<string>,
	name: string,
): void {
	for (const source of map.keys()) {
		if (!used.has(source)) throw new RangeError(`${name} paste contains an unused allocation ${source}.`);
	}
}

function collection<Item>(value: unknown, name: string, normalize: (item: unknown) => Item): readonly Item[] {
	if (!Array.isArray(value) || value.length > 100_000) throw new RangeError(`${name} must be a bounded array.`);
	return Object.freeze(value.map(normalize));
}

function uniqueCollection<Item extends Readonly<{ id: string }>>(
	value: unknown,
	name: string,
	normalize: (item: unknown) => Item,
): readonly Item[] {
	const items = collection(value, name, normalize);
	if (new Set(items.map(({ id }) => id)).size !== items.length) throw new RangeError(`${name} identities must be unique.`);
	return items;
}

function uniqueKeyCollection<Item>(
	value: unknown,
	name: string,
	normalize: (item: unknown) => Item,
	key: (item: Item) => string,
): readonly Item[] {
	const items = collection(value, name, normalize);
	if (new Set(items.map(key)).size !== items.length) throw new RangeError(`${name} owners must be unique.`);
	return items;
}

function closedRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const result = value as Record<string, unknown>;
	const keys = Reflect.ownKeys(result);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} must carry exactly its schema keys.`);
	}
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(result, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property.`);
		}
	}
	return result;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`${name}[${String(index)}] must be an object.`);
		return item as Record<string, unknown>;
	});
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${name} must be a stable project identity.`);
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
		Object.freeze(value);
	}
	return value;
}
