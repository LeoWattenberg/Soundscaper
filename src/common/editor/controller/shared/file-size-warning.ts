/* SPDX-License-Identifier: AGPL-3.0-only */

export interface FileSizeWarning {
	readonly label: string;
	readonly byteLength: number;
	readonly thresholdBytes: number;
}

export interface FileSizeWarningRequestOptions {
	readonly signal?: AbortSignal | null;
}

export type FileSizeWarningConfirmation = (
	warning: Readonly<FileSizeWarning>,
	options?: FileSizeWarningRequestOptions,
) => Promise<boolean>;

export interface FileSizeWarningOptions extends FileSizeWarningRequestOptions {
	readonly confirmFileSizeWarning?: FileSizeWarningConfirmation;
	readonly assertCurrent?: () => void;
}

/** A caller without a presentation port can still identify the requested decision. */
export class FileSizeWarningRequiredError extends RangeError {
	readonly code = 'FILE_SIZE_WARNING';
	readonly warning: Readonly<FileSizeWarning>;
	constructor(warning: Readonly<FileSizeWarning>) {
		super(`${warning.label} is ${warning.byteLength} bytes, above the ${warning.thresholdBytes}-byte size warning threshold. User confirmation is required to continue.`);
		this.name = 'FileSizeWarningRequiredError';
		this.warning = warning;
	}
}

/** Ask before crossing a size policy, then return this operation's admitted byte bound. */
export async function confirmFileSizeWarning(
	byteLength: number,
	thresholdBytes: number,
	label: string,
	options: FileSizeWarningOptions = {},
): Promise<number> {
	if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
		throw new RangeError('File byte length must be a non-negative safe integer.');
	}
	if (!Number.isSafeInteger(thresholdBytes) || thresholdBytes < 1) {
		throw new RangeError('File size warning threshold must be a positive safe integer.');
	}
	if (typeof label !== 'string' || !label.trim()) throw new TypeError('File size warning label is required.');
	assertReady(options);
	if (byteLength <= thresholdBytes) return thresholdBytes;
	const warning = Object.freeze({ label, byteLength, thresholdBytes });
	if (!options.confirmFileSizeWarning) throw new FileSizeWarningRequiredError(warning);
	const accepted = await options.confirmFileSizeWarning(warning, { signal: options.signal });
	assertReady(options);
	if (accepted !== true) {
		const error = new Error('The large-file operation was canceled.');
		error.name = 'AbortError';
		throw Object.assign(error, { code: 'ABORTED' });
	}
	return byteLength;
}

function assertReady(options: FileSizeWarningOptions): void {
	options.signal?.throwIfAborted();
	options.assertCurrent?.();
}
