/* SPDX-License-Identifier: AGPL-3.0-only */

import { FileSizeWarningRequiredError, type FileSizeWarning, type FileSizeWarningRequestOptions, type FileSizeWarningOptions } from
	'../common/editor/controller/shared/file-size-warning.ts';
import { SCAPE_ARCHIVE_LIMITS } from '../common/editor/scape-archive-envelope.ts';

const APPROVED_BOUNDS = new WeakMap<object, Map<string, number>>();

/** Reuse a manual inventory decision only within its renderer owner and project. */
export function framescaperDesktopMediaPublicationWarningOptions(
	owner: object,
	projectId: string,
	options: FileSizeWarningOptions,
	currentProjectExists: boolean,
): FileSizeWarningOptions {
	const threshold = SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes;
	let approved = APPROVED_BOUNDS.get(owner);
	if (!approved) { approved = new Map(); APPROVED_BOUNDS.set(owner, approved); }
	if (!currentProjectExists) approved.delete(projectId);
	const confirm = options.confirmFileSizeWarning;
	let operationBound = confirm ? threshold : approved.get(projectId) ?? threshold;
	return Object.freeze({
		signal: options.signal,
		assertCurrent: options.assertCurrent,
		confirmFileSizeWarning: async (warning: Readonly<FileSizeWarning>, request?: FileSizeWarningRequestOptions) => {
			assertFramescaperDesktopMediaPublicationCurrent(options);
			if (warning.label !== 'Desktop project media' || warning.thresholdBytes !== threshold) {
				throw new TypeError('The desktop media approval cannot admit a different size policy.');
			}
			if (warning.byteLength <= operationBound) return true;
			if (!confirm) throw new FileSizeWarningRequiredError(warning);
			const accepted = await confirm(warning, request);
			assertFramescaperDesktopMediaPublicationCurrent(options);
			if (accepted === true) {
				operationBound = warning.byteLength;
				approved.set(projectId, Math.max(approved.get(projectId) ?? threshold, operationBound));
			}
			return accepted;
		},
	});
}

export function assertFramescaperDesktopMediaPublicationCurrent(options: FileSizeWarningOptions): void {
	options.signal?.throwIfAborted();
	options.assertCurrent?.();
}
