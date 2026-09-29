/* SPDX-License-Identifier: AGPL-3.0-only */

import { isWebFileLimitFailure, WebFileLoadLimitError } from '../../../web-file-limit-failure.ts';

/** Keep per-file import recovery, but expose browser capacity failures to the workspace. */
export function createImportFileLimitFailures(signal: AbortSignal) {
	const failures: unknown[] = [];
	return Object.freeze({
		collect(error: unknown): void {
			if (!signal.aborted && isWebFileLimitFailure(error)) failures.push(error);
		},
		throwIfAny(): void {
			if (failures.length) throw new WebFileLoadLimitError(new AggregateError(failures,
				'One or more file imports failed.'));
		},
	});
}
