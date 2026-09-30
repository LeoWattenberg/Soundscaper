/* SPDX-License-Identifier: AGPL-3.0-only */

/** V2 queue adapter for generation-neutral image-sequence checkpoint recovery. */

import { createNativeMediaPlanEnvelopeV1 } from '../src/common/editor/native-media-plan-envelope.ts';
import {
	assertNativeQueueRecordV2,
	type NativeQueueRecordV2,
} from '../src/common/editor/native-queue-record.ts';
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

export interface FramescaperNativeCheckpointRecoveryOptions {
	readonly record: NativeQueueRecordV2;
	readonly rootUsable: boolean;
	readonly store?: FramescaperNativeCheckpointStore;
	readonly inspect?: (
		frame: NativeImageSequenceCheckpointFrameV1,
	) => Promise<FramescaperNativePublishedFileObservation | null>;
	readonly onError?: (error: unknown) => void;
}

const RECORD_ADAPTER: NativeCheckpointRecordAdapter<NativeQueueRecordV2> = Object.freeze({
	assertRecord: assertNativeQueueRecordV2,
	createPlanEnvelope: (plan: unknown) => createNativeMediaPlanEnvelopeV1(plan),
});

export function nativeImageSequenceSourceInventoryDigest(record: NativeQueueRecordV2): string {
	return nativeImageSequenceSourceInventoryDigestCore(record, RECORD_ADAPTER);
}

export function admitNativeImageSequenceCheckpointEvidence(
	record: NativeQueueRecordV2,
	input: NativeImageSequenceCheckpointInputV1,
): NativeImageSequenceCheckpointEvidenceV1 {
	return admitNativeImageSequenceCheckpointEvidenceCore(record, input, RECORD_ADAPTER);
}

export function verifyAndStoreNativeImageSequenceCheckpoint(
	record: NativeQueueRecordV2,
	input: NativeImageSequenceCheckpointInputV1,
	inspect: (frame: NativeImageSequenceCheckpointFrameV1) => Promise<FramescaperNativePublishedFileObservation | null>,
	store?: FramescaperNativeCheckpointStore,
): Promise<NativeImageSequenceCheckpointResultV1> {
	return verifyAndStoreNativeImageSequenceCheckpointCore(record, input, inspect, store, RECORD_ADAPTER);
}

export function recoverNativeImageSequenceCheckpoint(
	options: FramescaperNativeCheckpointRecoveryOptions,
): Promise<Readonly<{ readonly verifiedFrameCount?: number; readonly plannedFrameCount?: number }>> {
	return recoverNativeImageSequenceCheckpointCore(options, RECORD_ADAPTER);
}
