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

export function saveBinaryBuffer(value) {
	if (value instanceof ArrayBuffer) return Buffer.from(value);
	if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
	throw new TypeError('Save chunks must be binary data');
}

export function isMissingSavePathError(error) {
	return error && typeof error === 'object' && error.code === 'ENOENT';
}

export function requireSaveOwner(owner) {
	if ((typeof owner !== 'object' || owner === null) && typeof owner !== 'function') {
		throw new TypeError('A renderer save owner object reference is required');
	}
}

export function boundedSaveCapacity(value, maximum, label) {
	if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
		throw new RangeError(`${label} must be a non-negative integer no greater than the hard limit of ${maximum}`);
	}
	return value;
}

export function availableSaveStorageBytes(details) {
	if (!details || typeof details !== 'object'
		|| typeof details.bavail !== 'bigint' || details.bavail < 0n
		|| typeof details.bsize !== 'bigint' || details.bsize <= 0n) {
		throw new TypeError('Expected non-negative bigint bavail and positive bigint bsize values');
	}
	return details.bavail * details.bsize;
}
