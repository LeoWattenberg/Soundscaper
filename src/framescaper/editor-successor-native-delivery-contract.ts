/* SPDX-License-Identifier: AGPL-3.0-only */
import { MOTION_PRORES_DELIVERY_PROFILE, type MotionDesktopDelivery, type MotionDesktopDeliveryReceipt } from '../common/editor/motion-desktop-delivery-contract.ts';
import { normalizeMotionRenderPlan } from '../common/editor/controller/export/motion-render-pipeline.ts';
import { motionRecord } from '../common/editor/motion-values.ts';
import type { MotionNativeFramePlan } from '../common/editor/motion-native-frame-carrier-v1.ts';
export const FRAMESCAPER_SUCCESSOR_DELIVERY_CHANNEL = 'framescaper:successor:v1:delivery';
export const FRAMESCAPER_SUCCESSOR_DELIVERY_PROFILE = Object.freeze({ ...MOTION_PRORES_DELIVERY_PROFILE,
	projectSchemaFamily: 'framescaper', projectSchemaVersion: 2, inputPrecision: 'frame-finishing-rgba8',
} as const);
export interface FramescaperSuccessorNativeIdentity { readonly projectId: string; readonly revisionDigest: string; readonly sequenceId: string }
export interface FramescaperSuccessorNativePlan extends Omit<MotionNativeFramePlan, 'identity'> { readonly identity: FramescaperSuccessorNativeIdentity }
export interface FramescaperSuccessorNativeReceipt extends Omit<MotionDesktopDeliveryReceipt, 'identity' | 'profile'> {
	readonly identity: FramescaperSuccessorNativeIdentity; readonly profile: typeof FRAMESCAPER_SUCCESSOR_DELIVERY_PROFILE;
}
export interface FramescaperSuccessorNativeDelivery extends Omit<MotionDesktopDelivery, 'begin' | 'commit' | 'getProfile'> {
	getProfile(): Promise<typeof FRAMESCAPER_SUCCESSOR_DELIVERY_PROFILE | null>;
	begin(request: Omit<Parameters<MotionDesktopDelivery['begin']>[0], 'plan'> & { readonly plan: FramescaperSuccessorNativePlan }): Promise<{ readonly token: string } | null>;
	commit(request: Parameters<MotionDesktopDelivery['commit']>[0]): Promise<FramescaperSuccessorNativeReceipt>;
}
/** The shared carrier's composition coordinate represents this Frame sequence, never a fabricated Motion project. */
export function framescaperSuccessorNativeCarrierPlan(value: unknown): MotionNativeFramePlan {
	const plan = motionRecord(value, ['identity', 'width', 'height', 'frameRate', 'firstFrame', 'frameCount'], 'Frame native plan');
	const identity = motionRecord(plan.identity, ['projectId', 'revisionDigest', 'sequenceId'], 'Frame native identity');
	return normalizeMotionRenderPlan({ ...plan, identity: { projectId: identity.projectId, revisionDigest: identity.revisionDigest, compositionId: identity.sequenceId } });
}
export function framescaperSuccessorNativePlan(value: unknown): FramescaperSuccessorNativePlan {
	const carrier = framescaperSuccessorNativeCarrierPlan(value);
	return Object.freeze({ ...carrier, identity: Object.freeze({ projectId: carrier.identity.projectId, revisionDigest: carrier.identity.revisionDigest, sequenceId: carrier.identity.compositionId }) });
}
