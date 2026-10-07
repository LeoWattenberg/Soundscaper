/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep CLI diagnostics consistent for both Errors and arbitrary thrown values. */
export function diagnosticErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
