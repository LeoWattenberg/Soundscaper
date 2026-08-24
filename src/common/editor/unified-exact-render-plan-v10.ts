/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';
import { fingerprintNativeMediaPlan } from './native-media-plan-canonical-form.ts';
import {
	computeVideoFreezeFreshnessV1,
	classifyVideoFreezeFallbackV1,
	normalizeVideoFreezeFallbackV1,
	type VideoFreezeFallbackDispositionV1,
	type VideoFreezeFallbackV1,
	type VideoFreezeFreshnessInputV1,
} from './video-freeze-v24.ts';
import {
	normalizeVideoMaskMatteGraphV1,
	type VideoMaskMatteGraphV1,
} from './video-mask-matte-v24.ts';
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
} from './video-visual-model-v24.ts';
import {
	normalizeVideoVisualPresetV1,
	type VideoVisualPresetV1,
} from './video-visual-preset-v24.ts';
import {
	requireUnifiedExactRenderIdentity,
	type UnifiedExactRenderIdentityIndex,
	type UnifiedExactRenderIdentityKind,
} from './unified-exact-render-identity-authority.ts';
import type {
	UnifiedExactRenderPlanSource,
	UnifiedExactRenderTrackIndexV1,
} from './unified-exact-render-plan-v9.ts';

export type UnifiedExactVisualModelKind =
	| 'still'
	| 'title'
	| 'text'
	| 'shape'
	| 'solid'
	| 'external-generator'
	| 'adjustment-layer'
	| 'preset'
	| 'mask-matte'
	| 'video-freeze';

export type UnifiedExactVisualAuthoredState =
	| Readonly<{ readonly source: VideoStillSourceV1; readonly clip: VideoStillClipV1 }>
	| Readonly<{ readonly source: VideoGeneratorSourceV1; readonly clip: VideoGeneratorClipV1 }>
	| VideoAdjustmentLayerV1
	| VideoVisualPresetV1
	| VideoMaskMatteGraphV1
	| Readonly<{
		readonly schemaVersion: 1;
		readonly kind: 'video-freeze';
		readonly renderedSourceId: string;
	}>;

export interface UnifiedExactRenderVisualNode {
	readonly kind: 'visual';
	readonly nodeId: string;
	readonly modelId: string;
	readonly modelKind: UnifiedExactVisualModelKind;
	readonly authoredState: UnifiedExactVisualAuthoredState;
	readonly placement: UnifiedExactVisualPlacementV1 | null;
	readonly freshness: VideoFreezeFreshnessInputV1 | null;
	readonly authoredFallback: VideoFreezeFallbackV1 | null;
	readonly fallbackDisposition: VideoFreezeFallbackDispositionV1 | null;
	readonly frozenFallback: VideoFreezeFallbackV1 | null;
}

export interface UnifiedExactVisualPlacementV1 {
	readonly trackId: string;
}

const NODE_FIELDS = Object.freeze([
	'kind', 'nodeId', 'modelId', 'modelKind', 'authoredState', 'placement', 'freshness',
	'authoredFallback', 'fallbackDisposition', 'frozenFallback',
]);
const DISPOSITION_FIELDS = Object.freeze([
	'status', 'mode', 'changedComponents', 'authoredStatePreserved', 'reportsDegradation',
]);
const PLACEMENT_FIELDS = Object.freeze(['trackId']);
const SOURCE_CLIP_FIELDS = Object.freeze(['source', 'clip']);
const FREEZE_FIELDS = Object.freeze(['schemaVersion', 'kind', 'renderedSourceId']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,4095}$/u;

