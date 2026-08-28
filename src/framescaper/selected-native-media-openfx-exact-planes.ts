/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	placeUnifiedExactLinearRgbaFrameV13,
	straightUnifiedExactLinearFrameV13,
	type UnifiedExactLinearPremultipliedFrameV13,
} from '../common/editor/unified-exact-linear-rgba-v13.ts';
import type { OfxContext } from '../common/editor/native-ofx-descriptor.ts';
import type { UnifiedExactRenderPlanV13, UnifiedExactRenderPlanV14 } from '../common/editor/unified-exact-render-plan.ts';
import {
	createFramescaperOpenFxFrameGraphNativeMedia,
	type FramescaperOpenFxFrameExecutionRequestNativeMedia,
	type FramescaperOpenFxFrameExecutionResultNativeMedia,
	type FramescaperOpenFxFrameDispositionNativeMedia,
	type FramescaperOpenFxFrameGraphNativeMedia,
	type FramescaperOpenFxFrameNativeMedia,
} from './editor-openfx-frame-graph-native-media.ts';
import {
	framescaperOpenFxOutputOrdinalNativeMedia,
	framescaperOpenFxTransitionProgressNativeMedia,
} from './editor-openfx-frame-timing-native-media.ts';

export interface FramescaperSelectedOpenFxExecutionNativeMedia {
	readonly plan: UnifiedExactRenderPlanV14;
	readonly execute: (
		request: FramescaperOpenFxFrameExecutionRequestNativeMedia,
	) => PromiseLike<FramescaperOpenFxFrameExecutionResultNativeMedia>;
	readonly resolveFrozenFrame?: Parameters<typeof createFramescaperOpenFxFrameGraphNativeMedia>[0]['resolveFrozenFrame'];
}

export interface FramescaperSelectedOpenFxExactPlanesNativeMedia {
	has(context: OfxContext, targetId: string): boolean;
	inputs(context: OfxContext, targetId: string): readonly string[];
	ordinal(position: Readonly<{ readonly num: number; readonly den: number }>): number;
	transition(transitionId: string, ordinal: number): number;
	apply(request: Readonly<{
		readonly context: OfxContext;
		readonly targetId: string;
		readonly outputOrdinal: number;
		readonly primary: Readonly<{ readonly identity: string; readonly frame: FramescaperOpenFxFrameNativeMedia }> | null;
		readonly named: readonly Readonly<{ readonly identity: string; readonly frame: FramescaperOpenFxFrameNativeMedia }>[];
		readonly transitionProgress?: number;
		readonly signal: AbortSignal;
	}>): Promise<Readonly<{
		readonly frame: UnifiedExactLinearPremultipliedFrameV13;
		readonly dispositions: readonly FramescaperOpenFxFrameDispositionNativeMedia[];
		readonly reportsDegradation: boolean;
	}>>;
}

export function createFramescaperSelectedOpenFxExactPlanesNativeMedia(options: Readonly<{
	readonly foundationPlan: UnifiedExactRenderPlanV13;
	readonly openFx: FramescaperSelectedOpenFxExecutionNativeMedia;
	readonly assertCurrent: () => void;
}>): FramescaperSelectedOpenFxExactPlanesNativeMedia {
	assertPlanParity(options.foundationPlan, options.openFx.plan);
	const graph = createFramescaperOpenFxFrameGraphNativeMedia({
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
			framescaperOpenFxOutputOrdinalNativeMedia(options.openFx.plan, position)
		),
		transition: (transitionId: string, ordinal: number) => (
			framescaperOpenFxTransitionProgressNativeMedia(options.openFx.plan, transitionId, ordinal)
		),
		apply: (request: Parameters<FramescaperSelectedOpenFxExactPlanesNativeMedia['apply']>[0]) => (
			apply(graph, options.openFx.plan, request)
		),
	});
}

export function framescaperOpenFxLinearPlaneNativeMedia(
	identity: string,
	frame: UnifiedExactLinearPremultipliedFrameV13,
) {
	return Object.freeze({ identity, frame: straightUnifiedExactLinearFrameV13(frame) });
}

export function framescaperOpenFxRgbaPlaneNativeMedia(identity: string, frame: FramescaperOpenFxFrameNativeMedia) {
	return Object.freeze({ identity, frame });
}

async function apply(
	graph: FramescaperOpenFxFrameGraphNativeMedia,
	plan: UnifiedExactRenderPlanV14,
	request: Parameters<FramescaperSelectedOpenFxExactPlanesNativeMedia['apply']>[0],
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
		throw new Error('The selected nativeMedia OpenFX graph diverges from its exact inherited picture plane.');
	}
}
