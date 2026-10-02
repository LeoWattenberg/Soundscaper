/* SPDX-License-Identifier: AGPL-3.0-only */

import { FileSizeWarningRequiredError, type FileSizeWarning, type FileSizeWarningConfirmation, type FileSizeWarningOptions, type FileSizeWarningRequestOptions } from
	'../common/editor/controller/shared/file-size-warning.ts';
import { SCAPE_ARCHIVE_LIMITS } from '../common/editor/scape-archive-envelope.ts';

/** Retain media-size consent only for one renderer owner and project. */
export class SoundscaperDesktopFreezeSizeAdmission {
	readonly #accepted = new Map<string, number>();
	#confirmation?: FileSizeWarningConfirmation;
	#generation = 0;

	setConfirmation(confirmation?: FileSizeWarningConfirmation): void {
		if (confirmation !== undefined && typeof confirmation !== 'function') {
			throw new TypeError('Soundscaper desktop media confirmation must be a function.');
		}
		if (this.#confirmation !== confirmation) {
			this.#confirmation = confirmation;
			this.#accepted.clear();
			this.#generation += 1;
		}
	}

	forget(projectId: string): void { this.#accepted.delete(projectId); }

	options(projectId: string, options: FileSizeWarningOptions = {}, usePresentation = false): FileSizeWarningOptions {
		const threshold = SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes;
		const captured = Object.freeze({ ...options });
		const generation = this.#generation;
		const confirm = captured.confirmFileSizeWarning ?? (usePresentation ? this.#confirmation : undefined);
		let admitted = captured.confirmFileSizeWarning ? threshold : this.#accepted.get(projectId) ?? threshold;
		const assertCurrent = (): void => {
			assertSoundscaperDesktopMediaPublicationCurrent(captured);
			if (generation !== this.#generation) throw new Error('The desktop media confirmation owner changed.');
		};
		return Object.freeze({ signal: captured.signal, assertCurrent,
			confirmFileSizeWarning: async (warning: Readonly<FileSizeWarning>, request?: FileSizeWarningRequestOptions) => {
				assertCurrent(); request?.signal?.throwIfAborted();
				if (warning.label !== 'Desktop project media' || warning.thresholdBytes !== threshold
					|| !Number.isSafeInteger(warning.byteLength) || warning.byteLength < 0) {
					throw new TypeError('The desktop media approval cannot admit a different size policy.');
				}
				if (warning.byteLength <= admitted) return true;
				if (!confirm) throw new FileSizeWarningRequiredError(warning);
				const accepted = await confirm(warning, request);
				assertCurrent(); request?.signal?.throwIfAborted();
				if (accepted === true) {
					admitted = warning.byteLength;
					this.#accepted.set(projectId, Math.max(this.#accepted.get(projectId) ?? threshold, admitted));
				}
				return accepted;
			},
		});
	}
}

export function assertSoundscaperDesktopMediaPublicationCurrent(options: FileSizeWarningOptions): void {
	options.signal?.throwIfAborted();
	options.assertCurrent?.();
}