export function normalizeUnifiedExactRenderVisualNode(
	value: unknown,
	sequenceId: string,
	sourceById: ReadonlyMap<string, UnifiedExactRenderPlanSource>,
	tracks: UnifiedExactRenderTrackIndexV1,
): UnifiedExactRenderVisualNode {
	const name = 'unified visual render node';
	const node = readClosedDomainRecord(value, name, NODE_FIELDS);
	if (field(node, 'kind', name) !== 'visual') throw new RangeError(`${name}.kind is unsupported.`);
	const modelKind = visualKind(field(node, 'modelKind', name));
	const modelId = stableId(field(node, 'modelId', name), `${name}.modelId`);
	const authoredState = normalizeAuthoredState(
		modelKind, field(node, 'authoredState', name), modelId, sequenceId, sourceById,
	);
	const placement = normalizePlacement(
		field(node, 'placement', name), 'clip' in authoredState, tracks,
	);
	const rawFreshness = field(node, 'freshness', name);
	const freshness = rawFreshness === null ? null : freshnessInput(rawFreshness);
	if (freshness !== null
		&& fingerprintNativeMediaPlan(authoredState).sha256 !== freshness.authoredStateSha256) {
		throw new RangeError('Unified visual freshness does not bind its complete authored state.');
	}
	const rawAuthoredFallback = field(node, 'authoredFallback', name);
	const authoredFallback = rawAuthoredFallback === null
		? null : normalizeVideoFreezeFallbackV1(rawAuthoredFallback);
	const rawFallback = field(node, 'frozenFallback', name);
	const frozenFallback = rawFallback === null ? null : normalizeVideoFreezeFallbackV1(rawFallback);
	const rawDisposition = field(node, 'fallbackDisposition', name);
	const fallbackDisposition = rawDisposition === null ? null : disposition(rawDisposition);
	if (authoredFallback !== null) {
		const source = sourceById.get(authoredFallback.renderedSourceId);
		if (!source || source.contentSha256 !== authoredFallback.renderedAssetSha256) {
			throw new ReferenceError('Unified visual frozen fallback does not bind an exact external media source.');
		}
		const expected = classifyVideoFreezeFallbackV1(authoredFallback, freshness);
		if (fallbackDisposition === null
			|| JSON.stringify(fallbackDisposition) !== JSON.stringify(expected)) {
			throw new RangeError('Unified visual fallback disposition does not match its exact freshness state.');
		}
		if (expected.mode === 'frozen') {
			if (frozenFallback === null
				|| JSON.stringify(frozenFallback) !== JSON.stringify(authoredFallback)) {
				throw new RangeError('A fresh unified visual fallback must be its exact playable fallback.');
			}
		} else if (frozenFallback !== null) {
			throw new RangeError('A stale or unverifiable unified visual fallback can only bypass.');
		}
	} else if (fallbackDisposition !== null || frozenFallback !== null) {
		throw new RangeError('A unified visual fallback disposition requires authored fallback state.');
	}
	return Object.freeze({
		kind: 'visual' as const,
		nodeId: stableId(field(node, 'nodeId', name), `${name}.nodeId`),
		modelId,
		modelKind,
		authoredState,
		placement,
		freshness,
		authoredFallback,
		fallbackDisposition,
		frozenFallback,
	});
}

function normalizePlacement(
	value: unknown,
	required: boolean,
	tracks: UnifiedExactRenderTrackIndexV1,
): UnifiedExactVisualPlacementV1 | null {
	if (value === null) {
		if (required) throw new ReferenceError('A unified visual clip requires exact track placement authority.');
		return null;
	}
	if (!required) throw new RangeError('A non-placement visual model must not claim track placement.');
	const name = 'unified visual placement';
	const placement = readClosedDomainRecord(value, name, PLACEMENT_FIELDS);
	const trackId = stableId(field(placement, 'trackId', name), `${name}.trackId`);
	if (!tracks.byId.has(trackId)) throw new ReferenceError('Unified visual references an unknown video track.');
	return Object.freeze({ trackId });
}

function disposition(value: unknown): VideoFreezeFallbackDispositionV1 {
	const name = 'unified visual fallback disposition';
	const record = readClosedDomainRecord(value, name, DISPOSITION_FIELDS);
	const status = field(record, 'status', name);
	const mode = field(record, 'mode', name);
	const changed = field(record, 'changedComponents', name);
	if (!['fresh', 'stale', 'unverifiable'].includes(String(status))
		|| !['frozen', 'bypass'].includes(String(mode))
		|| !Array.isArray(changed)
		|| changed.some((item) => !CHANGED_COMPONENTS.has(String(item)))
		|| new Set(changed).size !== changed.length
		|| field(record, 'authoredStatePreserved', name) !== true
		|| typeof field(record, 'reportsDegradation', name) !== 'boolean') {
		throw new TypeError('Unified visual fallback disposition is invalid.');
	}
	return Object.freeze({
		status: status as VideoFreezeFallbackDispositionV1['status'],
		mode: mode as VideoFreezeFallbackDispositionV1['mode'],
		changedComponents: Object.freeze([...changed]) as VideoFreezeFallbackDispositionV1['changedComponents'],
		authoredStatePreserved: true as const,
		reportsDegradation: field(record, 'reportsDegradation', name) as boolean,
	});
}

