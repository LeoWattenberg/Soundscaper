/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useState } from 'react';

import WorkspacePanelContent from './WorkspacePanelContent.jsx';
import WorkspacePanelHeader from './WorkspacePanelHeader.jsx';
import {
	ANALYZER_PANEL_ID_SET,
	FLOATING_PANEL_MIN_HEIGHT,
	FLOATING_PANEL_MIN_WIDTH,
	clampFloatingPanelGeometry,
	workspacePanelLabel,
} from './workspace-panel-model.ts';
import {
	resolveWorkspacePanelDropIntent,
	resolveWorkspacePanelDropPreview,
} from './workspace-panel-drop-model.ts';
import { closeWorkspacePanelAndRestoreFocus, focusWorkspacePanelMenuButton } from './workspace-panel-focus.js';

const DOCK_END = Number.MAX_SAFE_INTEGER;

export default function WorkspacePanelGroup({
	group,
	groupIndex,
	groups,
	dock,
	copy,
	contentProps,
	floatingBounds,
	activeFloatingPanelId,
	setActiveFloatingPanelId,
	draggedPanelId,
	onPanelDragStart,
	onPanelDragEnd,
	onPanelMove,
	onPanelActivate,
	onTogglePanel,
	beginFloatingMove,
	adjustFloatingPanelGeometry,
	arrangeTargets,
}) {
	const [dropPreview, setDropPreview] = useState(null);
	const entries = group.entries;
	const activePanelId = group.activePanelId;
	const activePanel = entries.find(([panelId]) => panelId === activePanelId)?.[1] ?? entries[0][1];
	const grouped = entries.length > 1;
	const draggingCurrentSingleton = !grouped && draggedPanelId === activePanelId;
	const geometry = dock === 'floating'
		? clampFloatingPanelGeometry(activePanel, floatingBounds)
		: null;
	const panelStyle = geometry
		? {
			'--workspace-panel-size': `${geometry.width}px`,
			left: `${geometry.x}px`,
			top: `${geometry.y}px`,
			width: `${geometry.width}px`,
			height: `${geometry.height}px`,
			minWidth: `${Math.min(FLOATING_PANEL_MIN_WIDTH, floatingBounds.width || FLOATING_PANEL_MIN_WIDTH)}px`,
			minHeight: `${Math.min(FLOATING_PANEL_MIN_HEIGHT, floatingBounds.height || FLOATING_PANEL_MIN_HEIGHT)}px`,
			maxWidth: floatingBounds.width ? `${Math.max(1, floatingBounds.width - geometry.x)}px` : '100%',
			maxHeight: floatingBounds.height ? `${Math.max(1, floatingBounds.height - geometry.y)}px` : '100%',
		}
		: dock === 'bottom' ? undefined : { '--workspace-panel-size': `${activePanel.size}px` };

	useEffect(() => {
		if (!draggedPanelId) setDropPreview(null);
	}, [draggedPanelId]);

	const dragHandle = (panelId, panel) => ({
		onDragStart: (event) => {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', panelId);
			onPanelDragStart(panelId);
		},
		onDragEnd: onPanelDragEnd,
		onKeyDown: (event) => {
			if (adjustFloatingPanelGeometry(event, panelId, panel, 'move')) return;
			if (grouped) return;
			const backwards = dock === 'bottom' ? event.key === 'ArrowLeft' : event.key === 'ArrowUp';
			const forwards = dock === 'bottom' ? event.key === 'ArrowRight' : event.key === 'ArrowDown';
			if (!backwards && !forwards) return;
			const targetGroup = groups[groupIndex + (forwards ? 1 : -1)];
			if (!targetGroup) return;
			event.preventDefault();
			onPanelMove(panelId, {
				kind: forwards ? 'after' : 'before',
				targetPanelId: targetGroup.entries[0][0],
			});
		},
	});
	const tabs = grouped ? entries.map(([panelId, panel]) => ({
		id: panelId,
		label: workspacePanelLabel(copy, panelId),
		dragHandle: dragHandle(panelId, panel),
	})) : [];
	const targetPanelId = entries.find(([panelId]) => panelId !== draggedPanelId)?.[0] ?? activePanelId;
	const resolveDrop = (event) => {
		if (!draggedPanelId || dock === 'floating') return null;
		if (!grouped && draggedPanelId === activePanelId) return null;
		const bounds = event.currentTarget.getBoundingClientRect();
		const intent = resolveWorkspacePanelDropIntent(
			dock,
			{ x: event.clientX, y: event.clientY },
			bounds,
		);
		if (!intent) return null;
		const preview = resolveWorkspacePanelDropPreview(dock, intent, bounds);
		return preview ? {
			intent,
			style: {
				left: `${preview.left - bounds.left}px`,
				top: `${preview.top - bounds.top}px`,
				width: `${preview.width}px`,
				height: `${preview.height}px`,
			},
		} : null;
	};

	return <section
		className={`kw-audio-editor__workspace-panel${entries.some(([panelId]) => draggedPanelId === panelId) ? ' kw-audio-editor__workspace-panel--dragging' : ''}${activeFloatingPanelId === activePanelId ? ' kw-audio-editor__workspace-panel--active' : ''}`}
		data-workspace-panel={activePanelId}
		data-workspace-panel-group={group.id}
		data-workspace-panel-members={entries.map(([panelId]) => panelId).join(' ')}
		data-workspace-panel-size={activePanel.size}
		data-workspace-panel-x={geometry?.x}
		data-workspace-panel-y={geometry?.y}
		data-workspace-panel-width={geometry?.width}
		data-workspace-panel-height={geometry?.height}
		data-workspace-drop-intent={dropPreview?.intent}
		style={panelStyle}
		onPointerDownCapture={() => {
			if (dock === 'floating') setActiveFloatingPanelId(activePanelId);
		}}
		onFocusCapture={() => {
			if (dock === 'floating') setActiveFloatingPanelId(activePanelId);
		}}
		onDragLeave={(event) => {
			if (event.currentTarget.contains(event.relatedTarget)) return;
			setDropPreview(null);
		}}
		onDragOver={(event) => {
			if (draggingCurrentSingleton) {
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer.dropEffect = 'none';
				return;
			}
			const nextPreview = resolveDrop(event);
			if (!nextPreview) return;
			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = 'move';
			setDropPreview(nextPreview);
		}}
		onDrop={(event) => {
			if (draggingCurrentSingleton) {
				event.preventDefault();
				event.stopPropagation();
				setDropPreview(null);
				return;
			}
			const nextDrop = resolveDrop(event);
			if (!nextDrop) return;
			event.preventDefault();
			event.stopPropagation();
			setDropPreview(null);
			if (nextDrop.intent === 'tab' && entries.some(([panelId]) => panelId === draggedPanelId)) return;
			onPanelMove(draggedPanelId, { kind: nextDrop.intent, targetPanelId });
		}}
	>
		<WorkspacePanelHeader
			panelId={activePanelId}
			activePanelId={activePanelId}
			label={workspacePanelLabel(copy, activePanelId)}
			copy={copy}
			currentDock={dock}
			tabs={tabs}
			arrangeTargets={arrangeTargets}
			floatingMoveHandle={dock === 'floating'}
			onPointerDown={(event) => beginFloatingMove(event, activePanelId)}
			dragHandle={grouped ? null : dragHandle(activePanelId, activePanel)}
			resizeHandle={dock === 'floating' && !ANALYZER_PANEL_ID_SET.has(activePanelId)
				? { onKeyDown: (event) => adjustFloatingPanelGeometry(event, activePanelId, activePanel, 'resize') }
				: null}
			onTabActivate={onPanelActivate}
			onArrange={(targetId, kind, ownerDocument, menuButton) => {
				onPanelMove(activePanelId, { kind, targetPanelId: targetId });
				focusWorkspacePanelMenuButton(ownerDocument, activePanelId, menuButton);
			}}
			onDock={(nextDock, ownerDocument, menuButton) => {
				onPanelMove(activePanelId, { kind: 'dock', dock: nextDock, groupIndex: DOCK_END });
				focusWorkspacePanelMenuButton(ownerDocument, activePanelId, menuButton);
			}}
			onClose={(ownerDocument) => closeWorkspacePanelAndRestoreFocus(
				ownerDocument,
				activePanelId,
				onTogglePanel,
			)}
		/>
		{entries.map(([panelId]) => {
			const active = panelId === activePanelId;
			return <div
				key={panelId}
				id={grouped ? `workspace-panel-content-${panelId}` : undefined}
				className="kw-audio-editor__workspace-panel-content"
				data-workspace-tab-panel={panelId}
				role={grouped ? 'tabpanel' : undefined}
				aria-labelledby={grouped ? `workspace-panel-tab-${panelId}` : undefined}
				hidden={grouped && !active}
				tabIndex={active && panelId === 'source-monitor' ? 0 : undefined}
			>
				<WorkspacePanelContent
					{...contentProps}
					panelId={panelId}
					panelActive={active}
					dock={dock}
				/>
			</div>;
		})}
		{dropPreview && <div
			className="kw-audio-editor__workspace-panel-drop-preview"
			aria-hidden="true"
			style={dropPreview.style}
		/>}
	</section>;
}
