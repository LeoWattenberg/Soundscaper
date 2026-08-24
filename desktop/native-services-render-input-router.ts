/* SPDX-License-Identifier: AGPL-3.0-only */

/** Routes durable legacy stages and bounded replay-safe V14 stages by opaque id. */

import { join } from 'node:path';

import type { NativeQueueRecordV2 } from '../src/common/editor/native-queue-record.ts';
import type { NativeQueueRecordV3 } from '../src/common/editor/native-queue-record-v3.ts';
import type { HelperDataPlaneIoPort } from './helper-data-plane-io.ts';
import type { FramescaperOpenFxLiveFrameTransformFactory } from './framescaper-openfx-live-frame-transform.ts';
import { FramescaperNativeLiveRenderInputStaging,
	type FramescaperNativeLiveRenderInputMessageChannel,
	type FramescaperNativeLiveRenderInputStagingOptions,
} from './native-services-live-render-input-staging.ts';
import {
	nativeRenderInputClaimRequest,
	nativeRenderInputReceiveRequest,
	nativeRenderInputStageIdRequest,
} from './native-services-render-input-contract.ts';
import {
	FramescaperNativeRenderInputStaging,
	type FramescaperNativeDerivedRenderInputs,
	type FramescaperNativeRenderInputReclamationResult,
} from './native-services-render-input-staging.ts';

type QueueRecord = NativeQueueRecordV2 | NativeQueueRecordV3;

export interface FramescaperNativeRenderInputRouterOptions {
	readonly root: string;
	readonly mintStageId: () => string;
	readonly createMessageChannel: () => FramescaperNativeLiveRenderInputMessageChannel;
	readonly openFxTransformFactory?: FramescaperOpenFxLiveFrameTransformFactory | null;
	readonly storageAdmission?: FramescaperNativeLiveRenderInputStagingOptions['storageAdmission'];
	readonly now?: () => number;
}

export class FramescaperNativeRenderInputRouter {
	readonly #durable: FramescaperNativeRenderInputStaging;
	readonly #live: FramescaperNativeLiveRenderInputStaging;

	constructor(options: FramescaperNativeRenderInputRouterOptions) {
		const common = {
			mintStageId: options.mintStageId,
			...(options.now ? { now: options.now } : {}),
		};
		this.#durable = new FramescaperNativeRenderInputStaging({
			...common, root: join(options.root, 'durable'),
		});
		this.#live = new FramescaperNativeLiveRenderInputStaging({
			...common, root: join(options.root, 'live'),
			createMessageChannel: options.createMessageChannel,
			...(options.storageAdmission ? { storageAdmission: options.storageAdmission } : {}),
			...(options.openFxTransformFactory === undefined ? {}
				: { openFxTransformFactory: options.openFxTransformFactory }),
		});
	}

	mountOpenFxTransformFactory(factory: FramescaperOpenFxLiveFrameTransformFactory): void {
		this.#live.mountOpenFxTransformFactory(factory);
	}

	openFxTransformAudit(stageId: string) { return this.#live.openFxTransformAudit(stageId); }

	begin(owner: unknown, value: unknown) { return this.#durable.begin(owner, value); }
	beginLive(owner: unknown, value: unknown) { return this.#live.beginLive(owner, value); }

	receive(owner: unknown, value: unknown, port: HelperDataPlaneIoPort): Promise<void> {
		const request = nativeRenderInputReceiveRequest(value);
		return this.#live.owns(request.stageId)
			? this.#live.receive(owner, request, port)
			: this.#durable.receive(owner, request, port);
	}

	finalize(owner: unknown, value: unknown): Promise<Readonly<{ stageId: string }>> {
		const request = nativeRenderInputStageIdRequest(value, 'router finalization');
		return this.#live.owns(request.stageId)
			? this.#live.finalize(owner, request)
			: this.#durable.finalize(owner, request);
	}

	claim(owner: unknown, value: unknown): Promise<void> {
		const request = nativeRenderInputClaimRequest(value);
		return this.#live.owns(request.derivedInputStageId)
			? this.#live.claim(owner, request)
			: this.#durable.claim(owner, request);
	}

	rollbackClaim(owner: unknown, value: unknown): Promise<void> {
		const request = nativeRenderInputStageIdRequest(value, 'router claim rollback');
		return this.#live.owns(request.stageId)
			? this.#live.rollbackClaim(owner, request)
			: this.#durable.rollbackClaim(owner, request);
	}

	scratchReservation(owner: unknown, value: unknown): number {
		const request = nativeRenderInputClaimRequest(value);
		if (!this.#live.owns(request.derivedInputStageId)) {
			throw new Error('Only a live V14 carrier has a replay scratch reservation.');
		}
		return this.#live.scratchReservation(owner, request);
	}

	outstandingLiveScratchByteLength(): Promise<number> {
		return this.#live.outstandingScratchByteLength();
	}

	writeLive(owner: unknown, value: unknown) { return this.#live.writeLive(owner, value); }
	completeLive(owner: unknown, value: unknown) { return this.#live.completeLive(owner, value); }

	abandon(owner: unknown, value: Readonly<{ stageId: string }>): Promise<void> {
		const request = nativeRenderInputStageIdRequest(value, 'router abandonment');
		return this.#live.owns(request.stageId)
			? this.#live.abandon(owner, request)
			: this.#durable.abandon(owner, request);
	}

	async abandonOwner(owner: unknown): Promise<number> {
		const [durable, live] = await Promise.all([
			this.#durable.abandonOwner(owner), this.#live.abandonOwner(owner),
		]);
		return durable + live;
	}

	async reclaim(records: readonly QueueRecord[]): Promise<FramescaperNativeRenderInputReclamationResult> {
		const [durable, live] = await Promise.all([
			this.#durable.reclaim(records), this.#live.reclaim(records),
		]);
		return Object.freeze({
			scannedStages: durable.scannedStages + live.scannedStages,
			preservedStages: durable.preservedStages + live.preservedStages,
			removedStages: durable.removedStages + live.removedStages,
			reclaimedDeclaredBytes: durable.reclaimedDeclaredBytes + live.reclaimedDeclaredBytes,
		});
	}

	revalidate(record: QueueRecord): Promise<boolean> {
		return this.#live.owns(record.jobId)
			? this.#live.revalidate(record) : this.#durable.revalidate(record);
	}

	inspect(record: QueueRecord): Promise<FramescaperNativeDerivedRenderInputs> {
		return this.#live.owns(record.jobId)
			? this.#live.inspect(record) : this.#durable.inspect(record);
	}

	settle(record: QueueRecord, outcome: 'succeeded' | 'paused' | 'cancelled' | 'failed'): Promise<void> {
		return this.#live.owns(record.jobId)
			? this.#live.settle(record, outcome) : this.#durable.settle(record, outcome);
	}

	remove(record: QueueRecord): Promise<void> {
		return this.#live.owns(record.jobId)
			? this.#live.remove(record) : this.#durable.remove(record);
	}
}
