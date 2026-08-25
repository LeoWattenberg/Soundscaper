/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded, process-local audit journal for pathless desktop codec receipts. */

const DEFAULT_MAXIMUM_ENTRIES = 128;
const MAXIMUM_ENTRIES = 1_024;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

export function createDesktopAudioCodecReceiptJournal(options = {}) {
	if (!options || typeof options !== 'object' || Array.isArray(options)
		|| Reflect.ownKeys(options).some((key) => key !== 'maximumEntries')
		|| options.maximumEntries !== undefined
			&& (!Number.isSafeInteger(options.maximumEntries)
				|| options.maximumEntries < 1 || options.maximumEntries > MAXIMUM_ENTRIES)) {
		throw new TypeError('Desktop audio codec receipt journal options are invalid.');
	}
	const maximumEntries = options.maximumEntries ?? DEFAULT_MAXIMUM_ENTRIES;
	const entries = [];

	return Object.freeze({
		record(value) {
			const observation = receiptObservation(value);
			entries.push(observation);
			if (entries.length > maximumEntries) entries.splice(0, entries.length - maximumEntries);
		},
		snapshot() { return Object.freeze([...entries]); },
		clear() { entries.length = 0; },
	});
}

function receiptObservation(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Reflect.ownKeys(value).length !== 2
		|| !Object.hasOwn(value, 'requestId') || !Object.hasOwn(value, 'receipt')
		|| value.requestId !== null
			&& (typeof value.requestId !== 'string' || !REQUEST_ID.test(value.requestId))
		|| !value.receipt || typeof value.receipt !== 'object' || Array.isArray(value.receipt)) {
		throw new TypeError('Desktop audio codec receipt observation is invalid.');
	}
	return Object.freeze({ requestId: value.requestId, receipt: value.receipt });
}
