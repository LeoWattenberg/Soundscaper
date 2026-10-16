/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoMaskMatteNodeV1 } from '../video-mask-matte-v24.ts';
import type { PixelFrameDescriptorV1 } from './pixel-frame-contract-v1.ts';
import { captureLinearKernelDescriptorV1, type LinearKernelDescriptorV1 } from './linear-kernel-descriptor-v1.ts';
import { prepareVideoMaskMatteBrushInputsV1 } from './image-develop-brush-mask-v1.ts';
import type { BrushMaskResourceReferenceV1 } from './brush-mask-resource-v1.ts';
import { preparePixelFrameWebGl2MaskNodeUniformsCurrentV1, type PixelFrameWebGl2MaskNodeUniformsCurrentV1 } from './pixel-frame-webgl2-mask-node-current-v1.ts';

export interface PixelFrameWebGl2MaskGraphStepCurrentV1 {
	readonly nodeId: string;
	readonly destination: number;
	readonly operands: readonly number[];
	/** Release only AFTER every fold/path/feather draw for this node joins. */
	readonly release: readonly number[];
	readonly uniforms: Readonly<PixelFrameWebGl2MaskNodeUniformsCurrentV1>;
	readonly brushStorageKey: string | undefined;
}
export interface PreparedPixelFrameWebGl2MaskGraphCurrentV1 {
	readonly graphId: string;
	readonly descriptor: LinearKernelDescriptorV1;
	readonly steps: readonly Readonly<PixelFrameWebGl2MaskGraphStepCurrentV1>[];
	readonly outputSlot: number;
	readonly references: readonly Readonly<BrushMaskResourceReferenceV1>[];
	readonly retainedStorageKeys: readonly string[];
	readonly cpuComponentBytes: number;
	readonly coverageTextureCount: number;
	readonly coverageTextureBytes: number;
	readonly booleanScratchBytes: number;
	readonly integerScratchTextureCount: number;
	readonly integerScratchBytes: number;
	/** One RGBA32F edge texture + one private F32 upload bank, 256 edges each. */
	readonly pathBankBytes: number;
	readonly brushTextureBytes: number;
	readonly uniformBytes: number;
	readonly dummyTextureBytes: number;
	readonly readbackBytes: number;
	readonly graphGpuBytes: number;
	readonly minimumMaskComponentBytes: number;
	readonly supported: boolean;
	/** Scalar bound only. Does not claim actual GL support or completeness. */
	readonly eligible: boolean;
}
interface State {
	readonly plan: Readonly<PreparedPixelFrameWebGl2MaskGraphCurrentV1>;
	readonly nodes: ReadonlyMap<string, Readonly<VideoMaskMatteNodeV1>>;
}
const PREPARED = new WeakMap<object, Readonly<State>>();
const COMPONENT_LIMIT = 64 * 1024 * 1024, EDGE_BATCH = 256, EDGE_FLOATS = EDGE_BATCH * 4;
const NativeFloats = Float32Array, TYPED = Object.getPrototypeOf(NativeFloats.prototype) as object;
const TAG = Object.getOwnPropertyDescriptor(TYPED, Symbol.toStringTag)!.get!;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'length')!.get!, SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!, FILL = NativeFloats.prototype.fill;

/** Input is the genuine Current binding's computation V1 graph. The checkpoint
 * owner separately retains binding/metadata identity. Reuse closed CPU graph,
 * topology, alpha-only brush declaration and 64MiB admission before any GL/I/O.
 * All retained nodes validate; only the output's reachable DAG gets draws. */
