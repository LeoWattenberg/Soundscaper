/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeImageDevelopStateV1OrV2 } from './image-develop-state-v2.ts';
import { normalizeBrushMaskResourceReferenceV1, type BrushMaskResourceReferenceV1 } from './brush-mask-resource-v1.ts';
import { IMAGE_DEVELOP_MASK_WORKING_LIMIT_V1, planAdmittedImageDevelopMasksV1, type ImageDevelopMaskPlanV1 } from './image-develop-mask-plan-v1.ts';
import { planImageGeometryV1 } from './image-geometry-plan-v1.ts';
import type { ImageDevelopMaskOverlaySelectionV1 } from './image-develop-mask-overlay-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import type { PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1 } from '../video-image-geometry-v1.ts';
import { normalizeVideoMaskMatteGraphV1, videoMaskMatteWorkingBytesV1, type VideoMaskMatteGraphV1 } from '../video-mask-matte-v24.ts';

export interface PreparedImageDevelopBrushMasksV1 {
	readonly plan: Readonly<ImageDevelopMaskPlanV1>;
	readonly references: readonly Readonly<BrushMaskResourceReferenceV1>[];
	readonly retainedStorageKeys: ReadonlySet<string>;
	readonly peakWorkingBytes: number;
}
export interface PreparedVideoMaskMatteBrushInputsV1 {
	readonly graph: Readonly<VideoMaskMatteGraphV1>;
	readonly references: readonly Readonly<BrushMaskResourceReferenceV1>[];
	readonly retainedStorageKeys: ReadonlySet<string>;
	readonly peakWorkingBytes: number;
}
const MAXIMUM_REFERENCES = 4_094;
const MAXIMUM_DECLARED_BODY_BYTES = 16n * 1024n * 1024n;

/** Explicit brush capability permits only alpha coverage. Every declaration
 * and node is admitted, including unbound, disabled and unreachable entries. */
export function admitImageDevelopBrushMaskAuthorityV1(developValue: unknown) {
	const develop = normalizeImageDevelopStateV1OrV2(developValue);
	for (const graph of develop.masks) admitGraph(graph);
	const bound = new Set(develop.maskBindings.map(binding => binding.effectId));
	if (develop.effects.some(effect => effect.type === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1 && bound.has(effect.id))) {
		throw new RangeError('Geometry effects cannot bind a local adjustment mask.');
	}
	return develop;
}

/** Body-free preflight. The host still needs an authentic joined source scope;
 * these scalar identities and byte bounds cannot authorize sampling. */
export function prepareImageDevelopBrushMasksV1(developValue: unknown, width: number, height: number,
	renderLimits: PixelFrameLimitsV1, selectionValue?: Readonly<ImageDevelopMaskOverlaySelectionV1>): Readonly<PreparedImageDevelopBrushMasksV1> {
	const develop = admitImageDevelopBrushMaskAuthorityV1(developValue);
	const plan = planAdmittedImageDevelopMasksV1(develop, width, height, renderLimits);
	const references = collectReferences(develop.masks), retainedStorageKeys = new Set<string>();
	for (const binding of plan.bindings) for (const key of reachableStorageKeys(binding.graph)) retainedStorageKeys.add(key);
	const selection = selectionValue === undefined ? undefined : admitSelection(selectionValue);
	const selected = selection && plan.bindings.find(binding => binding.maskId === selection.maskId && binding.effectId === selection.effectId);
	if (selection && !selected) throw new RangeError('Mask overlay requires one retained mask/effect binding.');
	let scratch = 0n, retainedOverlay = 0n, presentation = 0n;
	if (selected) {
		retainedOverlay = BigInt(plan.width) * BigInt(plan.height); presentation = retainedOverlay * 5n;
		let stageWidth = selected.width, stageHeight = selected.height, largest = BigInt(stageWidth) * BigInt(stageHeight);
		for (const geometry of selected.suffixGeometry) {
			const next = planImageGeometryV1(geometry, stageWidth, stageHeight); stageWidth = next.width; stageHeight = next.height;
			const pixels = BigInt(stageWidth) * BigInt(stageHeight); if (pixels > largest) largest = pixels;
		}
		if (selected.suffixGeometry.length) scratch = largest * 13n;
	}
	const resources = resourceWorkingBytes(references, retainedStorageKeys);
	const graphPeak = BigInt(plan.maximumWorkingBytes) + scratch + retainedOverlay;
	const peakWorkingBytes = admitPeak(resources + (graphPeak > presentation ? graphPeak : presentation));
	return Object.freeze({ plan, references, retainedStorageKeys: Object.freeze(retainedStorageKeys), peakWorkingBytes });
}

