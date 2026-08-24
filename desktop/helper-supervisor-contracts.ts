/* SPDX-License-Identifier: AGPL-3.0-only */

/** The supervisor's public seams: the channel, one job request, and its options. */

import type {
	HelperJobGrant,
	HelperJobKind,
	HelperJobResourcePolicy,
	HelperHostMessage,
} from './helper-contract.ts';
import type {
	HelperDataPlaneTransfer,
	HelperDataPlaneTransferPort,
} from './helper-data-plane-transfer.ts';

export interface HelperChannel {
	postMessage(message: HelperHostMessage, transfer?: readonly HelperDataPlaneTransferPort[]): void;
	onMessage(listener: (message: unknown) => void): void;
	onExit(listener: (code: number | null) => void): void;
	kill(): void;
}

export interface HelperJobRequest<Kind extends HelperJobKind = 'probe-video-source'> {
	readonly kind: Kind;
	readonly grant: HelperJobGrant<Kind>;
	readonly resourcePolicy?: Partial<HelperJobResourcePolicy>;
	readonly signal?: AbortSignal;
	readonly onProgress?: (value: number | null) => void;
	readonly dataPlaneTransfers?: readonly HelperDataPlaneTransfer[];
	readonly validateResult?: (value: unknown) => unknown;
}

export interface HelperSupervisorOptions {
	spawn: () => HelperChannel | Promise<HelperChannel>;
	/** Re-verifies the helper's executable payload digests before any spawn. */
	verifyBinary: () => Promise<void>;
	mintJobId: () => string;
	crashDetectionMs?: number;
	cancellationBudgetMs?: number;
	quarantineCrashLimit?: number;
	quarantineWindowMs?: number;
	sampleRss?: () => number | null;
	now?: () => number;
	setTimeoutImpl?: typeof setTimeout;
	clearTimeoutImpl?: typeof clearTimeout;
}
