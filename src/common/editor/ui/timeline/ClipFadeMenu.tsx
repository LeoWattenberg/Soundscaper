/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPortal } from 'react-dom';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { clipInteractionCopy } from '../../../i18n/editor-clip-interactions-copy.ts';
import type { FadeShapeMenuPosition } from './FadeShapeMenu.tsx';
import type { ClipFadeEdge } from './clip-fade-geometry.ts';

interface Props {
	readonly position: FadeShapeMenuPosition;
	readonly edge: ClipFadeEdge;
	readonly hasFade: boolean;
	readonly copy: Readonly<Record<string, string>>;
	readonly onEdit: () => void;
	readonly onRemove: () => void;
	readonly onClose: () => void;
}

/** Upstream fade-handle menu: edit the fade or remove it; presets live in Fades. */
export function ClipFadeMenu({ position, edge, hasFade, copy, onEdit, onRemove, onClose }: Props) {
	const labels = clipInteractionCopy(copy);
	const host = position.target.closest('#kw-audio-editor-design-system') ?? position.target.ownerDocument.body;
	return createPortal(<div role="presentation" onPointerDown={event => event.stopPropagation()}
		onClick={event => event.stopPropagation()} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
		<ContextMenu isOpen x={position.x} y={position.y} autoFocus onClose={onClose} className="audio-editor-fade-shape-menu">
			<ContextMenuItem label={edge === 'in' ? labels.editFadeIn : labels.editFadeOut} onClick={() => { onClose(); onEdit(); }} />
			<ContextMenuItem label={edge === 'in' ? labels.removeFadeIn : labels.removeFadeOut} disabled={!hasFade}
				onClick={() => { onClose(); onRemove(); if (position.target.isConnected) position.target.focus({ preventScroll: true }); }} />
		</ContextMenu>
	</div>, host);
}
