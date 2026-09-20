/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPortal } from 'react-dom';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';

import {
	createLabeledAudioApplicationMenuItems,
	type LabeledAudioApplicationMenuCopy,
} from '../labeled-audio-application-menu.ts';

interface LabelContextMenuProps {
	readonly position: Readonly<{ x: number; y: number; target: Element }> | null;
	readonly copy: LabeledAudioApplicationMenuCopy & Readonly<{ editLabels: string; deleteLabel: string }>;
	readonly blocked: boolean;
	readonly audioBlocked: boolean;
	readonly point: boolean;
	readonly audioEditing: boolean;
	readonly run: (operation: () => unknown) => unknown;
	readonly editActions: Readonly<Record<string, (() => unknown) | undefined>>;
	readonly onEdit: () => void;
	readonly onRemove: () => void;
	readonly onClose: () => void;
}

/** Label operations and the existing labeled-audio variants, reached from the label menu. */
export function LabelContextMenu(props: LabelContextMenuProps) {
	const { position, copy, blocked, audioBlocked, point, audioEditing, editActions, run, onEdit, onRemove, onClose } = props;
	if (!position) return null;
	const [audioMenu] = createLabeledAudioApplicationMenuItems({
		productId: audioEditing ? 'soundscaper' : 'framescaper', copy,
		editBlocked: audioBlocked, available: !point,
	}, { executeEdit: (action) => run(() => editActions[action]?.()) });
	const menu = <div role="presentation" onClick={(event) => event.stopPropagation()}
		onKeyDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
		<ContextMenu isOpen x={position.x} y={position.y} onClose={onClose} className="audio-editor-label-context-menu">
			<ContextMenuItem label={copy.editLabels} shortcut="F2" disabled={blocked} onClick={onEdit} onClose={onClose} />
			<ContextMenuItem label={copy.deleteLabel} disabled={blocked} onClick={onRemove} onClose={onClose} />
			{audioMenu && <ContextMenuItem isDivider />}
			{audioMenu && <ContextMenuItem label={audioMenu.label} hasSubmenu disabled={audioBlocked || point} onClose={onClose}>
				{audioMenu.items.map((item) => <ContextMenuItem key={item.id} label={item.label}
					disabled={item.disabled} onClick={item.onClick} onClose={onClose} />)}
			</ContextMenuItem>}
		</ContextMenu>
	</div>;
	const portalTarget = position.target.closest('#kw-audio-editor-design-system');
	return portalTarget ? createPortal(menu, portalTarget) : menu;
}
