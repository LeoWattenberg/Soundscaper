/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	placeUnifiedExactLinearRgbaFrameV13,
	straightUnifiedExactLinearFrameV13,
	type UnifiedExactLinearPremultipliedFrameV13,
} from '../common/editor/unified-exact-linear-rgba-v13.ts';
import type { OfxContext } from '../common/editor/native-ofx-descriptor.ts';
import type { UnifiedExactRenderPlanV13, UnifiedExactRenderPlanV14 } from '../common/editor/unified-exact-render-plan.ts';
import {
	createFramescaperOpenFxFrameGraphV28,
	type FramescaperOpenFxFrameExecutionRequestV28,
	type FramescaperOpenFxFrameExecutionResultV28,
	type FramescaperOpenFxFrameDispositionV28,
	type FramescaperOpenFxFrameGraphV28,
	type FramescaperOpenFxFrameV28,
} from './editor-openfx-frame-graph-v28.ts';
import {
	framescaperOpenFxOutputOrdinalV28,
	framescaperOpenFxTransitionProgressV28,
} from './editor-openfx-frame-timing-v28.ts';

export interface FramescaperSelectedOpenFxExecutionV28 {
	readonly plan: UnifiedExactRenderPlanV14;
	readonly execute: (
		request: FramescaperOpenFxFrameExecutionRequestV28,
	) => PromiseLike<FramescaperOpenFxFrameExecutionResultV28>;
	readonly resolveFrozenFrame?: Parameters<typeof createFramescaperOpenFxFrameGraphV28>[0]['resolveFrozenFrame'];
}

export interface FramescaperSelectedOpenFxExactPlanesV28 {
	has(context: OfxContext, targetId: string): boolean;
	inputs(context: OfxContext, targetId: string): readonly string[];
	ordinal(position: Readonly<{ readonly num: number; readonly den: number }>): number;
	transition(transitionId: string, ordinal: number): number;
	apply(request: Readonly<{
		readonly context: OfxContext;
		readonly targetId: string;
		readonly outputOrdinal: number;
		readonly primary: Readonly<{ readonly identity: string; readonly frame: FramescaperOpenFxFrameV28 }> | null;
		readonly named: readonly Readonly<{ readonly identity: string; readonly frame: FramescaperOpenFxFrameV28 }>[];
		readonly transitionProgress?: number;
		readonly signal: AbortSignal;
	}>): Promise<Readonly<{
		readonly frame: UnifiedExactLinearPremultipliedFrameV13;
		readonly dispositions: readonly FramescaperOpenFxFrameDispositionV28[];
		readonly reportsDegradation: boolean;
	}>>;
}

export function createFramescaperSelectedOpenFxExactPlanesV28(options: Readonly<{
	readonly foundationPlan: UnifiedExactRenderPlanV13;
	readonly openFx: FramescaperSelectedOpenFxExecutionV28;
	readonly assertCurrent: () => void;
}>): FramescaperSelectedOpenFxExactPlanesV28 {
	assertPlanParity(options.foundationPlan, options.openFx.plan);
	const graph = createFramescaperOpenFxFrameGraphV28({
		plan: options.openFx.plan, assertCurrent: options.assertCurrent,
		execute: options.openFx.execute,
		...(options.openFx.resolveFrozenFrame ? { resolveFrozenFrame: options.openFx.resolveFrozenFrame } : {}),
		allowRepeatedFrames: true,
	});
	return Object.freeze({
		has: (context: OfxContext, targetId: string) => options.openFx.plan.nodes.some((node) => (
			node.kind === 'openfx' && node.state.enabled && node.state.context === context
				&& node.state.attachment.targetId === targetId
		)),
		inputs: (context: OfxContext, targetId: string) => Object.freeze([...new Set(
			options.openFx.plan.nodes.flatMap((node) => node.kind === 'openfx'
				&& node.state.enabled && node.state.context === context
				&& node.state.attachment.targetId === targetId
				? node.state.inputs.map(({ sourceRef }) => sourceRef) : []),
		)]),
		ordinal: (position: Readonly<{ readonly num: number; readonly den: number }>) => (
			framescaperOpenFxOutputOrdinalV28(options.openFx.plan, position)
		),
		transition: (transitionId: string, ordinal: number) => (
			framescaperOpenFxTransitionProgressV28(options.openFx.plan, transitionId, ordinal)
		),
		apply: (request: Parameters<FramescaperSelectedOpenFxExactPlanesV28['apply']>[0]) => (
			apply(graph, options.openFx.plan, request)
		),
	});
}

export function framescaperOpenFxLinearPlaneV28(
	identity: string,
	frame: UnifiedExactLinearPremultipliedFrameV13,
) {
	return Object.freeze({ identity, frame: straightUnifiedExactLinearFrameV13(frame) });
}

export function framescaperOpenFxRgbaPlaneV28(identity: string, frame: FramescaperOpenFxFrameV28) {
	return Object.freeze({ identity, frame });
}

async function apply(
	graph: FramescaperOpenFxFrameGraphV28,
	plan: UnifiedExactRenderPlanV14,
	request: Parameters<FramescaperSelectedOpenFxExactPlanesV28['apply']>[0],
) {
	const result = await graph.apply({
		context: request.context, targetId: request.targetId,
		outputOrdinal: request.outputOrdinal,
		primary: request.primary === null ? null : Object.freeze({
			identity: request.primary.identity, rgba: request.primary.frame,
		}),
		namedPlanes: Object.freeze(request.named.map(({ identity, frame }) => Object.freeze({ identity, rgba: frame }))),
		...(request.transitionProgress === undefined ? {} : { transitionProgress: request.transitionProgress }),
		...(request.context === 'retimer' ? {
			// This renderer value never crosses the port. Main reconstructs the authenticated source time.
			retimerSourceTime: Object.freeze({ num: request.outputOrdinal, den: 1 }),
		} : {}),
		signal: request.signal,
	});
	return Object.freeze({
		frame: placeUnifiedExactLinearRgbaFrameV13({
		frame: result.frame, displayWidth: result.frame.width, displayHeight: result.frame.height,
		outputWidth: result.frame.width, outputHeight: result.frame.height,
		renderDescription: identityDescription(plan.output.canvas.width, plan.output.canvas.height),
		}),
		dispositions: result.dispositions,
		reportsDegradation: result.reportsDegradation,
	});
}

function identityDescription(width: number, height: number) {
	return Object.freeze({
		crop: Object.freeze({ normalized: Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 }),
			sourcePixels: Object.freeze({ x: 0, y: 0, width, height }) }),
		sourceDisplayToCanvas: Object.freeze([1, 0, 0, 1, 0, 0]),
		opacityStart: 1, opacityEnd: 1, blendMode: 'normal', compositingOrder: 0,
	});
}

function assertPlanParity(foundation: UnifiedExactRenderPlanV13, plan: UnifiedExactRenderPlanV14): void {
	if (foundation.output.canvas.width !== plan.output.canvas.width
		|| foundation.output.canvas.height !== plan.output.canvas.height
		|| foundation.timebase.sampleRate !== plan.timebase.sampleRate
		|| foundation.timebase.sampleStart !== plan.timebase.sampleStart
		|| foundation.timebase.sampleDuration !== plan.timebase.sampleDuration
		|| JSON.stringify(foundation.timebase.sequenceRate) !== JSON.stringify(plan.timebase.sequenceRate)
		|| JSON.stringify(foundation.output.frameRate) !== JSON.stringify(plan.output.frameRate)) {
		throw new Error('The selected V28 OpenFX graph diverges from its exact inherited picture plane.');
	}
}
