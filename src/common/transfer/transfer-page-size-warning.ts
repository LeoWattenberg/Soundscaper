/* SPDX-License-Identifier: AGPL-3.0-only */

import { createFileSizeWarningConfirmation } from '../editor/controller/shared/file-size-warning-confirmation.ts';
import type { FileSizeWarningConfirmation } from '../editor/controller/shared/file-size-warning.ts';
import type { TransferView } from './transfer-page-view.ts';

/** Reuse the transfer page's opt-in confirmation area for size decisions. */
export function createTransferPageSizeWarning(view: TransferView): Readonly<{
	confirm: FileSizeWarningConfirmation;
	dispose: () => void;
}> {
	const decisions = createFileSizeWarningConfirmation();
	const unsubscribe = decisions.subscribe(() => {
		const prompt = decisions.getSnapshot();
		view.confirm(prompt ? {
			heading: 'Large file warning',
			lines: [
				`${prompt.label}: ${formatBytes(prompt.byteLength)}.`,
				`The size warning threshold is ${formatBytes(prompt.thresholdBytes)}. Continuing may use substantial memory, storage, and time.`,
			],
			confirmLabel: 'Continue',
			cancelLabel: 'Cancel',
			confirm: async () => { decisions.settle(prompt, true); },
			cancel: () => { decisions.settle(prompt, false); },
		} : null);
	});
	return Object.freeze({
		confirm: decisions.confirm,
		dispose: () => { unsubscribe(); decisions.dispose(); view.confirm(null); },
	});
}

function formatBytes(bytes: number): string {
	const units = ['bytes', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
	return `${Number(value.toFixed(1))} ${units[unit]}`;
}
