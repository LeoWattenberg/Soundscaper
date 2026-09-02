/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { Icon } from '@soundscaper/design-system/Icon';

import { EDITOR_OVERLAY_Z_INDEX_TIERS } from '../EditorOverlayHost.tsx';
import { formatResizeLabel } from '../localization-template.ts';
import { useMenuTriggerDismissal } from '../use-menu-trigger-dismissal.ts';
import { WORKSPACE_DOCK_IDS, workspaceDockLabel } from './workspace-panel-model.ts';

/**
 * The title bar every workspace panel shares: the ⠿ reorder handle, the
 * title, the floating ↘ resize handle and a "…" overflow menu that moves the
 * panel between docks or closes it. The menu is portaled to the editor root:
 * the docks are stacking contexts, so a menu rendered inside one would sit
 * under floating effect windows and dialogs, and a click on one of its items
 * could be mistaken for the start of a floating-panel drag. The root is the
 * portal target rather than the body because the design system's stylesheet is
 * scoped to it — a body-level menu paints with no surface and renders its
 * glyphs as tofu.
 *
 * A pointer-opened menu leaves focus on its button; a keyboard-opened one
 * (`click.detail === 0`, or a keyboard context-menu request) focuses its first
 * item. Escape inside the menu returns focus to the button either way.
 */
// The menu must stay above the effect window the user may have opened from the
// very panel it belongs to, and above the effects-open workspace that hosts it.
const PANEL_MENU_STYLE = Object.freeze({ zIndex: EDITOR_OVERLAY_Z_INDEX_TIERS.effects + 1 });

export default function WorkspacePanelHeader({
	panelId,
	label,
	copy,
	currentDock,
	onDock,
	onClose,
	dragHandle,
	resizeHandle,
	floatingMoveHandle = false,
	onPointerDown,
}) {
	const menuButtonRef = useRef(null);
	const [menu, setMenu] = useState(null);
	const consumeTriggerDismissal = useMenuTriggerDismissal(menuButtonRef, Boolean(menu));
	const closeMenu = () => setMenu(null);
	const openMenu = ({ x, y, keyboard }) => {
		menuButtonRef.current?.focus();
		setMenu({ x, y, keyboard });
	};
	const openAtButton = (keyboard) => {
		const bounds = menuButtonRef.current?.getBoundingClientRect();
		if (!bounds) return;
		openMenu({ x: bounds.left, y: bounds.bottom + 4, keyboard });
	};
	const ownerDocument = () => menuButtonRef.current?.ownerDocument ?? document;
	const menuHost = () => menuButtonRef.current?.closest('[data-audio-editor]') ?? ownerDocument().body;
	return (
		<>
			<header
				className="kw-audio-editor__workspace-panel-header"
				data-floating-panel-move-handle={floatingMoveHandle ? panelId : undefined}
				onPointerDown={onPointerDown}
				onContextMenu={(event) => {
					event.preventDefault();
					// A keyboard request (Shift+F10, the Menu key) carries no useful
					// pointer position, so it anchors to the button like a click does.
					if (event.button !== 2) openAtButton(true);
					else openMenu({ x: event.clientX, y: event.clientY, keyboard: false });
				}}
			>
				{dragHandle && <button
					type="button"
					className="kw-audio-editor__workspace-drag-handle"
					data-workspace-panel-drag-handle={panelId}
					draggable
					aria-label={`${copy.workspaceMove}: ${label}`}
					onClick={(event) => event.currentTarget.focus()}
					onDragStart={dragHandle.onDragStart}
					onDragEnd={dragHandle.onDragEnd}
					onKeyDown={dragHandle.onKeyDown}
				>⠿</button>}
				<h2>{label}</h2>
				{resizeHandle && <button
					type="button"
					className="kw-audio-editor__workspace-resize-handle"
					data-floating-panel-resize-handle={panelId}
					aria-label={formatResizeLabel(copy, label)}
					onClick={(event) => event.currentTarget.focus()}
					onKeyDown={resizeHandle.onKeyDown}
				>↘</button>}
				<span data-workspace-panel-menu={panelId}>
					<button
						ref={menuButtonRef}
						type="button"
						className="kw-audio-editor__workspace-panel-menu-button"
						aria-label={`${copy.panelMenu}: ${label}`}
						aria-haspopup="menu"
						aria-expanded={Boolean(menu)}
						onClick={(event) => {
							if (consumeTriggerDismissal()) return;
							if (menu) {
								closeMenu();
								return;
							}
							openAtButton(event.detail === 0);
						}}
					>
						<Icon name="menu" size={16} />
					</button>
				</span>
			</header>
			{menu && createPortal(<ContextMenu
				isOpen
				x={menu.x}
				y={menu.y}
				autoFocus={Boolean(menu.keyboard)}
				onClose={closeMenu}
				className="kw-audio-editor__workspace-panel-menu"
				style={PANEL_MENU_STYLE}
			>
				{onDock && WORKSPACE_DOCK_IDS.map((dockId) => (
					<ContextMenuItem
						key={dockId}
						label={workspaceDockLabel(copy, dockId)}
						checked={dockId === currentDock}
						disabled={dockId === currentDock}
						onClick={() => onDock(dockId, ownerDocument(), menuButtonRef.current)}
						onClose={closeMenu}
					/>
				))}
				{onDock && <ContextMenuItem isDivider />}
				<ContextMenuItem
					label={copy.close}
					onClick={() => onClose(ownerDocument())}
					onClose={closeMenu}
				/>
			</ContextMenu>, menuHost())}
		</>
	);
}
