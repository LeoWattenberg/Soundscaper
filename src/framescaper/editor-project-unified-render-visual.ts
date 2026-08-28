/* SPDX-License-Identifier: AGPL-3.0-only */

import { sequenceFrameBoundarySample } from '../common/editor/sequence-frame-navigation.ts';
import { fingerprintNativeMediaPlan } from '../common/editor/native-media-plan-canonical-form.ts';
import {
	classifyVideoFreezeFallbackV1,
	computeVideoFreezeFreshnessV1,
	normalizeVideoFreezeFallbackV1,
	type VideoFreezeFallbackV1,
	type VideoFreezeFreshnessInputV1,
} from '../common/editor/video-freeze-v24.ts';
import {
	normalizeVideoMaskMatteGraphV1,
	type VideoMaskMatteGraphV1,
} from '../common/editor/video-mask-matte-v24.ts';
import {
	normalizeVideoVisualPresetV1,
	type VideoVisualPresetV1,
} from '../common/editor/video-visual-preset-v24.ts';
import {
	normalizeVideoAdjustmentLayerV1,
	normalizeVideoGeneratorClipV1,
	normalizeVideoGeneratorSourceV1,
	normalizeVideoStillClipV1,
	normalizeVideoStillSourceV1,
	type VideoAdjustmentLayerV1,
} from '../common/editor/video-visual-model-v24.ts';
import type { UnifiedExactRenderVisualNode } from '../common/editor/unified-exact-render-plan.ts';
import type { FramescaperUnifiedExactVisualRenderAuthority } from './editor-project-unified-render-authority.ts';
import {
	generatedNodeId,
	type FramescaperUnifiedRenderFoundation,
} from './editor-project-unified-render-core.ts';

export interface FramescaperUnifiedVisualRenderNodes {
	readonly nodes: readonly UnifiedExactRenderVisualNode[];
	readonly representedIdentities: ReadonlySet<string>;
}

type DirectVisualState = VideoAdjustmentLayerV1 | VideoVisualPresetV1 | VideoMaskMatteGraphV1;

/** Project visual state projected onto the closed V10 visual node families. */
export function createFramescaperUnifiedVisualRenderNodes(
	foundation: FramescaperUnifiedRenderFoundation,
	authority: FramescaperUnifiedExactVisualRenderAuthority,
): FramescaperUnifiedVisualRenderNodes {
	const project = foundation.project;
	const nodes: UnifiedExactRenderVisualNode[] = [];
	const represented = new Set(foundation.representedIdentities);
	for (const placement of foundation.activeVisualPlacements) {
		const clip = placement.clip;
		const sourceId = String(clip.sourceId);
		const source = foundation.sourceById.get(sourceId);
		if (!source || source.kind !== clip.kind) {
			throw new ReferenceError(`Visual clip ${String(clip.id)} has no matching source ${sourceId}.`);
		}
		const authoredState = source.kind === 'still'
			? Object.freeze({
				source: normalizeVideoStillSourceV1(source),
				clip: normalizeVideoStillClipV1(clip),
			})
			: Object.freeze({
				source: normalizeVideoGeneratorSourceV1(source),
				clip: normalizeVideoGeneratorClipV1(clip),
			});
		const modelKind = authoredState.source.kind === 'still'
			? 'still' as const
			: generatorKind(authoredState.source.generator);
		const modelId = String(clip.id);
		const node = visualNode(
			modelKind, modelId, authoredState, authority.visualFreshnessByModelId,
			foundation.projectIdentities, null,
			Object.freeze({ trackId: placement.trackId }),
		);
		nodes.push(node);
		represented.add(node.nodeId);
		represented.add(node.modelId);
		represented.add(sourceId);
		represented.add(String(clip.id));
	}
	for (const adjustment of records(array(project, 'videoAdjustmentLayers'), 'videoAdjustmentLayers')
		.filter((candidate) => candidate.sequenceId === foundation.sequence.id)
		.filter((candidate) => placementIntersects(candidate, foundation))) {
		pushDirect(
			'adjustment-layer', normalizeVideoAdjustmentLayerV1(adjustment),
			nodes, represented, foundation, authority,
		);
	}
	for (const preset of records(array(project, 'videoVisualPresets'), 'videoVisualPresets').sort(compareIds)) {
		pushDirect('preset', normalizeVideoVisualPresetV1(preset), nodes, represented, foundation, authority);
	}
	for (const mask of records(array(project, 'videoMaskMattes'), 'videoMaskMattes').sort(compareIds)) {
		pushDirect('mask-matte', normalizeVideoMaskMatteGraphV1(mask), nodes, represented, foundation, authority);
	}
	for (const fallback of array(project, 'videoFreezeFallbacks')
		.map(normalizeVideoFreezeFallbackV1)
		.sort((left, right) => compareText(left.renderedSourceId, right.renderedSourceId))) {
		pushFreeze(fallback, nodes, represented, foundation, authority);
	}
	assertExactFreshnessMap(authority.visualFreshnessByModelId, new Set(nodes.map(({ modelId }) => modelId)));
	return Object.freeze({ nodes: Object.freeze(nodes), representedIdentities: represented });
}

