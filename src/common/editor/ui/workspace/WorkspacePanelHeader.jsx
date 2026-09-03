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
	activePanelId = panelId,
	arrangeTargets = [],
	onDock,
	onArrange,
	onClose,
	onTabActivate,
	tabs = [],
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
	const grouped = tabs.length > 1;
	const activeTab = grouped
		? tabs.find((tab) => tab.id === activePanelId) ?? tabs[0]
		: null;
	const menuPanelId = activeTab?.id ?? panelId;
	const menuLabel = activeTab?.label ?? label;
	const activateRelativeTab = (event, tabIndex) => {
		const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
		if (!keys.includes(event.key)) return;
		event.preventDefault();
		let nextIndex;
		if (event.key === 'Home') nextIndex = 0;
		else if (event.key === 'End') nextIndex = tabs.length - 1;
		else if (event.key === 'ArrowLeft') nextIndex = (tabIndex - 1 + tabs.length) % tabs.length;
		else nextIndex = (tabIndex + 1) % tabs.length;
		const next = tabs[nextIndex];
		if (!next) return;
		event.currentTarget.closest('[role="tablist"]')
			?.querySelector(`[data-workspace-panel-tab="${next.id}"]`)?.focus();
		onTabActivate?.(next.id);
	};
	return (
		<>
			<header
				className="kw-audio-editor__workspace-panel-header"
				data-floating-panel-move-handle={floatingMoveHandle ? menuPanelId : undefined}
				onPointerDown={onPointerDown}
				onContextMenu={(event) => {
					event.preventDefault();
					// A keyboard request (Shift+F10, the Menu key) carries no useful
					// pointer position, so it anchors to the button like a click does.
					if (event.button !== 2) openAtButton(true);
					else openMenu({ x: event.clientX, y: event.clientY, keyboard: false });
				}}
			>
				{grouped ? <div
					className="kw-audio-editor__workspace-panel-tabs"
					role="tablist"
					aria-label={copy.panels}
				>
					{tabs.map((tab, tabIndex) => <button
						key={tab.id}
						type="button"
						className={`kw-audio-editor__workspace-panel-tab${tab.id === activeTab?.id ? ' kw-audio-editor__workspace-panel-tab--active' : ''}`}
						role="tab"
						id={`workspace-panel-tab-${tab.id}`}
						data-workspace-panel-tab={tab.id}
						data-workspace-panel-drag-handle={tab.dragHandle ? tab.id : undefined}
						draggable={Boolean(tab.dragHandle)}
						aria-label={tab.label}
						aria-controls={`workspace-panel-content-${tab.id}`}
						aria-selected={tab.id === activeTab?.id}
						tabIndex={tab.id === activeTab?.id ? 0 : -1}
						onClick={() => onTabActivate?.(tab.id)}
						onDragStart={tab.dragHandle?.onDragStart}
						onDragEnd={tab.dragHandle?.onDragEnd}
						onKeyDown={(event) => activateRelativeTab(event, tabIndex)}
					>
						<span className="kw-audio-editor__workspace-panel-tab-grip" aria-hidden="true">⠿</span>
						<span>{tab.label}</span>
					</button>)}
				</div> : <>{dragHandle && <button
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
				<h2>{label}</h2></>}
				{resizeHandle && <button
					type="button"
					className="kw-audio-editor__workspace-resize-handle"
					data-floating-panel-resize-handle={panelId}
					aria-label={formatResizeLabel(copy, label)}
					onClick={(event) => event.currentTarget.focus()}
					onKeyDown={resizeHandle.onKeyDown}
				>↘</button>}
				<span data-workspace-panel-menu={menuPanelId}>
					<button
						ref={menuButtonRef}
						type="button"
						className="kw-audio-editor__workspace-panel-menu-button"
						aria-label={`${copy.panelMenu}: ${menuLabel}`}
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
						disabled={dockId === currentDock && !grouped}
						onClick={() => onDock(dockId, ownerDocument(), menuButtonRef.current)}
						onClose={closeMenu}
					/>
				))}
				{onArrange && arrangeTargets.length > 0 && <ContextMenuItem
					label={copy.arrangePanel}
					hasSubmenu
					onClose={closeMenu}
				>
					{arrangeTargets.map((target) => <ContextMenuItem
						key={target.panelId}
						label={`${target.label} — ${workspaceDockLabel(copy, target.dock)}`}
						hasSubmenu
						onClose={closeMenu}
					>
						{[
							['before', copy.arrangeBefore],
							['tab', copy.arrangeTab],
							['after', copy.arrangeAfter],
						].map(([kind, placementLabel]) => <ContextMenuItem
							key={kind}
							label={placementLabel}
							disabled={kind === 'tab' ? target.tabDisabled : target.splitDisabled}
							onClick={() => onArrange(target.panelId, kind, ownerDocument(), menuButtonRef.current)}
							onClose={closeMenu}
						/>)}
					</ContextMenuItem>)}
				</ContextMenuItem>}
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
