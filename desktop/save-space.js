/* SPDX-License-Identifier: AGPL-3.0-only */

export const SPACE_EXHAUSTED_MESSAGE = 'The save destination ran out of space; the staged file was discarded';

/** Space exhaustion is terminal for a staged save; other write failures stay retryable. */
export function isSpaceExhaustedError(error) {
	const code = error?.code ?? error?.cause?.code;
	return code === 'ENOSPC' || code === 'EDQUOT';
}

export function commitFailureMessage(error) {
	return isSpaceExhaustedError(error)
		? 'Could not commit the saved file: the destination ran out of space'
		: 'Could not commit the saved file';
}
