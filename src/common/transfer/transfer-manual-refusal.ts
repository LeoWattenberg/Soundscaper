/* SPDX-License-Identifier: AGPL-3.0-only */

/** A lightweight refusal raised while a manual file iterable is being read. */
export class TransferManualImportRefusalError extends Error {
	readonly code: 'entry-limit' | 'entry-too-large' | 'invalid-bound' | 'malformed-entry';

	constructor(
		code: TransferManualImportRefusalError['code'],
		message: string,
	) {
		super(message);
		this.name = 'TransferManualImportRefusalError';
		this.code = code;
	}
}