function normalizeAuthoredState(
	kind: UnifiedExactVisualModelKind,
	value: unknown,
	modelId: string,
	sequenceId: string,
	sourceById: ReadonlyMap<string, UnifiedExactRenderPlanSource>,
): UnifiedExactVisualAuthoredState {
	if (kind === 'still') {
		const wrapper = readClosedDomainRecord(value, 'unified still state', SOURCE_CLIP_FIELDS);
		const source = normalizeVideoStillSourceV1(field(wrapper, 'source', 'unified still state'));
		const clip = normalizeVideoStillClipV1(field(wrapper, 'clip', 'unified still state'));
		if (clip.id !== modelId || clip.sourceId !== source.id || clip.sequenceId !== sequenceId) {
			throw new ReferenceError('Unified still state has inconsistent model/source/sequence identities.');
		}
		const external = sourceById.get(source.id);
		if (!external || external.storageKey !== source.storageKey
			|| external.mimeType !== source.mimeType
			|| external.contentSha256 !== source.contentSha256) {
			throw new ReferenceError('Unified still state does not bind its exact external plan source.');
		}
		return Object.freeze({ source, clip });
	}
	if (GENERATOR_KINDS.has(kind)) {
		const wrapper = readClosedDomainRecord(value, 'unified generator state', SOURCE_CLIP_FIELDS);
		const source = normalizeVideoGeneratorSourceV1(field(wrapper, 'source', 'unified generator state'));
		const clip = normalizeVideoGeneratorClipV1(field(wrapper, 'clip', 'unified generator state'));
		if (clip.id !== modelId || source.generator.kind !== kind
			|| clip.sourceId !== source.id || clip.sequenceId !== sequenceId
			|| clip.sourceInFrame + clip.sourceFrameCount > source.frameCount) {
			throw new ReferenceError('Unified generator state has inconsistent kind, range, or identities.');
		}
		return Object.freeze({ source, clip });
	}
	if (kind === 'adjustment-layer') {
		const layer = normalizeVideoAdjustmentLayerV1(value);
		if (layer.id !== modelId || layer.sequenceId !== sequenceId) {
			throw new ReferenceError('Unified adjustment-layer state has inconsistent identity.');
		}
		return layer;
	}
	if (kind === 'preset') {
		const preset = normalizeVideoVisualPresetV1(value);
		if (preset.id !== modelId) throw new ReferenceError('Unified preset state has inconsistent identity.');
		return preset;
	}
	if (kind === 'mask-matte') {
		const graph = normalizeVideoMaskMatteGraphV1(value);
		if (graph.id !== modelId) throw new ReferenceError('Unified mask/matte state has inconsistent identity.');
		return graph;
	}
	const freeze = readClosedDomainRecord(value, 'unified video-freeze state', FREEZE_FIELDS);
	if (field(freeze, 'schemaVersion', 'unified video-freeze state') !== 1
		|| field(freeze, 'kind', 'unified video-freeze state') !== 'video-freeze') {
		throw new RangeError('Unified video-freeze state identity is unsupported.');
	}
	const renderedSourceId = stableId(
		field(freeze, 'renderedSourceId', 'unified video-freeze state'),
		'unified video-freeze state.renderedSourceId',
	);
	if (modelId !== `video-freeze:${renderedSourceId}` || !sourceById.has(renderedSourceId)) {
		throw new ReferenceError('Unified video-freeze model identity has no exact external source.');
	}
	return Object.freeze({ schemaVersion: 1 as const, kind: 'video-freeze' as const, renderedSourceId });
}

