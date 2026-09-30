/* SPDX-License-Identifier: AGPL-3.0-only */

/** V3 queue adapter for generation-neutral image-sequence checkpoint recovery. */

import { createNativeMediaPlanEnvelopeV1 } from '../src/common/editor/native-media-plan-envelope.ts';
import { createNativeMediaPlanEnvelopeV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';
import {
	assertNativeQueueRecordV3,
	type NativeQueueRecordV3,
} from '../src/common/editor/native-queue-record-v3.ts';
import type {
	FramescaperNativePublishedFileObservation,
	NativeImageSequenceCheckpointFrameV1,
	NativeImageSequenceCheckpointResultV1,
} from './native-services-publication.ts';
import {
	admitNativeImageSequenceCheckpointEvidenceCore,
	nativeImageSequenceSourceInventoryDigestCore,
	recoverNativeImageSequenceCheckpointCore,
	verifyAndStoreNativeImageSequenceCheckpointCore,
	type FramescaperNativeCheckpointStore,
	type NativeCheckpointRecordAdapter,
	type NativeImageSequenceCheckpointEvidenceV1,
	type NativeImageSequenceCheckpointInputV1,
} from './native-services-checkpoint-recovery-core.ts';

export {
	FRAMESCAPER_NATIVE_CHECKPOINT_MAXIMUM_DURABLE_BYTES,
	createFramescaperNativeFilesystemCheckpointStore,
	nativeImageSequenceCheckpointEvidenceByteLength,
} from './native-services-checkpoint-recovery-core.ts';
export type {
	FramescaperNativeCheckpointStore,
	NativeImageSequenceCheckpointEvidenceV1,
	NativeImageSequenceCheckpointInputV1,
} from './native-services-checkpoint-recovery-core.ts';

export interface FramescaperNativeCheckpointRecoveryV3Options {
	readonly record: NativeQueueRecordV3;
	readonly rootUsable: boolean;
	readonly store?: FramescaperNativeCheckpointStore;
	readonly inspect?: (
		frame: NativeImageSequenceCheckpointFrameV1,
	) => Promise<FramescaperNativePublishedFileObservation | null>;
	readonly onError?: (error: unknown) => void;
}

const RECORD_ADAPTER: NativeCheckpointRecordAdapter<NativeQueueRecordV3> = Object.freeze({
	assertRecord: assertNativeQueueRecordV3,
	// V3 retains migrated V6-V12 rows for custody while dispatching V14 work.
	createPlanEnvelope: (plan: unknown, record: NativeQueueRecordV3) => (
		record.planVersion >= 13
			? createNativeMediaPlanEnvelopeV2(plan)
			: createNativeMediaPlanEnvelopeV1(plan)
	),
});

export function nativeImageSequenceSourceInventoryDigestV3(record: NativeQueueRecordV3): string {
	return nativeImageSequenceSourceInventoryDigestCore(record, RECORD_ADAPTER);
}

export function admitNativeImageSequenceCheckpointEvidenceV3(
	record: NativeQueueRecordV3,
	input: NativeImageSequenceCheckpointInputV1,
): NativeImageSequenceCheckpointEvidenceV1 {
	return admitNativeImageSequenceCheckpointEvidenceCore(record, input, RECORD_ADAPTER);
}

export function verifyAndStoreNativeImageSequenceCheckpointV3(
	record: NativeQueueRecordV3,
	input: NativeImageSequenceCheckpointInputV1,
	inspect: (frame: NativeImageSequenceCheckpointFrameV1) => Promise<FramescaperNativePublishedFileObservation | null>,
	store?: FramescaperNativeCheckpointStore,
): Promise<NativeImageSequenceCheckpointResultV1> {
	return verifyAndStoreNativeImageSequenceCheckpointCore(record, input, inspect, store, RECORD_ADAPTER);
}

export function recoverNativeImageSequenceCheckpointV3(
	options: FramescaperNativeCheckpointRecoveryV3Options,
): Promise<Readonly<{ readonly verifiedFrameCount?: number; readonly plannedFrameCount?: number }>> {
	return recoverNativeImageSequenceCheckpointCore(options, RECORD_ADAPTER);
}
