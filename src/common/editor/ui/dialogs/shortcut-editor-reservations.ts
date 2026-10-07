/* SPDX-License-Identifier: AGPL-3.0-only */

import { audioEditorShortcutParts } from '../../audio-editor-shortcut-normalization.ts';
import { videoNavigationShortcut } from '../workspace-shortcuts.ts';

/** Fixed Framescaper navigation owns these keys before the configurable map. */
export function isReservedVideoNavigationShortcut(productId: string, binding: string): boolean {
	if (productId !== 'framescaper') return false;
	const { key, modifiers } = audioEditorShortcutParts(binding);
	return videoNavigationShortcut({
		key: key === 'Up' ? 'ArrowUp' : key === 'Down' ? 'ArrowDown' : key,
		altKey: modifiers.includes('Alt'),
		ctrlKey: modifiers.includes('Ctrl'),
		metaKey: modifiers.includes('Meta'),
		shiftKey: modifiers.includes('Shift'),
		repeat: false,
	}) !== null;
}
