/* SPDX-License-Identifier: AGPL-3.0-only */

export type FramescaperDesktopProjectLibraryOperation =
	| 'publication'
	| 'delete'
	| 'duplicate';

/** Main committed the operation, but the renderer could not reconcile its shadow. */
export class FramescaperDesktopProjectLibraryCommittedError extends Error {
	constructor(
		readonly operation: FramescaperDesktopProjectLibraryOperation,
		readonly projectId: string,
		cause: unknown,
	) {
		super(`Framescaper desktop ${operation} committed and requires reconciliation.`, { cause });
		this.name = 'FramescaperDesktopProjectLibraryCommittedError';
	}
}

/** Main may have committed the operation; an authoritative reread is required. */
export class FramescaperDesktopProjectLibraryIndeterminateError extends Error {
	constructor(
		readonly operation: FramescaperDesktopProjectLibraryOperation,
		readonly projectId: string,
		cause: unknown,
	) {
		super(`Framescaper desktop ${operation} outcome is indeterminate.`, { cause });
		this.name = 'FramescaperDesktopProjectLibraryIndeterminateError';
	}
}