function pushFreeze(
	fallback: VideoFreezeFallbackV1,
	nodes: UnifiedExactRenderVisualNode[],
	represented: Set<string>,
	foundation: FramescaperUnifiedRenderFoundation,
	authority: FramescaperUnifiedExactVisualRenderAuthority,
): void {
	const renderedSourceId = fallback.renderedSourceId;
	const modelId = `video-freeze:${renderedSourceId}`;
	const source = foundation.sourceById.get(renderedSourceId);
	if (!source || !foundation.sourceNodeIdById.has(renderedSourceId)
		|| source.contentSha256 !== fallback.renderedAssetSha256) {
		throw new ReferenceError('visual freeze fallback does not bind an exact rendered external source.');
	}
	const authoredState = Object.freeze({
		schemaVersion: 1 as const,
		kind: 'video-freeze' as const,
		renderedSourceId,
	});
	const node = visualNode(
		'video-freeze', modelId, authoredState, authority.visualFreshnessByModelId,
		foundation.projectIdentities, fallback,
	);
	nodes.push(node);
	represented.add(node.nodeId);
	represented.add(modelId);
}

function pushDirect(
	modelKind: 'adjustment-layer' | 'preset' | 'mask-matte',
	authoredState: DirectVisualState,
	nodes: UnifiedExactRenderVisualNode[],
	represented: Set<string>,
	foundation: FramescaperUnifiedRenderFoundation,
	authority: FramescaperUnifiedExactVisualRenderAuthority,
): void {
	const modelId = authoredState.id;
	const node = visualNode(
		modelKind, modelId, authoredState, authority.visualFreshnessByModelId,
		foundation.projectIdentities,
	);
	nodes.push(node);
	represented.add(node.nodeId);
	represented.add(modelId);
}

function visualNode(
	modelKind: UnifiedExactRenderVisualNode['modelKind'],
	modelId: string,
	authoredState: UnifiedExactRenderVisualNode['authoredState'],
	freshnessByModelId: ReadonlyMap<string, VideoFreezeFreshnessInputV1>,
	projectIdentities: ReadonlySet<string>,
	frozenFallback: VideoFreezeFallbackV1 | null = null,
	placement: UnifiedExactRenderVisualNode['placement'] = null,
): UnifiedExactRenderVisualNode {
	const rawFreshness = rawFreshnessForModel(freshnessByModelId, modelId);
	let freshness: VideoFreezeFreshnessInputV1 | null = null;
	try {
		const normalized = computeVideoFreezeFreshnessV1(rawFreshness);
		freshness = Object.freeze({
			authoredStateSha256: normalized.authoredStateSha256,
			inputIdentitiesSha256: normalized.inputIdentitiesSha256,
			renderPlanFingerprintSha256: normalized.renderPlanFingerprintSha256,
			nativeEffectFingerprintSha256: normalized.nativeEffectFingerprintSha256,
		});
		if (fingerprintNativeMediaPlan(authoredState).sha256 !== freshness.authoredStateSha256) {
			freshness = null;
		}
	} catch {
		freshness = null;
	}
	if (frozenFallback === null && freshness === null) {
		throw new RangeError(`Visual model ${modelId} freshness does not bind its exact authored state.`);
	}
	const fallbackDisposition = frozenFallback === null
		? null : classifyVideoFreezeFallbackV1(frozenFallback, freshness);
	return Object.freeze({
		kind: 'visual' as const,
		nodeId: generatedNodeId('visual', modelId, projectIdentities),
		modelId, modelKind, authoredState, placement, freshness,
		authoredFallback: frozenFallback,
		fallbackDisposition,
		frozenFallback: fallbackDisposition?.mode === 'frozen' ? frozenFallback : null,
	});
}

