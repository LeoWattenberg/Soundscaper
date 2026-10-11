/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionComposition, MotionLayer } from './motion-composition.ts';
import { normalizeMotionTemporalSettings, motionDepthOfFieldSamples } from './motion-temporal-settings.ts';
import { addRationals, divideRationals, multiplyRationals, normalizeRational, subtractRationals, type Rational, type RationalInput } from './timeline-time.ts';
import { freezeMotionValue, motionId, motionInteger, motionRational } from './motion-values.ts';

export interface MotionPreviewQuality { readonly temporalSamples?: number; readonly depthOfFieldSamples?: number }
export interface MotionTemporalSample { readonly index: number; readonly time: Rational; readonly weight: Rational }
export interface MotionTemporalSamplePlan {
	readonly compositionId: string; readonly time: Rational; readonly frameRate: Rational; readonly width: number; readonly height: number;
	readonly depthOfFieldSamples: number; readonly depthOfFieldSampleLimit?: number; readonly samples: readonly MotionTemporalSample[];
}
const PLANS = new WeakSet<MotionTemporalSamplePlan>();
/** Exact deterministic strata; only the requested composition's shutter samples its whole nested scene. */
export function planMotionTemporalSamples(composition: Pick<MotionComposition, 'id' | 'width' | 'height' | 'frameRate' | 'temporal' | 'depthOfFieldSamples'>, timeValue: RationalInput, quality: MotionPreviewQuality = {}): MotionTemporalSamplePlan {
	const time = normalizeRational(timeValue, { maximumDenominator: Number.MAX_SAFE_INTEGER });
	const temporal = composition.temporal === undefined ? null : normalizeMotionTemporalSettings(composition.temporal);
	const count = reduced(quality.temporalSamples, temporal?.samples ?? 1, 'temporal samples');
	const depthOfFieldSamples = reduced(quality.depthOfFieldSamples, motionDepthOfFieldSamples(composition.depthOfFieldSamples ?? 16), 'depth-of-field samples');
	const frameRate = motionRational(composition.frameRate, 'temporal frame rate', true);
	const samples = Array.from({ length: count }, (_, index) => {
		const offset = temporal ? addRationals(temporal.shutterOpenFrames, multiplyRationals(subtractRationals(temporal.shutterCloseFrames, temporal.shutterOpenFrames), { num: 2 * index + 1, den: 2 * count })) : { num: 0, den: 1 };
		return { index, time: addRationals(time, divideRationals(offset, frameRate)), weight: { num: 1, den: count } };
	});
	const plan = freezeMotionValue({ compositionId: motionId(composition.id), time, frameRate, width: motionInteger(composition.width, 'temporal width', 1, 65536), height: motionInteger(composition.height, 'temporal height', 1, 65536), depthOfFieldSamples, ...(quality.depthOfFieldSamples === undefined ? {} : { depthOfFieldSampleLimit: depthOfFieldSamples }), samples });
	PLANS.add(plan); return plan;
}
export function assertMotionTemporalSamplePlan(value: MotionTemporalSamplePlan): void {
	if (!PLANS.has(value)) throw new TypeError('A planned immutable motion shutter is required.');
}
function reduced(requested: number | undefined, authored: number, label: string): number {
	const value = motionInteger(requested ?? authored, label, 1, 64);
	if (value > authored) throw new RangeError(`Preview ${label} cannot exceed authored quality.`); return value;
}
export interface MotionTemporalWorkLimits { readonly maximumPixelSamples?: number; readonly maximumSceneWork?: number }
export interface MotionTemporalWorkEstimate { readonly temporalSamples: number; readonly pixelSamples: number; readonly sceneWork: number }
/** Conservative source-independent admission before runtime/asset acquisition, including every reachable precomp occurrence.
 * Per-effect pixel work and resident working surfaces remain separately bounded by the renderer.
 */
export function admitMotionTemporalWork(project: Readonly<{ compositions: readonly MotionComposition[] }>, compositionId: string,
	quality: MotionPreviewQuality = {}, limits: MotionTemporalWorkLimits = {}): MotionTemporalWorkEstimate {
	const maximumPixels = motionInteger(limits.maximumPixelSamples ?? 268_435_456, 'temporal pixel work budget', 1, 1_073_741_824);
	const maximumScene = motionInteger(limits.maximumSceneWork ?? 262_144, 'temporal scene work budget', 1, 1_048_576);
	const compositions = new Map(project.compositions.map(composition => [composition.id, composition])); const root = compositions.get(compositionId);
	if (!root) throw new ReferenceError(`Motion composition ${compositionId} is missing.`);
	const plan = planMotionTemporalSamples(root, { num: 0, den: 1 }, quality); const temporalSamples = plan.samples.length;
	let pixelSamples = 0, sceneWork = 0, occurrences = 0;
	const visit = (composition: MotionComposition, depth: number): void => {
		if (depth > 32 || ++occurrences > 16384) throw new RangeError('Temporal composition occurrence/depth budget exceeded.');
		sceneWork += temporalSamples * (1 + composition.layers.length * 3 + composition.audio.length);
		const planes = composition.layers.filter(layer => layer.enabled && layer.is3D && !['null', 'camera', 'light', 'adjustment'].includes(layer.kind));
		const lights = composition.layers.filter(layer => layer.enabled && layer.kind === 'light');
		const shadows = lights.filter(layer => layer.kind === 'light' && layer.castsShadows && layer.lightType !== 'ambient').length;
		const casters = planes.filter(layer => layer.material.castsShadows).length;
		const response = 1 + lights.length + shadows * casters;
		const authoredLens = motionDepthOfFieldSamples(composition.depthOfFieldSamples ?? 16);
		const lens = composition.layers.some(possibleAperture) ? Math.min(quality.depthOfFieldSamples ?? authoredLens, authoredLens) : 1;
		pixelSamples += composition.width * composition.height * temporalSamples * (Math.max(1, planes.length) * lens * response + composition.layers.length);
		if (!Number.isSafeInteger(pixelSamples) || pixelSamples > maximumPixels) throw new RangeError('Temporal pixel/lens work budget exceeded before asset acquisition.');
		if (sceneWork > maximumScene) throw new RangeError('Temporal scene work budget exceeded before asset acquisition.');
		for (const layer of composition.layers) if (layer.enabled && layer.kind === 'precomp') {
			const nested = compositions.get(layer.compositionId); if (!nested) throw new ReferenceError(`Motion composition ${layer.compositionId} is missing.`); visit(nested, depth + 1);
		}
	};
	visit(root, 0); return freezeMotionValue({ temporalSamples, pixelSamples, sceneWork });
}
function possibleAperture(layer: MotionLayer): boolean {
	return layer.enabled && layer.kind === 'camera' && (layer.aperture.value > 0 || layer.aperture.curve !== null || layer.aperture.expression?.enabled === true);
}
