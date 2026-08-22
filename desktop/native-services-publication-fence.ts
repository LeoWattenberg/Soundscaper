/* SPDX-License-Identifier: AGPL-3.0-only */

/** Crosses every awaited publication boundary with fresh main-owned authority. */

import type { NativeQueueRecordV2 } from '../src/common/editor/native-queue-record.ts';
import type { FramescaperNativeServicesLease } from './native-services-database.ts';
import type { FramescaperNativePublicationFence } from './native-services-publication.ts';
import type { FramescaperNativeQueueRepository } from './native-services-queue-repository.ts';
import type {
	FramescaperNativeRootGrant,
	FramescaperNativeRootProbe,
	FramescaperNativeRootRepository,
} from './native-services-root-repository.ts';

export interface FramescaperNativePublicationFenceOptions {
	readonly queue: FramescaperNativeQueueRepository;
	readonly roots: FramescaperNativeRootRepository;
	readonly lease: () => FramescaperNativeServicesLease;
	readonly now: () => number;
	readonly probeRoot: FramescaperNativeRootProbe;
	readonly authorized: (record: NativeQueueRecordV2) => boolean;
}

export class FramescaperNativePublicationFenceService {
	readonly #options: FramescaperNativePublicationFenceOptions;

	constructor(options: FramescaperNativePublicationFenceOptions) {
		this.#options = options;
	}

	for(
		record: NativeQueueRecordV2,
		root: FramescaperNativeRootGrant,
	): FramescaperNativePublicationFence {
		const assert = () => this.#assert(record, root);
		return Object.freeze({ beforePublication: assert, afterPublication: assert });
	}

	async #assert(record: NativeQueueRecordV2, root: FramescaperNativeRootGrant): Promise<void> {
		this.#assertDurable(record, root);
		if (!await this.#options.roots.revalidate(root.grantId, this.#options.probeRoot)) {
			throw new Error('The native publication root changed identity at its physical fence.');
		}
		this.#assertDurable(record, root);
	}

	#assertDurable(record: NativeQueueRecordV2, root: FramescaperNativeRootGrant): void {
		const lease = this.#options.lease();
		this.#options.queue.assertWriterLease(lease, this.#options.now());
		const current = this.#options.queue.read(record.jobId);
		if (current === null || current.state !== 'running'
			|| current.planFingerprint !== record.planFingerprint
			|| current.rootGrantId !== root.grantId
			|| current.relativeDestination !== record.relativeDestination) {
			throw new Error('The native publication queue authority changed before advertisement.');
		}
		const active = this.#options.roots.requireActive(root.grantId);
		if (active.rootPath !== root.rootPath
			|| active.volumeIdentity !== root.volumeIdentity
			|| active.directoryIdentity !== root.directoryIdentity) {
			throw new Error('The native publication root authority changed identity.');
		}
		if (!this.#options.authorized(current)) {
			throw new Error('The native publication runtime or policy capability is no longer authorized.');
		}
	}
}
