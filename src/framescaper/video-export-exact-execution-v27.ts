/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProductVideoExportStrategyEncodeRequest } from '../common/editor/controller/product-video-export-strategy.ts';
import type { VideoKeyframeExportFrame } from '../common/editor/video-keyframe-export-frame-source.ts';
import type { VideoKeyframeOfflineRgbaCompositor } from '../common/editor/ui/video-keyframe-offline-rgba-renderer.ts';
import type { UnifiedExactRenderPlanV13 } from '../common/editor/unified-exact-render-plan.ts';
import type { VideoSourceTimingView } from '../common/editor/video-source-timing-view.ts';
import type { FramescaperProjectV27 } from './editor-project-v27.ts';
import {
	createFramescaperSelectedExactFrameExecutionV27,
	type CaptureFrameV27,
	type FramescaperSelectedExactSupplementalPictureV27,
} from './selected-v27-exact-frame-execution.ts';
import {
	createFramescaperVideoExportVisualExecutionV27,
	type FramescaperVideoExportPictureDispositionV27,
	type FramescaperVideoExportVisualAssetStoreV27,
} from './video-export-visual-execution-v27.ts';
import { createFramescaperVideoFrameAddressV27 } from './video-frame-address-v27.ts';
import type { FramescaperSelectedOpenFxExecutionV28 } from './selected-v28-openfx-exact-planes.ts';

export type CreateFramescaperOpenFxExactExecutionV28 = (options: Readonly<{
	readonly foundationPlan: UnifiedExactRenderPlanV13;
	readonly timingViews: ReadonlyMap<string, VideoSourceTimingView>;
}>) => FramescaperSelectedOpenFxExecutionV28;

export interface FramescaperVideoExportSupplementalPictureExecutionV27 {
	resolve(request: Readonly<{
		readonly frame: VideoKeyframeExportFrame;
		readonly sequencePosition: Readonly<{ readonly num: number; readonly den: number }>;
		readonly width: number;
		readonly height: number;
		readonly signal: AbortSignal;
	}>): PromiseLike<readonly FramescaperSelectedExactSupplementalPictureV27[]>
		| readonly FramescaperSelectedExactSupplementalPictureV27[];
	dispose(): PromiseLike<void> | void;
}

export type CreateFramescaperVideoExportSupplementalPictureExecutionV27 = (
	options: Readonly<{
		readonly foundationPlan: UnifiedExactRenderPlanV13;
		readonly signal: AbortSignal;
		readonly assertCurrent: () => void;
	}>,
) => PromiseLike<FramescaperVideoExportSupplementalPictureExecutionV27 | null>
	| FramescaperVideoExportSupplementalPictureExecutionV27 | null;

export interface FramescaperVideoExportExactExecutionV27 {
	readonly compositor: VideoKeyframeOfflineRgbaCompositor;
	disposition(): FramescaperVideoExportPictureDispositionV27;
	dispose(): Promise<void>;
}

