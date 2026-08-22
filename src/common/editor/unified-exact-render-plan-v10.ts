/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';
import { fingerprintNativeMediaPlan } from './native-media-plan-canonical-form.ts';
import {
	computeVideoFreezeFreshnessV1,
	normalizeVideoFreezeFallbackV1,
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
import type { UnifiedExactRenderPlanSource } from './unified-exact-render-plan-v9.ts';

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
	readonly freshness: VideoFreezeFreshnessInputV1;
	readonly frozenFallback: VideoFreezeFallbackV1 | null;
}

const NODE_FIELDS = Object.freeze([
	'kind', 'nodeId', 'modelId', 'modelKind', 'authoredState', 'freshness', 'frozenFallback',
]);
const SOURCE_CLIP_FIELDS = Object.freeze(['source', 'clip']);
const FREEZE_FIELDS = Object.freeze(['schemaVersion', 'kind', 'renderedSourceId']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,4095}$/u;

export function normalizeUnifiedExactRenderVisualNode(
	value: unknown,
	sequenceId: string,
	sourceById: ReadonlyMap<string, UnifiedExactRenderPlanSource>,
): UnifiedExactRenderVisualNode {
	const name = 'unified visual render node';
	const node = readClosedDomainRecord(value, name, NODE_FIELDS);
	if (field(node, 'kind', name) !== 'visual') throw new RangeError(`${name}.kind is unsupported.`);
	const modelKind = visualKind(field(node, 'modelKind', name));
	const modelId = stableId(field(node, 'modelId', name), `${name}.modelId`);
	const authoredState = normalizeAuthoredState(
		modelKind, field(node, 'authoredState', name), modelId, sequenceId,
	);
	const freshness = freshnessInput(field(node, 'freshness', name));
	if (fingerprintNativeMediaPlan(authoredState).sha256 !== freshness.authoredStateSha256) {
		throw new RangeError('Unified visual freshness does not bind its complete authored state.');
	}
	const rawFallback = field(node, 'frozenFallback', name);
	const frozenFallback = rawFallback === null ? null : normalizeVideoFreezeFallbackV1(rawFallback);
	if (frozenFallback !== null) {
		const source = sourceById.get(frozenFallback.renderedSourceId);
		if (!source || source.contentSha256 !== frozenFallback.renderedAssetSha256) {
			throw new ReferenceError('Unified visual frozen fallback does not bind an exact external media source.');
		}
		for (const key of FRESHNESS_KEYS) {
			if (frozenFallback[key] !== freshness[key]) {
				throw new RangeError('Unified visual fallback freshness disagrees with its authored node.');
			}
		}
	}
	return Object.freeze({
		kind: 'visual' as const,
		nodeId: stableId(field(node, 'nodeId', name), `${name}.nodeId`),
		modelId,
		modelKind,
		authoredState,
		freshness,
		frozenFallback,
	});
}

function normalizeAuthoredState(
	kind: UnifiedExactVisualModelKind,
	value: unknown,
	modelId: string,
	sequenceId: string,
): UnifiedExactVisualAuthoredState {
	if (kind === 'still') {
		const wrapper = readClosedDomainRecord(value, 'unified still state', SOURCE_CLIP_FIELDS);
		const source = normalizeVideoStillSourceV1(field(wrapper, 'source', 'unified still state'));
		const clip = normalizeVideoStillClipV1(field(wrapper, 'clip', 'unified still state'));
		if (source.id !== modelId || clip.sourceId !== source.id || clip.sequenceId !== sequenceId) {
			throw new ReferenceError('Unified still state has inconsistent model/source/sequence identities.');
		}
		return Object.freeze({ source, clip });
	}
	if (GENERATOR_KINDS.has(kind)) {
		const wrapper = readClosedDomainRecord(value, 'unified generator state', SOURCE_CLIP_FIELDS);
		const source = normalizeVideoGeneratorSourceV1(field(wrapper, 'source', 'unified generator state'));
		const clip = normalizeVideoGeneratorClipV1(field(wrapper, 'clip', 'unified generator state'));
		if (source.id !== modelId || source.generator.kind !== kind
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
	if (renderedSourceId !== modelId) throw new ReferenceError('Unified video-freeze model identity is inconsistent.');
	return Object.freeze({ schemaVersion: 1 as const, kind: 'video-freeze' as const, renderedSourceId });
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