function rawFreshnessForModel(
	value: ReadonlyMap<string, VideoFreezeFreshnessInputV1>,
	modelId: string,
): unknown {
	if (!(value instanceof Map)) throw new TypeError('visual visual freshness authority must be an actual Map.');
	return Map.prototype.get.call(value, modelId) as unknown;
}

function assertExactFreshnessMap(
	value: ReadonlyMap<string, VideoFreezeFreshnessInputV1>,
	required: ReadonlySet<string>,
): void {
	if (!(value instanceof Map)) throw new TypeError('visual visual freshness authority must be an actual Map.');
	const entries = [...Map.prototype.entries.call(value) as MapIterator<[unknown, unknown]>];
	if (entries.length > required.size
		|| entries.some(([key]) => typeof key !== 'string' || !required.has(key))) {
		throw new RangeError('visual visual freshness authority must contain exactly the rendered model identities.');
	}
}

function placementIntersects(
	placement: Readonly<Record<string, unknown>>,
	foundation: FramescaperUnifiedRenderFoundation,
): boolean {
	const startFrame = integer(placement.sequenceStartFrame, 'visual placement start', 0);
	const count = integer(placement.sequenceFrameCount, 'visual placement duration', 1);
	if (!Number.isSafeInteger(startFrame + count)) throw new RangeError('Visual placement range overflows.');
	const start = sequenceFrameBoundarySample(
		startFrame, foundation.sequenceRate, Number(foundation.project.sampleRate),
	);
	const end = sequenceFrameBoundarySample(
		startFrame + count, foundation.sequenceRate, Number(foundation.project.sampleRate),
	);
	const outputEnd = foundation.authority.sampleStart + foundation.authority.sampleDuration;
	return start < outputEnd && end > foundation.authority.sampleStart;
}

function generatorKind(value: unknown): UnifiedExactRenderVisualNode['modelKind'] {
	const generator = record(value, 'generator source.generator');
	const kind = generator.kind;
	if (!['title', 'text', 'shape', 'solid', 'external-generator'].includes(String(kind))) {
		throw new RangeError('A generator source has an unsupported exact V10 kind.');
	}
	return kind as UnifiedExactRenderVisualNode['modelKind'];
}

function array(value: Readonly<Record<string, unknown>>, key: string): unknown[] {
	const result = value[key];
	if (!Array.isArray(result)) throw new TypeError(`${key} must be an array.`);
	return result;
}

function records(value: unknown[], name: string): Record<string, unknown>[] {
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function id(value: Record<string, unknown>, name: string): string {
	if (typeof value.id !== 'string' || value.id.length === 0) throw new TypeError(`${name}.id must be nonempty.`);
	return value.id;
}

function integer(value: unknown, name: string, minimum: number): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new RangeError(`${name} is invalid.`);
	return Number(value);
}

function compareIds(left: Record<string, unknown>, right: Record<string, unknown>): number {
	const a = id(left, 'visual model');
	const b = id(right, 'visual model');
	return compareText(a, b);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
