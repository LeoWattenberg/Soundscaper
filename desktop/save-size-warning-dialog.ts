/* SPDX-License-Identifier: AGPL-3.0-only */

export interface DesktopSaveSizeWarning {
	readonly fileName: string;
	readonly byteLength: number;
	readonly thresholdBytes: number;
}

export interface DesktopSaveSizeWarningMessageBoxOptions {
	type: 'warning';
	title: string;
	message: string;
	detail: string;
	buttons: string[];
	defaultId: number;
	cancelId: number;
	noLink: boolean;
}

/** Only the main process creates this port; a renderer cannot grant itself a larger save. */
export function createDesktopSaveSizeWarningConfirmation(
	showMessageBox: (options: DesktopSaveSizeWarningMessageBoxOptions) => Promise<Readonly<{ response: number }>>,
	operation: 'saving' | 'linking' | 'loading' = 'saving',
): (warning: Readonly<DesktopSaveSizeWarning>) => Promise<boolean> {
	return async (warning) => {
		const result = await showMessageBox({
			type: 'warning', title: 'Large file',
			message: `Continue ${operation} “${warning.fileName}”?`,
			detail: `This file is ${warning.byteLength.toLocaleString()} bytes, above the ${warning.thresholdBytes.toLocaleString()}-byte size warning threshold. ${operation === 'saving' ? 'Saving it may take a long time and use substantial disk space.' : 'Processing it may take a long time and use substantial memory.'}`,
			buttons: ['Cancel', 'Continue'], defaultId: 0, cancelId: 0, noLink: true,
		});
		return result.response === 1;
	};
}

/** Native approval precedes publication of an owner-scoped large-file capability. */
export async function confirmDesktopFileSizeWarning(
	warning: Readonly<DesktopSaveSizeWarning>,
	confirm: ((warning: Readonly<DesktopSaveSizeWarning>) => Promise<boolean>) | undefined,
	assertCurrent: () => void,
): Promise<void> {
	assertCurrent();
	if (warning.byteLength <= warning.thresholdBytes) return;
	if (!confirm) throw Object.assign(new RangeError('File bytes exceed the size warning threshold; confirmation is required.'), { code: 'FILE_SIZE_WARNING' });
	const accepted = await confirm(warning);
	assertCurrent();
	if (accepted !== true) throw Object.assign(new Error('Large-file access was cancelled.'), { name: 'AbortError', code: 'ABORTED' });
}
