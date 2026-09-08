/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact queue semantics for process-local selected-V14 renderer carriers. */

import { createNativeMediaPlanEnvelopeV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';
import { nativeMediaV14RequiresEvaluatedCarrier } from '../src/common/editor/native-media-v14-render-family.ts';
import type { NativeQueueRecordV3 } from '../src/common/editor/native-queue-record-v3.ts';
import type { NativeQueueTransitionV1 } from '../src/common/editor/native-queue-state-machine.ts';
import { assertUnifiedExactRenderPlanWithDeferredTimingReferences } from
	'../src/common/editor/unified-exact-render-plan.ts';

export const FRAMESCAPER_NATIVE_QUEUE_RENDERER_ACTIONS = Object.freeze([
	'pause', 'resume', 'cancel', 'retry',
] as const);

export type FramescaperNativeQueueRendererAction =
	(typeof FRAMESCAPER_NATIVE_QUEUE_RENDERER_ACTIONS)[number];

export function nativeQueueRecordRequiresRendererCarrier(record: NativeQueueRecordV3): boolean {
	if ((record.taskKind !== 'encoded-export' && record.taskKind !== 'image-sequence-export')
		|| record.planVersion !== 14) return false;
	try {
		const plan = JSON.parse(record.planPayload) as unknown;
		try {
			const envelope = createNativeMediaPlanEnvelopeV2(plan);
			return envelope.planVersion === 14 && nativeMediaV14RequiresEvaluatedCarrier(envelope.plan);
		} catch {
			assertUnifiedExactRenderPlanWithDeferredTimingReferences(plan);
			return plan.version === 14 && nativeMediaV14RequiresEvaluatedCarrier(plan);
		}
	} catch {
		return false;
	}
}

export function framescaperNativeQueueControlTransitionV3(
	record: NativeQueueRecordV3,
	action: FramescaperNativeQueueRendererAction,
): NativeQueueTransitionV1 {
	if ((action === 'resume' || action === 'retry')
		&& record.lastFailureCode === 'awaiting-carrier-regeneration') {
		throw new Error('A live V14 carrier must be regenerated before this queue job can resume.');
	}
	if (action === 'pause' && (record.state === 'queued' || record.state === 'running')
		&& nativeQueueRecordRequiresRendererCarrier(record)) {
		return Object.freeze({ kind: 'await-carrier-regeneration' as const });
	}
	return Object.freeze({ kind: action });
}
