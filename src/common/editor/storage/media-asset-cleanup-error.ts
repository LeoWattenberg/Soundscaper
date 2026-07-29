/* SPDX-License-Identifier: AGPL-3.0-only */

/** Identifies a media lifecycle failure that may have left staged storage behind. */
export class MediaAssetCleanupError extends AggregateError {
	constructor(errors: Iterable<unknown>, message: string) {
		super(errors, message);
		this.name = 'MediaAssetCleanupError';
	}
}
