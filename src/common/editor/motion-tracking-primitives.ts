/* SPDX-License-Identifier: AGPL-3.0-only */
import { createGrayVideoFrameV1, detectShiTomasiFeaturesV1, trackPyramidalLucasKanadeV1, estimateSimilarityRansacV1, resolveStabilizationTransformV1, applySimilarityTransformV1,
	type GrayVideoFrameV1, type ShiTomasiFeatureV1, type VideoSimilarityTransformV1 } from './video-motion-processing-v27.ts';
import { validateMotionSurface, type MotionSurface } from './motion-surface.ts';
import type { MotionVector2 } from './motion-property.ts';
import type { MotionTrackingSettings } from './motion-tracking-contract.ts';
import { MOTION_TRACKING_LIMITS } from './motion-tracking-contract.ts';
import type { MotionTrackingMatch } from './motion-tracking-homography.ts';
export interface MotionTrackingGrayFrame { readonly gray: GrayVideoFrameV1; readonly scaleX: number; readonly scaleY: number }
export interface MotionTrackingFeature { readonly origin: MotionVector2; readonly current: ShiTomasiFeatureV1 }
/** Narrow adapter to common optical-flow primitives; no editorial runtime or native authority. */
export function motionTrackingGrayFrame(surface: MotionSurface, maximumDimension: number): MotionTrackingGrayFrame {
	if (surface.width * surface.height > MOTION_TRACKING_LIMITS.maximumDecodedPixels) throw new RangeError('Tracking decode exceeds its pixel budget; use a smaller retained source.');
	validateMotionSurface(surface);
	const scale = Math.min(1, maximumDimension / Math.max(surface.width, surface.height));
	const width = Math.max(2, Math.round(surface.width * scale)); const height = Math.max(2, Math.round(surface.height * scale));
	if (surface.width < 2 || surface.height < 2) throw new RangeError('Tracking requires a two-dimensional textured source.');
	const scaleX = (width - 1) / (surface.width - 1); const scaleY = (height - 1) / (surface.height - 1);
	const luminance = (x: number, y: number) => { const offset = (y * surface.width + x) * 4; return 0.2126 * surface.pixels[offset]! + 0.7152 * surface.pixels[offset + 1]! + 0.0722 * surface.pixels[offset + 2]!; };
	const samples = Array.from({ length: width * height }, (_, index) => {
		const x = (index % width) / scaleX; const y = Math.floor(index / width) / scaleY; const x0 = Math.floor(x); const y0 = Math.floor(y); const x1 = Math.min(surface.width - 1, x0 + 1); const y1 = Math.min(surface.height - 1, y0 + 1);
		return Math.max(0, Math.min(1, (luminance(x0, y0) * (1 - (x - x0)) + luminance(x1, y0) * (x - x0)) * (1 - (y - y0)) + (luminance(x0, y1) * (1 - (x - x0)) + luminance(x1, y1) * (x - x0)) * (y - y0)));
	});
	return { gray: createGrayVideoFrameV1({ width, height, samples }), scaleX, scaleY };
}
export function motionTrackingFeatures(frame: MotionTrackingGrayFrame, settings: MotionTrackingSettings): readonly MotionTrackingFeature[] {
	if (settings.mode === 'point') { const origin = settings.points[0]!; return [{ origin, current: { x: origin[0] * frame.scaleX, y: origin[1] * frame.scaleY, score: 1 } }]; }
	const x0 = Math.max(0, Math.floor(Math.min(...settings.points.map(point => point[0])) * frame.scaleX));
	const y0 = Math.max(0, Math.floor(Math.min(...settings.points.map(point => point[1])) * frame.scaleY));
	const x1 = Math.min(frame.gray.width - 1, Math.ceil(Math.max(...settings.points.map(point => point[0])) * frame.scaleX));
	const y1 = Math.min(frame.gray.height - 1, Math.ceil(Math.max(...settings.points.map(point => point[1])) * frame.scaleY));
	const width = x1 - x0 + 1; const height = y1 - y0 + 1; if (width < 5 || height < 5) return [];
	const region = createGrayVideoFrameV1({ width, height, samples: Array.from({ length: width * height }, (_, index) => frame.gray.samples[(y0 + Math.floor(index / width)) * frame.gray.width + x0 + index % width]!) });
	const candidates = detectShiTomasiFeaturesV1(region, { maximumFeatures: MOTION_TRACKING_LIMITS.maximumFeatures, quality: settings.quality, minimumDistance: settings.minimumDistance });
	return candidates.map(point => { const current = { x: point.x + x0, y: point.y + y0, score: point.score }; return { current, origin: [current.x / frame.scaleX, current.y / frame.scaleY] as const }; })
		.filter(feature => inside(feature.origin, settings.points)).slice(0, settings.maximumFeatures);
}
export function motionTrackingMatches(previous: MotionTrackingGrayFrame, next: MotionTrackingGrayFrame, features: readonly MotionTrackingFeature[], settings: MotionTrackingSettings) {
	const options = { windowRadius: settings.windowRadius, pyramidLevels: settings.pyramidLevels, maximumIterations: settings.maximumIterations, epsilon: settings.epsilon };
	const tracks = trackPyramidalLucasKanadeV1(previous.gray, next.gray, features.map(feature => feature.current), options);
	const reverse = trackPyramidalLucasKanadeV1(next.gray, previous.gray, tracks.map(track => ({ ...track.target, score: 1 })), options);
	const accepted: { readonly match: MotionTrackingMatch; readonly feature: MotionTrackingFeature; readonly error: number }[] = [];
	tracks.forEach((track, index) => {
		const back = reverse[index]!; const source = features[index]!;
		if (track.status !== 'tracked' || back.status !== 'tracked' || !Number.isFinite(track.error) || track.error > settings.maximumError
			|| Math.hypot(back.target.x - source.current.x, back.target.y - source.current.y) > 1) return;
		const confidence = Math.max(Number.EPSILON, 1 - track.error / settings.maximumError);
		accepted.push({ match: { source: source.origin, target: [track.target.x / next.scaleX, track.target.y / next.scaleY], confidence },
			feature: { origin: source.origin, current: { ...track.target, score: source.current.score } }, error: track.error });
	});
	return accepted;
}
export function motionTrackingSimilarity(matches: readonly MotionTrackingMatch[], minimumInliers: number, inlierThreshold: number): VideoSimilarityTransformV1 {
	return estimateSimilarityRansacV1(matches.map(match => ({ source: { x: match.source[0], y: match.source[1] }, target: { x: match.target[0], y: match.target[1] }, confidence: match.confidence })), { minimumInliers, inlierThreshold });
}
export function motionTrackingSimilarityPoint(point: MotionVector2, transform: VideoSimilarityTransformV1): MotionVector2 {
	const mapped = applySimilarityTransformV1({ x: point[0], y: point[1] }, transform); return [mapped.x, mapped.y];
}
export function motionTrackingStabilization(matches: readonly MotionTrackingMatch[], strength: number): VideoSimilarityTransformV1 {
	return resolveStabilizationTransformV1(motionTrackingSimilarity(matches, matches.length, 0.001), strength);
}
function inside(point: MotionVector2, polygon: readonly MotionVector2[]): boolean {
	let sign = 0;
	for (let index = 0; index < polygon.length; index++) { const a = polygon[index]!; const b = polygon[(index + 1) % polygon.length]!; const cross = (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]); if (cross === 0) continue; if (sign && sign !== Math.sign(cross)) return false; sign = Math.sign(cross); }
	return true;
}