export function preparePixelFrameWebGl2MaskGraphCurrentV1(graphValue: unknown,
	descriptorValue: PixelFrameDescriptorV1): Readonly<PreparedPixelFrameWebGl2MaskGraphCurrentV1> {
	const descriptor = captureLinearKernelDescriptorV1(descriptorValue);
	const admitted = prepareVideoMaskMatteBrushInputsV1(graphValue, descriptor.width, descriptor.height);
	const graph = admitted.graph, nodes = new Map(graph.nodes.map(node => [node.id, node]));
	const ordered: Readonly<VideoMaskMatteNodeV1>[] = [], reached = new Set<string>();
	const uses = new Map<string, number>();
	const visit = (id: string): void => {
		if (reached.has(id)) return; reached.add(id);
		const node = nodes.get(id)!;
		for (const child of children(node)) { uses.set(child, (uses.get(child) ?? 0) + 1); visit(child); }
		ordered.push(node);
	};
	visit(graph.outputNodeId); uses.set(graph.outputNodeId, (uses.get(graph.outputNodeId) ?? 0) + 1);
	const live = new Map<string, number>(), free: number[] = [];
	const steps: Readonly<PixelFrameWebGl2MaskGraphStepCurrentV1>[] = [];
	let coverageTextureCount = 0, booleanScratch = false, integerScratchTextureCount = 0, path = false, supported = true;
	for (const node of ordered) {
		const uniforms = preparePixelFrameWebGl2MaskNodeUniformsCurrentV1(node); supported &&= uniforms.supported;
		const refs = children(node), operands = refs.map(id => live.get(id)!);
		// Allocate before freeing inputs: a sampled attachment is never the target.
		const destination = free.pop() ?? coverageTextureCount++, release: number[] = [];
		for (const id of refs) {
			const remaining = uses.get(id)! - 1; uses.set(id, remaining);
			if (remaining === 0) { const slot = live.get(id)!; live.delete(id); free.push(slot); release.push(slot); }
		}
		live.set(node.id, destination);
		booleanScratch ||= node.kind === 'boolean' && refs.length > 2;
		if (node.kind === 'feather' && uniforms.radius > 0) integerScratchTextureCount = Math.max(integerScratchTextureCount, 1);
		if (node.kind === 'vector-path') {
			path = true; integerScratchTextureCount = Math.max(integerScratchTextureCount, uniforms.pathEdges > EDGE_BATCH ? 2 : 1);
		}
		const brushStorageKey = uniforms.inputName === undefined ? undefined : graph.inputs.find(input => input.name === uniforms.inputName)!.sourceRef;
		steps.push(Object.freeze({ nodeId: node.id, destination, operands: Object.freeze(operands), release: Object.freeze(release), uniforms, brushStorageKey }));
	}
	const pixels = descriptor.width * descriptor.height;
	const retainedStorageKeys = Object.freeze([...admitted.retainedStorageKeys].sort());
	let brushWidth = 0, brushHeight = 0;
	for (const reference of admitted.references) if (admitted.retainedStorageKeys.has(reference.storageKey)) {
		brushWidth = Math.max(brushWidth, reference.width); brushHeight = Math.max(brushHeight, reference.height);
	}
	const coverageTextureBytes = coverageTextureCount * pixels, booleanScratchBytes = booleanScratch ? pixels : 0;
	const integerScratchBytes = integerScratchTextureCount * pixels * 4;
	const pathBankBytes = path ? EDGE_FLOATS * 4 * 2 : 0, brushTextureBytes = brushWidth * brushHeight, uniformBytes = 64, dummyTextureBytes = 1;
	// Probe may require RGBA_INTEGER/UNSIGNED_INT rather than RED/U8. This
	// worst-case stripe has 4096 pixels*16B native +1B canonical +4KiB SHA/header.
	const readbackBytes = Math.min(pixels, 4096) * 17 + 4096;
	const graphGpuBytes = coverageTextureBytes + booleanScratchBytes + integerScratchBytes + pathBankBytes + brushTextureBytes + uniformBytes + dummyTextureBytes;
	const minimumMaskComponentBytes = admitted.peakWorkingBytes + graphGpuBytes + readbackBytes;
	const plan = Object.freeze({ graphId: graph.id, descriptor, steps: Object.freeze(steps), outputSlot: live.get(graph.outputNodeId)!,
		references: admitted.references, retainedStorageKeys, cpuComponentBytes: admitted.peakWorkingBytes,
		coverageTextureCount, coverageTextureBytes, booleanScratchBytes, integerScratchTextureCount, integerScratchBytes,
		pathBankBytes, brushTextureBytes, uniformBytes, dummyTextureBytes, readbackBytes, graphGpuBytes, minimumMaskComponentBytes,
		supported, eligible: supported && minimumMaskComponentBytes <= COMPONENT_LIMIT });
	PREPARED.set(plan, Object.freeze({ plan, nodes })); return plan;
}

