/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProductVideoExportStrategyEncodeRequest } from '../common/editor/controller/product-video-export-strategy.ts';
import type { VideoKeyframeExportFrame } from '../common/editor/video-keyframe-export-frame-source.ts';
import type { VideoKeyframeOfflineRgbaCompositor } from '../common/editor/ui/video-keyframe-offline-rgba-renderer.ts';
import type { UnifiedExactRenderPlanV13 } from '../common/editor/unified-exact-render-plan.ts';
import type { VideoSourceTimingView } from '../common/editor/video-source-timing-view.ts';
import type { FramescaperProjectFinishing } from './editor-project-finishing.ts';
import {
	createFramescaperSelectedExactFrameExecutionFinishing,
	type CaptureFrameFinishing,
	type FramescaperSelectedExactSupplementalPictureFinishing,
} from './selected-finishing-exact-frame-execution.ts';
import {
	createFramescaperVideoExportVisualExecutionFinishing,
	type FramescaperVideoExportPictureDispositionFinishing,
	type FramescaperVideoExportVisualAssetStoreFinishing,
} from './video-export-visual-execution-finishing.ts';
import { createFramescaperVideoFrameAddressFinishing } from './video-frame-address-finishing.ts';
import type { FramescaperSelectedOpenFxExecutionNativeMedia } from './selected-native-media-openfx-exact-planes.ts';

export type CreateFramescaperOpenFxExactExecutionNativeMedia = (options: Readonly<{
	readonly foundationPlan: UnifiedExactRenderPlanV13;
	readonly timingViews: ReadonlyMap<string, VideoSourceTimingView>;
}>) => FramescaperSelectedOpenFxExecutionNativeMedia;

export interface FramescaperVideoExportSupplementalPictureExecutionFinishing {
	resolve(request: Readonly<{
		readonly frame: VideoKeyframeExportFrame;
		readonly sequencePosition: Readonly<{ readonly num: number; readonly den: number }>;
		readonly width: number;
		readonly height: number;
		readonly signal: AbortSignal;
	}>): PromiseLike<readonly FramescaperSelectedExactSupplementalPictureFinishing[]>
		| readonly FramescaperSelectedExactSupplementalPictureFinishing[];
	dispose(): PromiseLike<void> | void;
}

export type CreateFramescaperVideoExportSupplementalPictureExecutionFinishing = (
	options: Readonly<{
		readonly canonicalProject: Readonly<Record<string, unknown>>;
		readonly foundationPlan: UnifiedExactRenderPlanV13;
		readonly signal: AbortSignal;
		readonly assertCurrent: () => void;
	}>,
) => PromiseLike<FramescaperVideoExportSupplementalPictureExecutionFinishing | null>
	| FramescaperVideoExportSupplementalPictureExecutionFinishing | null;

export interface FramescaperVideoExportExactExecutionFinishing {
	readonly compositor: VideoKeyframeOfflineRgbaCompositor;
	disposition(): FramescaperVideoExportPictureDispositionFinishing;
	dispose(): Promise<void>;
}

