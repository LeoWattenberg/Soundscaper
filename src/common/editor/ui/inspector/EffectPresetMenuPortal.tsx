/* SPDX-License-Identifier: AGPL-3.0-only */

import { type CSSProperties, type ReactNode, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '@soundscaper/design-system/ThemeProvider';

import { useEditorSkin } from '../skins/EditorSkinProvider.tsx';

/** Preset menus use viewport coordinates and must escape draggable dialog transforms. */
export default function EffectPresetMenuPortal({ target, children }: {
	readonly target: HTMLElement | null;
	readonly children: ReactNode;
}) {
	const { theme } = useTheme();
	const { decoration } = useEditorSkin();
	const [direction, setDirection] = useState(() => directionFor(target));
	// The editor's direction can change in the same commit as the preview copy.
	useLayoutEffect(() => {
		setDirection(directionFor(target));
	}, [target, children]);
	if (!target) return null;
	const style = {
		display: 'contents',
		fontFamily: decoration === 'default' ? 'Inter, sans-serif' : 'var(--editor-skin-font)',
		'--accent': theme.accent.primary,
		'--focus-color': theme.border.focus,
	} as CSSProperties;
	return createPortal(<div className="audio-editor-effect-preset-menu-layer" dir={direction}
		data-editor-skin={decoration} style={style}>{children}</div>, target.ownerDocument.body);
}

function directionFor(target: HTMLElement | null): string {
	return target?.closest('[dir]')?.getAttribute('dir')
		|| target?.ownerDocument.documentElement.getAttribute('dir') || 'ltr';
}