/** Standalone graph uses the same closed declarations and conservative source
 * peak as recipe planning. Current-frame copy is charged by the graph owner. */
export function prepareVideoMaskMatteBrushInputsV1(value: unknown, width: number, height: number): Readonly<PreparedVideoMaskMatteBrushInputsV1> {
	const graph = normalizeVideoMaskMatteGraphV1(value); admitGraph(graph);
	const references = collectReferences([graph]), retainedStorageKeys = reachableStorageKeys(graph);
	const peakWorkingBytes = admitPeak(BigInt(videoMaskMatteWorkingBytesV1(graph, width, height)) + resourceWorkingBytes(references, retainedStorageKeys));
	return Object.freeze({ graph, references, retainedStorageKeys: Object.freeze(retainedStorageKeys), peakWorkingBytes });
}

function admitGraph(graph: Readonly<VideoMaskMatteGraphV1>): void {
	for (const input of graph.inputs) normalizeBrushMaskResourceReferenceV1(input.sourceRef);
	for (const node of graph.nodes) if (node.kind === 'raster' && node.channel !== 'alpha') {
		throw new RangeError('Brush mask resources admit only alpha-channel coverage.');
	}
}
function collectReferences(graphs: readonly Readonly<VideoMaskMatteGraphV1>[]): readonly Readonly<BrushMaskResourceReferenceV1>[] {
	const unique = new Map<string, Readonly<BrushMaskResourceReferenceV1>>(); let declaredBytes = 0n;
	for (const graph of graphs) for (const input of graph.inputs) {
		const reference = normalizeBrushMaskResourceReferenceV1(input.sourceRef);
		if (unique.has(reference.storageKey)) continue;
		declaredBytes += BigInt(reference.byteLength);
		if (unique.size >= MAXIMUM_REFERENCES || declaredBytes > MAXIMUM_DECLARED_BODY_BYTES) {
			throw new RangeError('Brush declarations exceed their bounded source closure.');
		}
		unique.set(reference.storageKey, reference);
	}
	return Object.freeze([...unique.values()].sort((left, right) => left.storageKey < right.storageKey ? -1 : left.storageKey > right.storageKey ? 1 : 0));
}
function reachableStorageKeys(graph: Readonly<VideoMaskMatteGraphV1>): Set<string> {
	const nodes = new Map(graph.nodes.map(node => [node.id, node])), seen = new Set<string>(), keys = new Set<string>();
	const visit = (id: string): void => {
		if (seen.has(id)) return; seen.add(id); const node = nodes.get(id)!;
		if (node.kind === 'raster' || node.kind === 'alpha') keys.add(graph.inputs.find(input => input.name === node.inputName)!.sourceRef);
		else if (node.kind === 'feather' || node.kind === 'invert') visit(node.inputNodeId);
		else if (node.kind === 'boolean') for (const child of node.inputNodeIds) visit(child);
	};
	visit(graph.outputNodeId); return keys;
}
function resourceWorkingBytes(references: readonly Readonly<BrushMaskResourceReferenceV1>[], retained: ReadonlySet<string>): bigint {
	let alpha = 0n, largestBody = 0n;
	for (const reference of references) {
		if (retained.has(reference.storageKey)) alpha += BigInt(reference.width) * BigInt(reference.height);
		const bytes = BigInt(reference.byteLength); if (bytes > largestBody) largestBody = bytes;
	}
	// Native structured-clone row, repository copy/auth, renderer auth; retain
	// extracted alpha too. Two live SHA outputs are charged independently.
	return alpha + largestBody * 4n + (references.length ? 64n : 0n);
}
function admitPeak(bytes: bigint): number {
	if (bytes > BigInt(IMAGE_DEVELOP_MASK_WORKING_LIMIT_V1)) throw new RangeError('Brush mask coverage exceeds its 64 MiB working budget.');
	return Number(bytes);
}
function admitSelection(value: unknown): Readonly<ImageDevelopMaskOverlaySelectionV1> {
	const input = record(value, 'brush mask overlay selection', ['maskId', 'effectId']);
	const maskId = field(input, 'maskId', 'brush mask overlay selection'), effectId = field(input, 'effectId', 'brush mask overlay selection');
	if (typeof maskId !== 'string' || typeof effectId !== 'string' || !maskId || !effectId || maskId.length > 128 || effectId.length > 128) {
		throw new TypeError('Mask overlay requires bounded retained mask/effect IDs.');
	}
	return Object.freeze({ maskId, effectId });
}
