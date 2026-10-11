/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionDesktopDelivery, MotionDesktopDeliveryReceipt } from '../src/common/editor/motion-desktop-delivery-contract.ts';
import { framescaperSuccessorNativeCarrierPlan, FRAMESCAPER_SUCCESSOR_DELIVERY_PROFILE } from '../src/framescaper/editor-successor-native-delivery-contract.ts';
import { dispatchMotionscaperDeliveryCall } from './motionscaper-delivery-ipc.ts';
/** The isolated successor admits only its Frame sequence contract, not baseline native service operations. */
export async function dispatchFramescaperSuccessorDeliveryCall(authority: MotionDesktopDelivery, method: unknown, payload: unknown): Promise<unknown> {
	if (method === 'begin') {
		if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Frame native payload fields are invalid.');
		const request = payload as Record<string, unknown>;
		return dispatchMotionscaperDeliveryCall(authority, method, { ...request, plan: framescaperSuccessorNativeCarrierPlan(request.plan) });
	}
	const result = await dispatchMotionscaperDeliveryCall(authority, method, payload);
	if (method === 'getProfile') return result ? FRAMESCAPER_SUCCESSOR_DELIVERY_PROFILE : null;
	if (method === 'commit') {
		const receipt = result as MotionDesktopDeliveryReceipt;
		return { ...receipt, identity: { projectId: receipt.identity.projectId, revisionDigest: receipt.identity.revisionDigest, sequenceId: receipt.identity.compositionId }, profile: FRAMESCAPER_SUCCESSOR_DELIVERY_PROFILE };
	}
	return result;
}
