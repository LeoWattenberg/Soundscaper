/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { MotionVector2 } from './motion-property.ts';
import { motionTrackingPoint, motionTrackingQuad } from './motion-tracking-homography.ts';
import { freezeMotionValue, motionArray, motionDigest, motionEnum, motionId, motionInteger, motionNumber, motionRecord } from './motion-values.ts';
export const MOTION_TRACKING_LIMITS = Object.freeze({ maximumFrames: 4096, maximumFeatures: 128, maximumDimension: 512, maximumDecodedPixels: 4_194_304, maximumAnalyses: 64, maximumProjectSamples: 65_536 });
export interface MotionTrackingSettings {
	readonly mode: 'point' | 'planar' | 'stabilize'; readonly firstFrame: number; readonly frameCount: number;
	readonly points: readonly MotionVector2[]; readonly maximumDimension: number; readonly maximumFeatures: number;
	readonly quality: number; readonly minimumDistance: number; readonly windowRadius: number;
	readonly pyramidLevels: number; readonly maximumIterations: number; readonly epsilon: number;
	readonly maximumError: number; readonly inlierThreshold: number; readonly minimumInliers: number;
}
export interface MotionTrackingBinding {
	readonly coordinateSpace: 'raw-source-pixels'; readonly projectId: string; readonly compositionId: string; readonly layerId: string;
	readonly assetId: string; readonly inputSha256: string; readonly sourceDigest: string; readonly settingsDigest: string;
	readonly originRevision: number; readonly originRevisionDigest: string; readonly width: number; readonly height: number;
}
export type MotionTrackingSample = {
	readonly frame: number; readonly status: 'tracked' | 'manual'; readonly points: readonly MotionVector2[]; readonly confidence: number; readonly error: number;
} | { readonly frame: number; readonly status: 'lost'; readonly reason: 'texture' | 'occlusion' | 'consensus' };
export interface MotionTrackingResult {
	readonly version: 1; readonly id: string; readonly binding: MotionTrackingBinding; readonly settings: MotionTrackingSettings;
	readonly samples: readonly MotionTrackingSample[]; readonly digest: string;
}
export function motionTrackingDigest(value: unknown): string { return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value)))); }
export function normalizeMotionTrackingSettings(value: unknown): MotionTrackingSettings {
	const record = motionRecord(value, ['mode', 'firstFrame', 'frameCount', 'points', 'maximumDimension', 'maximumFeatures', 'quality', 'minimumDistance', 'windowRadius', 'pyramidLevels', 'maximumIterations', 'epsilon', 'maximumError', 'inlierThreshold', 'minimumInliers'], 'tracking settings');
	const mode = motionEnum(record.mode, ['point', 'planar', 'stabilize'], 'tracking mode');
	const firstFrame = motionInteger(record.firstFrame, 'tracking first frame'); const frameCount = motionInteger(record.frameCount, 'tracking frame count', 1, MOTION_TRACKING_LIMITS.maximumFrames);
	if (!Number.isSafeInteger(firstFrame + frameCount)) throw new RangeError('Tracking range exceeds exact frames.');
	const points = mode === 'point' ? motionArray(record.points, 1, 'tracking seed', 1).map(motionTrackingPoint) : motionTrackingQuad(record.points);
	const maximumFeatures = motionInteger(record.maximumFeatures, 'tracking features', 4, MOTION_TRACKING_LIMITS.maximumFeatures);
	return freezeMotionValue({ mode, firstFrame, frameCount, points,
		maximumDimension: motionInteger(record.maximumDimension, 'tracking analysis dimension', 32, MOTION_TRACKING_LIMITS.maximumDimension), maximumFeatures,
		quality: motionNumber(record.quality, 'tracking feature quality', 0.001, 1), minimumDistance: motionNumber(record.minimumDistance, 'tracking feature separation', 1, 64),
		windowRadius: motionInteger(record.windowRadius, 'tracking window radius', 1, 8), pyramidLevels: motionInteger(record.pyramidLevels, 'tracking pyramid levels', 1, 4),
		maximumIterations: motionInteger(record.maximumIterations, 'tracking iterations', 1, 32), epsilon: motionNumber(record.epsilon, 'tracking convergence', 0.001, 1),
		maximumError: motionNumber(record.maximumError, 'tracking maximum error', 0.001, 1), inlierThreshold: motionNumber(record.inlierThreshold, 'tracking inlier threshold', 0.001, 1024),
		minimumInliers: motionInteger(record.minimumInliers, 'tracking minimum inliers', mode === 'stabilize' ? 2 : 4, maximumFeatures) });
}
export function createMotionTrackingSettings(options: Pick<MotionTrackingSettings, 'mode' | 'firstFrame' | 'frameCount' | 'points'>): MotionTrackingSettings {
	return normalizeMotionTrackingSettings({ ...options, maximumDimension: 256, maximumFeatures: 64, quality: 0.05, minimumDistance: 4,
		windowRadius: 3, pyramidLevels: 3, maximumIterations: 20, epsilon: 0.01, maximumError: 0.15, inlierThreshold: 2, minimumInliers: options.mode === 'stabilize' ? 4 : 6 });
}
export function normalizeMotionTrackingBinding(value: unknown): MotionTrackingBinding {
	const record = motionRecord(value, ['coordinateSpace', 'projectId', 'compositionId', 'layerId', 'assetId', 'inputSha256', 'sourceDigest', 'settingsDigest', 'originRevision', 'originRevisionDigest', 'width', 'height'], 'tracking binding');
	if (record.coordinateSpace !== 'raw-source-pixels') throw new Error('Tracking coordinate space is unsupported; analyze retained raw footage.');
	const width = motionInteger(record.width, 'tracking source width', 1, 65536); const height = motionInteger(record.height, 'tracking source height', 1, 65536);
	if (width * height > MOTION_TRACKING_LIMITS.maximumDecodedPixels) throw new RangeError('Tracking source exceeds the decoded pixel budget; use a smaller retained source.');
	return freezeMotionValue({ coordinateSpace: 'raw-source-pixels', projectId: motionId(record.projectId), compositionId: motionId(record.compositionId), layerId: motionId(record.layerId),
		assetId: motionId(record.assetId), inputSha256: motionDigest(record.inputSha256), sourceDigest: motionDigest(record.sourceDigest), settingsDigest: motionDigest(record.settingsDigest),
		originRevision: motionInteger(record.originRevision, 'tracking origin revision'), originRevisionDigest: motionDigest(record.originRevisionDigest), width, height });
}
export function normalizeMotionTrackingSample(value: unknown, settings: MotionTrackingSettings, frame: number): MotionTrackingSample {
	const input = motionRecord(value, ['frame', 'status', 'points', 'confidence', 'error', 'reason'], 'tracking sample', ['frame', 'status']);
	if (input.frame !== frame) throw new Error('Tracking samples must cover their exact sequential frame range.');
	const status = motionEnum(input.status, ['tracked', 'manual', 'lost'], 'tracking sample status');
	if (status === 'lost') {
		const record = motionRecord(input, ['frame', 'status', 'reason'], 'lost tracking sample');
		return Object.freeze({ frame, status, reason: motionEnum(record.reason, ['texture', 'occlusion', 'consensus'], 'tracking loss reason') });
	}
	const record = motionRecord(input, ['frame', 'status', 'points', 'confidence', 'error'], 'tracked sample');
	const points = settings.mode === 'point' ? motionArray(record.points, 1, 'tracked point', 1).map(motionTrackingPoint) : motionTrackingQuad(record.points);
	return freezeMotionValue({ frame, status, points, confidence: motionNumber(record.confidence, 'tracking confidence', 0, 1), error: motionNumber(record.error, 'tracking error', 0, 1e6) });
}
function body(value: unknown): Omit<MotionTrackingResult, 'digest'> {
	const record = motionRecord(value, ['version', 'id', 'binding', 'settings', 'samples'], 'tracking result body');
	if (record.version !== 1) throw new Error('Unsupported motion tracking result version.');
	const settings = normalizeMotionTrackingSettings(record.settings); const binding = normalizeMotionTrackingBinding(record.binding);
	if (binding.settingsDigest !== motionTrackingDigest(settings)) throw new Error('Tracking settings digest differs from its analysis binding.');
	if (settings.points.some(([x, y]) => x < 0 || y < 0 || x >= binding.width || y >= binding.height)) throw new RangeError('Tracking seed points must be inside the retained raw source.');
	const samples = motionArray(record.samples, settings.frameCount, 'tracking samples', settings.frameCount).map((sample, index) => normalizeMotionTrackingSample(sample, settings, settings.firstFrame + index));
	return freezeMotionValue({ version: 1, id: motionId(record.id), binding, settings, samples });
}
export function createMotionTrackingResult(value: Omit<MotionTrackingResult, 'version' | 'digest'>): MotionTrackingResult {
	const normalized = body({ version: 1, ...value }); return freezeMotionValue({ ...normalized, digest: motionTrackingDigest(normalized) });
}
export function normalizeMotionTrackingResult(value: unknown): MotionTrackingResult {
	const record = motionRecord(value, ['version', 'id', 'binding', 'settings', 'samples', 'digest'], 'motion tracking result');
	const { digest, ...rest } = record; const normalized = body(rest);
	if (motionDigest(digest) !== motionTrackingDigest(normalized)) throw new Error('Tracking result digest differs from its canonical samples.');
	return freezeMotionValue({ ...normalized, digest: digest as string });
}
