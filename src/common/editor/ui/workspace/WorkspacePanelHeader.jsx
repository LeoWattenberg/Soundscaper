/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef, useState } from 'react';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { Icon } from '@soundscaper/design-system/Icon';

import { formatResizeLabel } from '../localization-template.ts';
import { WORKSPACE_DOCK_IDS, workspaceDockLabel } from './workspace-panel-model.ts';

/**
 * The title bar every workspace panel shares: the ⠿ reorder handle, the
 * title, the floating ↘ resize handle and a "…" overflow menu that moves the
 * panel between docks or closes it. The menu is rendered as a sibling of the
 * header rather than inside it so a click on one of its items can never be
 * mistaken for the start of a floating-panel drag.
 *
 * A pointer-opened menu leaves focus on its button; a keyboard-opened one
 * (`click.detail === 0`, or a keyboard context-menu request) focuses its first
 * item. Escape inside the menu returns focus to the button either way.
 */
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
	const closeMenu = () => setMenu(null);
	const openMenu = ({ x, y, keyboard }) => {
		menuButtonRef.current?.focus();
		setMenu({ x, y, keyboard });
	};
	const ownerDocument = () => menuButtonRef.current?.ownerDocument ?? document;
	return (
		<>
			<header
				className="kw-audio-editor__workspace-panel-header"
				data-floating-panel-move-handle={floatingMoveHandle ? panelId : undefined}
				onPointerDown={onPointerDown}
				onContextMenu={(event) => {
					event.preventDefault();
					openMenu({ x: event.clientX, y: event.clientY, keyboard: event.button !== 2 });
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
							const bounds = event.currentTarget.getBoundingClientRect();
							openMenu({ x: bounds.left, y: bounds.bottom + 4, keyboard: event.detail === 0 });
						}}
					>
						<Icon name="menu" size={16} />
					</button>
				</span>
			</header>
			<ContextMenu
				isOpen={Boolean(menu)}
				x={menu?.x || 0}
				y={menu?.y || 0}
				autoFocus={Boolean(menu?.keyboard)}
				onClose={closeMenu}
				className="kw-audio-editor__workspace-panel-menu"
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
			</ContextMenu>
		</>
	);
}
