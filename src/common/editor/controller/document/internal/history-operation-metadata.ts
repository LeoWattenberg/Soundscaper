/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MacroTransactionMetadata } from '../../effects/macro-transaction-metadata.ts';

/** Completed operations describe history; they are never replayed as commands. */
export type HistoryOperationMetadata = MacroTransactionMetadata | Readonly<{
	readonly type: 'nyquist/run';
	readonly name: string;
}>;
