/* SPDX-License-Identifier: AGPL-3.0-only */
import { readPixelFrameWebGl2MaskCheckpointPlanCurrentV1, type PixelFrameWebGl2MaskCheckpointCurrentV1 } from './pixel-frame-webgl2-mask-plan-current-v1.ts';
import { preparePixelFrameWebGl2MaskGraphCurrentV1, type PreparedPixelFrameWebGl2MaskGraphCurrentV1 } from './pixel-frame-webgl2-mask-graph-current-v1.ts';

export interface PreparedPixelFrameWebGl2MaskContextCurrentV1 {
	readonly checkpointPlan: ReturnType<typeof readPixelFrameWebGl2MaskCheckpointPlanCurrentV1>;
	readonly entries: readonly Readonly<{ checkpoint: Readonly<PixelFrameWebGl2MaskCheckpointCurrentV1>; graph: Readonly<PreparedPixelFrameWebGl2MaskGraphCurrentV1> }>[];
	readonly graphExecutionBytes: number;
	readonly nativeReadbackBytes: number;
	readonly probeBytes: number;
	readonly stateBytes: number;
	readonly workingBytes: number;
	readonly eligible: boolean;
}
const PREPARED = new WeakSet<object>();
/** Compile from the actual enrolled metadata/binding graph, never a same-id
 * caller graph. This is scalar admission; native probes/receipts remain needed.
 * It does not mutate B's explicit incomplete graph-admission fields. */
export function preparePixelFrameWebGl2MaskContextCurrentV1(value: unknown): Readonly<PreparedPixelFrameWebGl2MaskContextCurrentV1> {
	const checkpointPlan = readPixelFrameWebGl2MaskCheckpointPlanCurrentV1(value);
	const entries = checkpointPlan.graphAdmissionRequests.map((request, index) => {
		const checkpoint = checkpointPlan.executedCheckpoints[index];
		if (!checkpoint || request.executionIndex !== index || request.checkpointIndex !== checkpoint.index || request.binding !== checkpoint.binding
			|| request.graph !== checkpoint.binding.graph) throw new TypeError('Mask graph lost its exact authored checkpoint.');
		const graph = preparePixelFrameWebGl2MaskGraphCurrentV1(request.graph, request.descriptor);
		return Object.freeze({ checkpoint, graph });
	});
	const nativeReadbackBytes = entries.length ? 65_536 : 0, probeBytes = entries.length ? 4096 : 0, stateBytes = entries.length ? 4096 : 0;
	const graphExecutionBytes = Math.max(0, ...entries.map(entry => entry.graph.graphGpuBytes));
	// C owns canonical64KiB +header/hash/digests separately. This owner adds only
	// its nativeRGBA uint scratch; do not substitute the graph draft's smaller
	// canonical-stripe proposal for C's actual receipt charge.
	const workingBytes = stateBytes + Math.max(probeBytes, graphExecutionBytes + nativeReadbackBytes);
	const eligible = entries.every(entry => entry.graph.eligible)
		&& checkpointPlan.knownMaskComponentBytes + workingBytes <= 64 * 1024 * 1024;
	const plan = Object.freeze({ checkpointPlan, entries: Object.freeze(entries), graphExecutionBytes, nativeReadbackBytes, probeBytes, stateBytes, workingBytes, eligible });
	PREPARED.add(plan); return plan;
}
export function readPixelFrameWebGl2MaskContextCurrentV1(value: unknown): Readonly<PreparedPixelFrameWebGl2MaskContextCurrentV1> {
	if (value === null || typeof value !== 'object' || !PREPARED.has(value)) throw new TypeError('Mask GL context requires its private scalar plan.');
	return value as Readonly<PreparedPixelFrameWebGl2MaskContextCurrentV1>;
}
