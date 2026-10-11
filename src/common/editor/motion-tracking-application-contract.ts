/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionVector3 } from './motion-property.ts';
import { freezeMotionValue, motionArray, motionDigest, motionEnum, motionId, motionNumber, motionRecord } from './motion-values.ts';
export interface MotionTrackingBaseline {
	readonly anchor: MotionVector3; readonly position: MotionVector3; readonly scale: MotionVector3; readonly rotation: MotionVector3;
}
export interface MotionTrackingApplication {
	readonly analysisId: string; readonly analysisDigest: string; readonly targetLayerId: string;
	readonly kind: 'point' | 'stabilize' | 'corner-pin'; readonly effectId: string | null;
	readonly sourceGeometryDigest: string; readonly targetDigest: string; readonly baseline: MotionTrackingBaseline;
}
export function normalizeMotionTrackingApplication(value: unknown): MotionTrackingApplication {
	const record = motionRecord(value, ['analysisId', 'analysisDigest', 'targetLayerId', 'kind', 'effectId', 'sourceGeometryDigest', 'targetDigest', 'baseline'], 'tracking application');
	const kind = motionEnum(record.kind, ['point', 'stabilize', 'corner-pin'], 'tracking application kind');
	if (kind !== 'corner-pin' && record.effectId !== null) throw new Error('Only corner-pin tracking applications carry an effect identity.');
	return freezeMotionValue({ analysisId: motionId(record.analysisId), analysisDigest: motionDigest(record.analysisDigest), targetLayerId: motionId(record.targetLayerId), kind,
		effectId: kind === 'corner-pin' ? motionId(record.effectId) : null, sourceGeometryDigest: motionDigest(record.sourceGeometryDigest), targetDigest: motionDigest(record.targetDigest), baseline: normalizeMotionTrackingBaseline(record.baseline) });
}
export function normalizeMotionTrackingBaseline(value: unknown): MotionTrackingBaseline {
	const record = motionRecord(value, ['anchor', 'position', 'scale', 'rotation'], 'tracking baseline');
	const vector = (value: unknown): MotionVector3 => motionArray(value, 3, 'tracking baseline vector', 3).map(value => motionNumber(value, 'tracking baseline coordinate')) as unknown as MotionVector3;
	return freezeMotionValue({ anchor: vector(record.anchor), position: vector(record.position), scale: vector(record.scale), rotation: vector(record.rotation) });
}