/** Own the authenticated V13 source-layer route and all of its frame-addressed resources. */
export async function createFramescaperVideoExportExactExecutionFinishing(options: Readonly<{
	readonly profile: unknown;
	readonly project: FramescaperProjectFinishing;
	readonly request: ProductVideoExportStrategyEncodeRequest;
	readonly store?: FramescaperVideoExportVisualAssetStoreFinishing;
	readonly captureFrame?: CaptureFrameFinishing;
	readonly createAcceleratorCanvas?: () => unknown;
	readonly createOpenFxExecution?: CreateFramescaperOpenFxExactExecutionNativeMedia;
	readonly createSupplementalPictureExecution?: CreateFramescaperVideoExportSupplementalPictureExecutionFinishing;
}>): Promise<FramescaperVideoExportExactExecutionFinishing> {
	const timingViewsBySourceId = rawTiming(options.request);
	const visual = await createFramescaperVideoExportVisualExecutionFinishing({
		profile: options.profile, project: options.project, plan: options.request.plan,
		timingViewsBySourceId, ...(options.store ? { store: options.store } : {}),
		signal: options.request.signal, assertCurrent: options.request.assertCurrent,
	});
	const sourceFrames = createFramescaperVideoFrameAddressFinishing({
		sources: options.request.videoBlobs, timingViewsBySourceId,
	});
	let exact: Awaited<ReturnType<typeof createFramescaperSelectedExactFrameExecutionFinishing>>;
	try {
		exact = await createFramescaperSelectedExactFrameExecutionFinishing({
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
		const failures: unknown[] = [error];
		try { visual.dispose(); } catch (cleanupError) { failures.push(cleanupError); }
		try { await sourceFrames.dispose(); } catch (cleanupError) { failures.push(cleanupError); }
		if (failures.length > 1) {
			throw new AggregateError(failures, 'finishing exact export startup cleanup failed.', { cause: error });
		}
		throw error;
	}
	let supplemental: FramescaperVideoExportSupplementalPictureExecutionFinishing | null = null;
	let supplementalCandidate: unknown = null;
	try {
		supplementalCandidate = await options.createSupplementalPictureExecution?.({
			canonicalProject: options.request.canonicalProject,
			foundationPlan: visual.exactPlan,
			signal: options.request.signal,
			assertCurrent: options.request.assertCurrent,
		}) ?? null;
		assertSupplementalExecution(supplementalCandidate);
		supplemental = supplementalCandidate;
	} catch (error) {
		const failures: unknown[] = [error];
		try { await disposeSupplementalCandidate(supplementalCandidate); } catch (cleanupError) {
			failures.push(cleanupError);
		}
		try { await exact.dispose(); } catch (cleanupError) { failures.push(cleanupError); }
		try { await sourceFrames.dispose(); } catch (cleanupError) { failures.push(cleanupError); }
		try { visual.dispose(); } catch (cleanupError) { failures.push(cleanupError); }
		if (failures.length > 1) {
			throw new AggregateError(failures, 'finishing supplemental export startup cleanup failed.', { cause: error });
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
			throw new TypeError('Selected finishing supplemental picture execution must return an array.');
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
	function disposition(): FramescaperVideoExportPictureDispositionFinishing {
		if (renderedFrameCount < 1) {
			throw new Error('Selected finishing encoder did not invoke its exact source-layer compositor.');
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
		if (failures.length > 0) throw new AggregateError(failures, 'finishing exact export cleanup failed.');
	}
	return Object.freeze({ compositor, disposition, dispose });
}

function assertSupplementalExecution(
	value: unknown,
): asserts value is FramescaperVideoExportSupplementalPictureExecutionFinishing | null {
	if (value === null) return;
	if (!value || typeof value !== 'object') {
		throw new TypeError('Selected finishing supplemental picture execution is invalid.');
	}
	const candidate = value as Readonly<Record<PropertyKey, unknown>>;
	if (typeof candidate.resolve !== 'function' || typeof candidate.dispose !== 'function') {
		throw new TypeError('Selected finishing supplemental picture execution is invalid.');
	}
}

async function disposeSupplementalCandidate(value: unknown): Promise<void> {
	if (!value || typeof value !== 'object') return;
	const dispose = Reflect.get(value, 'dispose') as unknown;
	if (typeof dispose === 'function') await Reflect.apply(dispose, value, []) as unknown;
}

function rawTiming(request: ProductVideoExportStrategyEncodeRequest) {
	if (!(request.timingViewsBySourceId instanceof Map)) {
		throw new TypeError('Selected finishing browser export lost its raw exact timing authority.');
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
		throw new RangeError('finishing exact sequence position exceeds its rational domain.');
	}
	return Object.freeze({ num, den });
}