/** Resolve every V10 authored graph edge against identities represented by this exact plan. */
export function assertUnifiedExactVisualReferences(
	nodes: readonly UnifiedExactRenderVisualNode[],
	identities: UnifiedExactRenderIdentityIndex,
	tracks: UnifiedExactRenderTrackIndexV1,
): void {
	const generatorSourceIds = new Set(nodes.flatMap((node) => (
		'source' in node.authoredState && node.authoredState.source.kind === 'generator'
			? [node.authoredState.source.id] : []
	)));
	const dependencies = new Map([...generatorSourceIds].map((id) => [id, new Set<string>()]));
	for (const node of nodes) {
		const state = node.authoredState;
		if ('source' in state && state.source.kind === 'generator'
			&& state.source.generator.kind === 'external-generator') {
			const binding = requireUnifiedExactRenderIdentity(
				identities, state.source.generator.bindingId,
				EXTERNAL_GENERATOR_BINDING_KINDS, 'external generator binding',
			);
			if (binding.kind === 'openfx-instance'
				&& binding.role !== 'generator' && binding.role !== 'general') {
				throw new ReferenceError(
					'Unified external generator binding must target a Generator or General OpenFX instance.',
				);
			}
			for (const input of state.source.generator.inputs) {
				requireUnifiedExactRenderIdentity(
					identities, input.sourceRef, RENDERABLE_INPUT_KINDS,
					`external generator input ${input.name}`,
				);
				if (generatorSourceIds.has(input.sourceRef)) {
					dependencies.get(state.source.id)!.add(input.sourceRef);
				}
			}
		} else if ('kind' in state && state.kind === 'adjustment-layer') {
			for (const trackId of state.targetTrackIds) {
				if (!tracks.byId.has(trackId)) {
					throw new ReferenceError(`Unified adjustment layer references unknown track ${trackId}.`);
				}
			}
			for (const effectId of state.effectIds) {
				requireUnifiedExactRenderIdentity(
					identities, effectId, ADJUSTMENT_EFFECT_KINDS, 'adjustment-layer effect',
				);
			}
		} else if ('inputs' in state && Array.isArray(state.inputs)) {
			for (const input of state.inputs) {
				requireUnifiedExactRenderIdentity(
					identities, input.sourceRef, RENDERABLE_INPUT_KINDS,
					`mask/matte input ${input.name}`,
				);
			}
		}
	}
	assertAcyclicGeneratorDependencies(dependencies);
}

function assertAcyclicGeneratorDependencies(
	dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): void {
	const incoming = new Map([...dependencies].map(([id, values]) => [id, values.size]));
	const dependents = new Map([...dependencies.keys()].map((id) => [id, new Set<string>()]));
	for (const [owner, values] of dependencies) {
		for (const dependency of values) dependents.get(dependency)!.add(owner);
	}
	const ready = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
	let resolved = 0;
	while (ready.length > 0) {
		const id = ready.pop()!;
		resolved += 1;
		for (const dependent of dependents.get(id) ?? []) {
			const remaining = incoming.get(dependent)! - 1;
			incoming.set(dependent, remaining);
			if (remaining === 0) {
				ready.push(dependent);
			}
		}
	}
	if (resolved !== dependencies.size) {
		throw new RangeError('Unified external-generator dependencies contain a render cycle.');
	}
}

const GENERATOR_KINDS: ReadonlySet<UnifiedExactVisualModelKind> = new Set([
	'title', 'text', 'shape', 'solid', 'external-generator',
]);
const VISUAL_KINDS: ReadonlySet<UnifiedExactVisualModelKind> = new Set([
	'still', ...GENERATOR_KINDS, 'adjustment-layer', 'preset', 'mask-matte', 'video-freeze',
]);
const FRESHNESS_KEYS = [
	'authoredStateSha256', 'inputIdentitiesSha256', 'renderPlanFingerprintSha256',
	'nativeEffectFingerprintSha256',
] as const;
const CHANGED_COMPONENTS = new Set([
	'authored-state', 'input-identities', 'render-plan', 'native-effect',
]);
const RENDERABLE_INPUT_KINDS: ReadonlySet<UnifiedExactRenderIdentityKind> = new Set([
	'source', 'generator-source', 'clip', 'transition', 'visual-model',
]);
const EXTERNAL_GENERATOR_BINDING_KINDS: ReadonlySet<UnifiedExactRenderIdentityKind> = new Set([
	'source', 'generator-source', 'openfx-instance',
]);
const ADJUSTMENT_EFFECT_KINDS: ReadonlySet<UnifiedExactRenderIdentityKind> = new Set([
	'video-effect',
]);

function freshnessInput(value: unknown): VideoFreezeFreshnessInputV1 {
	const normalized = computeVideoFreezeFreshnessV1(value);
	return Object.freeze(Object.fromEntries(
		FRESHNESS_KEYS.map((key) => [key, normalized[key]]),
	) as unknown as VideoFreezeFreshnessInputV1);
}

function visualKind(value: unknown): UnifiedExactVisualModelKind {
	if (typeof value !== 'string' || !VISUAL_KINDS.has(value as UnifiedExactVisualModelKind)) {
		throw new RangeError('Unified visual model kind is unsupported.');
	}
	return value as UnifiedExactVisualModelKind;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${name} must be a canonical stable ID.`);
	return value;
}

function field(record: ClosedDomainRecord, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
}
