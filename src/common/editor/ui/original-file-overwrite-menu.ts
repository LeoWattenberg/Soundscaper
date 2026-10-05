/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveOriginalFileOverwriteCopy } from '../../i18n/editor-original-file-overwrite-copy.ts';

export interface OriginalFileOverwriteMenuPort {
	readonly originalFile: () => Readonly<{ name: string }> | null;
	readonly available?: () => boolean;
	readonly overwrite: () => unknown;
}

export interface OriginalFileOverwriteMenuContext {
	readonly copy: Readonly<Record<string, unknown>>;
	readonly blocked: boolean;
	readonly recording: boolean;
	readonly importing: boolean;
	readonly materialAvailable: boolean;
}

/** The desktop retains authority to replace one original; browsers offer ordinary export. */
export function createOriginalFileOverwriteMenuItems(
	port: OriginalFileOverwriteMenuPort | null,
	context: OriginalFileOverwriteMenuContext,
) {
	if (!port) return [];
	const copy = resolveOriginalFileOverwriteCopy(context.copy);
	const original = port.originalFile();
	const resolve = () => ({ disabled: context.blocked || context.recording || context.importing
		|| !context.materialAvailable || original === null || port.originalFile() !== original
		|| port.available?.() === false });
	return [{
		id: 'overwrite-original-file',
		label: original ? copy.overwriteNamedOriginal.replace('{filename}', () => original.name) : copy.overwriteOriginal,
		preserveLabel: true,
		...resolve(),
		resolve,
		onClick: () => {
			if (resolve().disabled) return;
			return port.overwrite();
		},
	}];
}
