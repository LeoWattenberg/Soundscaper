/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAsset } from './motion-asset.ts';
import type { MotionSurface } from './motion-surface.ts';
import type { MotionMediaProvider } from './motion-media-provider.ts';
import type { Rational } from './timeline-time.ts';
import { compareRationals } from './timeline-time.ts';
import { awaitScapeReadOperation } from './scape-abort.ts';
import { createMotionTrackingBinding, motionTrackingSourceTime, resolveMotionTrackingSource } from './motion-tracking-authority.ts';
import { createMotionTrackingResult, normalizeMotionTrackingSettings, type MotionTrackingResult, type MotionTrackingSample, type MotionTrackingSettings } from './motion-tracking-contract.ts';
import { estimateMotionTrackingHomography, mapMotionTrackingPoint, motionTrackingQuad } from './motion-tracking-homography.ts';
import { motionTrackingFeatures, motionTrackingGrayFrame, motionTrackingMatches, motionTrackingSimilarity, motionTrackingSimilarityPoint } from './motion-tracking-primitives.ts';
export interface MotionTrackingFrameRequest { readonly asset: Extract<MotionAsset, { kind: 'footage' }>; readonly sourceTime: Rational; readonly frame: number }
export interface MotionTrackingFrameProvider {
	read(request: MotionTrackingFrameRequest, signal?: AbortSignal): Promise<{ readonly assetSha256: string; readonly sourceTime: Rational; readonly surface: MotionSurface }>;
}
/** Borrows the retained media provider; its caller continues to own disposal. */
export function createMotionTrackingFrameProvider(provider: Pick<MotionMediaProvider, 'decodeFootage'>): MotionTrackingFrameProvider {
	return { async read(request, signal) { return { assetSha256: request.asset.sha256, sourceTime: request.sourceTime, surface: await provider.decodeFootage(request.asset, request.sourceTime, signal) }; } };
}
/** Two bounded analysis frames, at most128 features, no decoded queue or partial-result publication. */
export async function analyzeMotionTracking(options: {
	readonly id: string; readonly project: unknown; readonly compositionId: string; readonly layerId: string;
	readonly settings: MotionTrackingSettings; readonly provider: MotionTrackingFrameProvider; readonly signal?: AbortSignal;
	readonly onProgress?: (completed: number, total: number) => void;
}): Promise<MotionTrackingResult> {
	options.signal?.throwIfAborted(); const settings = normalizeMotionTrackingSettings(options.settings);
	const binding = createMotionTrackingBinding(options.project, options.compositionId, options.layerId, settings);
	const source = resolveMotionTrackingSource(options.project, options.compositionId, options.layerId);
	const read = async (frame: number) => {
		options.signal?.throwIfAborted(); const sourceTime = motionTrackingSourceTime(source.composition, source.layer, frame);
		const decoded = await awaitScapeReadOperation(() => options.provider.read({ asset: source.asset, sourceTime, frame }, options.signal), options.signal);
		options.signal?.throwIfAborted();
		if (decoded.assetSha256 !== binding.inputSha256 || compareRationals(decoded.sourceTime, sourceTime) !== 0 || decoded.surface.width !== binding.width || decoded.surface.height !== binding.height) throw new Error('Tracking decoder custody differs from the pinned asset, time or dimensions; restore the source and retry.');
		return motionTrackingGrayFrame(decoded.surface, settings.maximumDimension);
	};
	let previous = await read(settings.firstFrame); let features = motionTrackingFeatures(previous, settings);
	const samples: MotionTrackingSample[] = [{ frame: settings.firstFrame, status: 'manual', points: settings.points, confidence: 1, error: 0 }];
	let lost: 'texture' | 'occlusion' | 'consensus' | null = features.length < (settings.mode === 'point' ? 1 : settings.minimumInliers) ? 'texture' : null;
	options.onProgress?.(1, settings.frameCount);
	for (let index = 1; index < settings.frameCount; index++) {
		await new Promise<void>(resolve => { setTimeout(resolve, 0); }); options.signal?.throwIfAborted();
		const frame = settings.firstFrame + index;
		if (lost) samples.push({ frame, status: 'lost', reason: lost });
		else {
			const next = await read(frame); const accepted = motionTrackingMatches(previous, next, features, settings); previous = next;
			if (accepted.length < (settings.mode === 'point' ? 1 : settings.minimumInliers)) lost = 'occlusion';
			else {
				try {
					const matches = accepted.map(item => item.match);
					const matrix = settings.mode === 'planar' ? estimateMotionTrackingHomography(matches, settings) : null;
					const similarity = settings.mode === 'stabilize' ? motionTrackingSimilarity(matches, settings.minimumInliers, settings.inlierThreshold) : null;
					const points = matrix ? settings.points.map(point => mapMotionTrackingPoint(matrix.matrix, point)) : similarity ? settings.points.map(point => motionTrackingSimilarityPoint(point, similarity)) : [matches[0]!.target];
					if (settings.mode !== 'point') motionTrackingQuad(points);
					const good = accepted.filter(({ match }) => { const point = matrix ? mapMotionTrackingPoint(matrix.matrix, match.source) : similarity ? motionTrackingSimilarityPoint(match.source, similarity) : match.target; return Math.hypot(point[0] - match.target[0], point[1] - match.target[1]) <= settings.inlierThreshold; });
					if (good.length < (settings.mode === 'point' ? 1 : settings.minimumInliers)) throw new RangeError('Refined tracking consensus was lost.');
					features = good.map(item => item.feature);
					const error = good.reduce((sum, item) => sum + item.error, 0) / good.length;
					samples.push({ frame, status: 'tracked', points, confidence: good.reduce((sum, item) => sum + item.match.confidence, 0) / good.length, error });
				} catch (error) { if (!(error instanceof RangeError)) throw error; lost = 'consensus'; }
			}
			if (lost) samples.push({ frame, status: 'lost', reason: lost });
		}
		options.onProgress?.(index + 1, settings.frameCount);
	}
	options.signal?.throwIfAborted(); return createMotionTrackingResult({ id: options.id, binding, settings, samples });
}
