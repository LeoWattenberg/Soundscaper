/* SPDX-License-Identifier: AGPL-3.0-only */

/** History describes the completed macro; this record is never executed as an edit. */
export interface MacroTransactionMetadata extends Readonly<Record<string, unknown>> {
	readonly type: 'macro/run';
	readonly name?: string;
	readonly stepCount?: number;
}
