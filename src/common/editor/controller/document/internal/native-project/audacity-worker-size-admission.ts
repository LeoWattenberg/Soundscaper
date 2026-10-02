/* SPDX-License-Identifier: AGPL-3.0-only */

import { confirmFileSizeWarning, type FileSizeWarningOptions } from '../../../shared/file-size-warning.ts';
import type { Aup4PortableOptions } from '../../native-project-types.ts';

/** Retry only worker size preflights and the read-only database export. */
export async function withAudacityWorkerSizeAdmission<Value>(
	operation: (options: Aup4PortableOptions) => Promise<Value>,
	initialOptions: Aup4PortableOptions,
	label: string,
	warningOptions: FileSizeWarningOptions,
	phase: 'preflight' | 'export',
): Promise<Value> {
	let options = initialOptions;
	for (;;) {
		try { return await operation(options); }
		catch (error) {
			if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'PROJECT_TOO_LARGE'
				|| !('details' in error) || !error.details || typeof error.details !== 'object') throw error;
			const details = error.details;
			if (phase === 'preflight' && (!('phase' in details) || details.phase !== 'preflight')) throw error;
			if (!('size' in details) || !('limit' in details) || typeof details.size !== 'number'
				|| typeof details.limit !== 'number' || !Number.isSafeInteger(details.size) || details.size < 1
				|| !Number.isSafeInteger(details.limit) || details.limit < 0
				|| (options.fileSizeWarningApproved && details.size <= (options.maxBytes ?? 0))) throw error;
			if (options.quota !== undefined && options.usage !== undefined
				&& details.size > options.quota - options.usage) throw error;
			const maxBytes = await confirmFileSizeWarning(details.size, Math.max(1, details.limit), label, warningOptions);
			options = { ...options, maxBytes, fileSizeWarningApproved: true };
		}
	}
}
