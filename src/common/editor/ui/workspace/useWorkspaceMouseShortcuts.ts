/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo } from 'react';
import type { MouseEvent, PointerEvent } from 'react';

import { createMouseShortcutGesture } from '../../controller/preferences/mouse-shortcut-gesture.ts';
import { mouseShortcutKey } from '../../mouse-shortcut.ts';
import { blockWorkspaceMouseShortcutPointer, handleWorkspaceMouseDown } from '../workspace-mouse-shortcuts.ts';

export function useWorkspaceMouseShortcuts(
	snapshot: Parameters<typeof handleWorkspaceMouseDown>[1],
	run: Parameters<typeof handleWorkspaceMouseDown>[2],
	registry: NonNullable<Parameters<typeof handleWorkspaceMouseDown>[3]>,
) {
	const gesture = useMemo(() => createMouseShortcutGesture(), []);
	useEffect(() => () => gesture.dispose(), [gesture]);
	return {
		onPointerDownCapture: (event: PointerEvent<HTMLElement>) => blockWorkspaceMouseShortcutPointer(event, snapshot, registry),
		onMouseDownCapture: (event: MouseEvent<HTMLElement>) => {
			gesture.forget(event.button);
			const target = event.target;
			if (!event.defaultPrevented && mouseShortcutKey(event.button)
				&& target instanceof Element && target.tagName === 'INPUT'
				&& target.hasAttribute('data-shortcut-binding') && !target.hasAttribute('disabled')) {
				// Let the field assign its binding, then cancel release anywhere in the editor.
				gesture.claim(event.button);
				return;
			}
			handleWorkspaceMouseDown(event, snapshot, run, registry, (button) => gesture.claim(button));
		},
		onMouseUpCapture: (event: MouseEvent<HTMLElement>) => { gesture.release(event); },
		onAuxClickCapture: (event: MouseEvent<HTMLElement>) => { gesture.auxiliaryClick(event); },
	};
}