export function isPixelFrameWebGl2MaskGraphCurrentV1(value: unknown): value is Readonly<PreparedPixelFrameWebGl2MaskGraphCurrentV1> {
	return typeof value === 'object' && value !== null && PREPARED.has(value);
}
export function readPixelFrameWebGl2MaskGraphCurrentV1(value: unknown): Readonly<PreparedPixelFrameWebGl2MaskGraphCurrentV1> {
	if (!isPixelFrameWebGl2MaskGraphCurrentV1(value)) throw new TypeError('GPU mask graph requires a private prepared identity.');
	return PREPARED.get(value)!.plan;
}

/** Fill a caller-owned dedicated 4KiB bank, synchronously before upload. Closed
 * paths AND open paths use last-to-first positions, exactly like CPU winding;
 * stored handles are admitted metadata but do not invent Bezier evaluation. */
export function writePixelFrameWebGl2MaskPathEdgesCurrentV1(value: unknown, stepIndex: number, firstEdge: number,
	target: Float32Array<ArrayBuffer>): number {
	const plan = readPixelFrameWebGl2MaskGraphCurrentV1(value), state = PREPARED.get(plan)!;
	if (!Number.isSafeInteger(stepIndex) || stepIndex < 0 || stepIndex >= plan.steps.length) throw new RangeError('Mask path step is outside its plan.');
	const node = state.nodes.get(plan.steps[stepIndex]!.nodeId)!;
	if (node.kind !== 'vector-path') throw new TypeError('Only a prepared vector path owns edge payload.');
	const total = plan.steps[stepIndex]!.uniforms.pathEdges;
	if (!Number.isSafeInteger(firstEdge) || firstEdge < 0 || firstEdge >= total || firstEdge % EDGE_BATCH !== 0) throw new RangeError('Mask path edge bank offset is invalid.');
	if (Reflect.apply(TAG, target, []) !== 'Float32Array') throw new TypeError('Mask path upload requires native Float32 storage.');
	const backing = Reflect.apply(BUFFER, target, []) as ArrayBuffer;
	if (Reflect.apply(RESIZABLE, backing, []) || Reflect.apply(OFFSET, target, []) !== 0
		|| Reflect.apply(LENGTH, target, []) !== EDGE_FLOATS || Reflect.apply(SIZE, backing, []) !== EDGE_FLOATS * 4) {
		throw new RangeError('Mask path upload requires its exact dedicated 4KiB backing.');
	}
	Reflect.apply(FILL, target, [0]);
	const count = Math.min(EDGE_BATCH, total - firstEdge); let edge = 0, written = 0;
	for (const path of node.paths) for (let index = 0; index < path.points.length; index++, edge++) {
		if (edge < firstEdge || written === count) continue;
		const a = path.points[index]!.position, b = path.points[(index + 1) % path.points.length]!.position, offset = written++ * 4;
		target[offset] = a.x; target[offset + 1] = a.y; target[offset + 2] = b.x; target[offset + 3] = b.y;
	}
	return written;
}
function children(node: Readonly<VideoMaskMatteNodeV1>): readonly string[] {
	if (node.kind === 'invert' || node.kind === 'feather') return [node.inputNodeId];
	if (node.kind === 'boolean') return node.inputNodeIds;
	return [];
}