/** Own the authenticated V13 source-layer route and all of its frame-addressed resources. */
export async function createFramescaperVideoExportExactExecutionV27(options: Readonly<{
	readonly profile: unknown;
	readonly project: FramescaperProjectV27;
	readonly request: ProductVideoExportStrategyEncodeRequest;
	readonly store?: FramescaperVideoExportVisualAssetStoreV27;
	readonly captureFrame?: CaptureFrameV27;
	readonly createAcceleratorCanvas?: () => unknown;
	readonly createOpenFxExecution?: CreateFramescaperOpenFxExactExecutionV28;
	readonly createSupplementalPictureExecution?: CreateFramescaperVideoExportSupplementalPictureExecutionV27;
}>): Promise<FramescaperVideoExportExactExecutionV27> {
	const timingViewsBySourceId = rawTiming(options.request);
	const visual = await createFramescaperVideoExportVisualExecutionV27({
		profile: options.profile, project: options.project, plan: options.request.plan,
		timingViewsBySourceId, ...(options.store ? { store: options.store } : {}),
		signal: options.request.signal, assertCurrent: options.request.assertCurrent,
	});
	const sourceFrames = createFramescaperVideoFrameAddressV27({
		sources: options.request.videoBlobs, timingViewsBySourceId,
	});
	let exact: Awaited<ReturnType<typeof createFramescaperSelectedExactFrameExecutionV27>>;
	try {
		exact = await createFramescaperSelectedExactFrameExecutionV27({
			project: options.project, plan: visual.exactPlan, timingSidecars: visual.timingSidecars,
			...(options.store ? { store: options.store } : {}),
			...(options.captureFrame ? { captureFrame: options.captureFrame } : {}),
			...(options.createAcceleratorCanvas
				? { createAcceleratorCanvas: options.createAcceleratorCanvas } : {}),
			...(options.createOpenFxExecution ? { openFx: options.createOpenFxExecution({
				foundationPlan: visual.exactPlan, timingViews: timingViewsBySourceId,
			}) } : {}),
			sourceFrames, signal: options.request.signal,
			assertCurrent: options.request.assertCurrent,
		});
	} catch (error) {
		visual.dispose();
		await sourceFrames.dispose();
		throw error;
	}
	let supplemental: FramescaperVideoExportSupplementalPictureExecutionV27 | null = null;
	try {
		supplemental = await options.createSupplementalPictureExecution?.({
			foundationPlan: visual.exactPlan,
			signal: options.request.signal,
			assertCurrent: options.request.assertCurrent,
		}) ?? null;
		assertSupplementalExecution(supplemental);
	} catch (error) {
		const failures: unknown[] = [error];
		try { await exact.dispose(); } catch (cleanupError) { failures.push(cleanupError); }
		try { await sourceFrames.dispose(); } catch (cleanupError) { failures.push(cleanupError); }
		try { visual.dispose(); } catch (cleanupError) { failures.push(cleanupError); }
		if (failures.length > 1) {
			throw new AggregateError(failures, 'V27 supplemental export startup cleanup failed.', { cause: error });
		}
		throw error;
	}
	let renderedFrameCount = 0;
	const openFxDispositions = [] as Array<
		Awaited<ReturnType<typeof exact.render>>['openFxDispositions'][number]
	>;
	let reportsOpenFxDegradation = false;
	const compositor: VideoKeyframeOfflineRgbaCompositor = async ({
		frame, layers, width, height, rgba, signal,
	}) => {
		const sequencePosition = exactSequencePosition(frame, visual.exactPlan);
		const supplementalPictures = supplemental === null ? Object.freeze([]) : await supplemental.resolve({
			frame, sequencePosition, width, height, signal,
		});
		if (!Array.isArray(supplementalPictures)) {
			throw new TypeError('Selected V27 supplemental picture execution must return an array.');
		}
		const result = await exact.render({
			sequencePosition, layers, supplementalPictures,
			width, height, target: rgba, signal,
		});
		visual.accountFrame(frame, result.consumedNodeIds);
		openFxDispositions.push(...result.openFxDispositions);
		reportsOpenFxDegradation ||= result.reportsOpenFxDegradation;
		renderedFrameCount += 1;
	};
	function disposition(): FramescaperVideoExportPictureDispositionV27 {
		if (renderedFrameCount < 1) {
			throw new Error('Selected V27 encoder did not invoke its exact source-layer compositor.');
		}
		return Object.freeze({
			...visual.disposition(),
			openFxDispositions: Object.freeze([...openFxDispositions]),
			reportsOpenFxDegradation,
		});
	}
	async function dispose(): Promise<void> {
		const failures: unknown[] = [];
		try { await supplemental?.dispose(); } catch (error) { failures.push(error); }
		try { await exact.dispose(); } catch (error) { failures.push(error); }
		try { await sourceFrames.dispose(); } catch (error) { failures.push(error); }
		try { visual.dispose(); } catch (error) { failures.push(error); }
		if (failures.length > 0) throw new AggregateError(failures, 'V27 exact export cleanup failed.');
	}
	return Object.freeze({ compositor, disposition, dispose });
}

function assertSupplementalExecution(
	value: FramescaperVideoExportSupplementalPictureExecutionV27 | null,
): void {
	if (value === null) return;
	if (!value || typeof value !== 'object'
		|| typeof value.resolve !== 'function' || typeof value.dispose !== 'function') {
		throw new TypeError('Selected V27 supplemental picture execution is invalid.');
	}
}

function rawTiming(request: ProductVideoExportStrategyEncodeRequest) {
	if (!(request.timingViewsBySourceId instanceof Map)) {
		throw new TypeError('Selected V27 browser export lost its raw exact timing authority.');
	}
	return request.timingViewsBySourceId;
}

function exactSequencePosition(
	frame: VideoKeyframeExportFrame,
	plan: UnifiedExactRenderPlanV13,
): Readonly<{ num: number; den: number }> {
	let numerator = BigInt(frame.timelinePosition.num) * BigInt(plan.timebase.sequenceRate.num);
	let denominator = BigInt(frame.timelinePosition.den) * BigInt(plan.timebase.sampleRate)
		* BigInt(plan.timebase.sequenceRate.den);
	let left = numerator < 0n ? -numerator : numerator;
	let right = denominator;
	while (right !== 0n) [left, right] = [right, left % right];
	numerator /= left;
	denominator /= left;
	const num = Number(numerator);
	const den = Number(denominator);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den)) {
		throw new RangeError('V27 exact sequence position exceeds its rational domain.');
	}
	return Object.freeze({ num, den });
}
