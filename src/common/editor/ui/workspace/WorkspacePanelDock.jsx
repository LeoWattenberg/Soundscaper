import { useEffect, useRef, useState } from 'react';

import { groupWorkspacePanelEntries } from '../../workspace-panel-layout.ts';
import { formatResizeLabel } from '../localization-template.ts';
import { timelineAnnotationsAvailable } from '../timeline/timeline-annotation-ui-model.ts';
import { workspacePanelAvailable } from './workspace-product-panel-runtime.ts';
import { workspaceSideDockAllowsWidePanels, workspaceSideDockColumns } from './workspace-side-dock-width.ts';
import WorkspacePanelGroup from './WorkspacePanelGroup.jsx';
import { useFloatingWorkspacePanelMove } from './useFloatingWorkspacePanelMove.ts';
import { retainWorkspacePanelResizeLifecycle } from './workspace-panel-resize-lifecycle.ts';
import {
	ANALYZER_PANEL_ID_SET,
	FLOATING_PANEL_MIN_HEIGHT,
	WORKSPACE_PANEL_IDS,
	clampFloatingPanelGeometry,
	workspaceDockLabel,
	workspacePanelLabel,
	workspacePanelMinimumWidth,
} from './workspace-panel-model.ts';

export default function WorkspacePanelDock({
	dock,
	controller,
	clipPropertiesFocusRequest = /** @type {import('../../controller/composition/clip-properties-panel-opening.ts').ClipPropertiesFocusRequest | null} */ (null),
	snapshot,
	productId = snapshot.productId,
	capabilities = snapshot.capabilities,
	copy,
	locale,
	fileService, confirmFileSizeWarning,
	playbackMeterSettings,
	recordingMeterSettings = /** @type {import('../meter-settings.ts').MeterSettings | undefined} */ (undefined),
	onPlaybackMeterSettingsChange = /** @type {((update: import('./meter-panel-settings.ts').MeterSettingsUpdate) => void) | undefined} */ (undefined),
	onRecordingMeterSettingsChange = /** @type {((update: import('./meter-panel-settings.ts').MeterSettingsUpdate) => void) | undefined} */ (undefined),
	clippingEnabled = false,
	run,
	showArmControls,
	displayAudioSupported,
	onOpenEffects,
	onRoutingGraphGesture = /** @type {import('./soundscaper-routing-graph-gesture.ts').SoundscaperRoutingGraphGestureHandler | undefined} */ (undefined),
	onRoutingParameterGesture = /** @type {import('./soundscaper-routing-graph-gesture.ts').SoundscaperRoutingParameterGestureHandler | undefined} */ (undefined),
	effectsPanelTarget,
	onEffectWindowChange,
	draggedPanelId,
	onPanelDragStart,
	onPanelDragEnd,
	onPanelMove,
	onTogglePanel,
	projectBinEffectivelyOpen,
	blocked,
}) {
	const dockRef = useRef(null);
	const resizeSessionRef = useRef(null);
	const [floatingBounds, setFloatingBounds] = useState({ width: 0, height: 0 });
	const [activeFloatingPanelId, setActiveFloatingPanelId] = useState(null);
	const availablePanels = WORKSPACE_PANEL_IDS
		.map((id) => [id, snapshot.preferences?.workspace?.panels?.[id]])
		.filter(([id, panel]) => (
			panel?.visible
			&& workspacePanelAvailable(productId, id, snapshot.webVcr, snapshot.capture)
			&& (capabilities?.audioEffects || id !== 'effects')
			&& (capabilities?.audioRecording || id !== 'recording-meter')
			&& (capabilities?.audioAnalysis || (!ANALYZER_PANEL_ID_SET.has(id) && id !== 'ebu-r128'))
			&& (id !== 'markers' || timelineAnnotationsAvailable(snapshot))
			&& (id !== 'project-bin' || projectBinEffectivelyOpen)
		));
	const panels = availablePanels
		.filter(([, panel]) => panel.dock === dock)
		.sort((left, right) => left[1].order - right[1].order);
	const groups = groupWorkspacePanelEntries(panels);
	const sideDock = dock === 'left' || dock === 'right';
	const columns = sideDock ? workspaceSideDockColumns(groups) : [];
	const minimumDockWidth = columns.reduce((total, column) => total + column.minimumWidth, 0);
	const arrangeTargets = ['left', 'right', 'top', 'bottom'].flatMap((targetDock) => (
		groupWorkspacePanelEntries(availablePanels
			.filter(([, panel]) => panel.dock === targetDock)
			.sort((left, right) => left[1].order - right[1].order))
			.map((group) => ({
				dock: targetDock,
				groupId: group.id,
				panelId: group.entries[0][0],
				panelIds: group.entries.map(([panelId]) => panelId),
				label: group.entries.map(([panelId]) => workspacePanelLabel(copy, panelId)).join(' / '),
			}))
	));
	useEffect(() => {
		if (dock !== 'floating') return undefined;
		const element = dockRef.current;
		if (!element) return undefined;
		const update = () => {
			const bounds = element.getBoundingClientRect();
			const next = { width: Math.round(bounds.width), height: Math.round(bounds.height) };
			setFloatingBounds((current) => (
				current.width === next.width && current.height === next.height ? current : next
			));
		};
		update();
		if (typeof ResizeObserver !== 'function') {
			window.addEventListener('resize', update);
			return () => window.removeEventListener('resize', update);
		}
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, [dock, panels.length]);
	useEffect(() => {
		const resize = (event) => {
			const session = resizeSessionRef.current;
			if (!session || event.pointerId !== session.pointerId) return;
			event.preventDefault();
			if (dock === 'floating') {
				if (session.resizeWidth) session.element.style.width = `${Math.round(Math.max(
					session.minimumWidth,
					Math.min(session.maximumWidth, session.initialWidth + event.clientX - session.startClientX),
				))}px`;
				if (session.resizeHeight) session.element.style.height = `${Math.round(Math.max(
					session.minimumHeight,
					Math.min(session.maximumHeight, session.initialHeight + event.clientY - session.startClientY),
				))}px`;
				return;
			}
			const pointerDelta = session.horizontal
				? event.clientX - session.startClientX
				: event.clientY - session.startClientY;
			const delta = pointerDelta * (session.invertDelta ? -1 : 1);
			const size = Math.max(session.minimumSize, Math.min(session.maximumSize, session.initialSize + delta));
			session.element.style[session.sizeProperty] = `${Math.round(size)}px`;
		};
		const finishResize = (event) => {
			const session = resizeSessionRef.current;
			if (event?.type === 'pointerup' && session?.pointerId !== event.pointerId) return;
			resizeSessionRef.current = null;
			if (!session?.element?.isConnected) return;
			const bounds = session.element.getBoundingClientRect();
			if (dock === 'floating') {
				const containerBounds = dockRef.current?.getBoundingClientRect();
				if (!containerBounds) return;
				const geometry = clampFloatingPanelGeometry({
					x: bounds.left - containerBounds.left,
					y: bounds.top - containerBounds.top,
					width: bounds.width,
					height: bounds.height,
				}, containerBounds, session.panelId);
				if (Math.abs(geometry.width - session.initialWidth) < 2
					&& Math.abs(geometry.height - session.initialHeight) < 2) return;
				Object.assign(session.element.style, {
					left: `${geometry.x}px`,
					top: `${geometry.y}px`,
					width: `${geometry.width}px`,
					height: `${geometry.height}px`,
				});
				run(() => controller.actions.preferences.setPanel(session.panelId, {
					...geometry,
				}));
				return;
			}
			const size = Math.round(session.horizontal ? bounds.width : bounds.height);
			if (!Number.isFinite(size) || Math.abs(size - session.initialSize) < 2) {
				if (session.initialWide !== undefined) session.element.dataset.workspaceDockWide = session.initialWide;
				session.element.style.removeProperty(session.sizeProperty);
				return;
			}
			session.element.style.setProperty(session.cssSizeProperty || '--workspace-panel-size', `${size}px`);
			session.element.style.removeProperty(session.sizeProperty);
			run(() => session.dockExtent
				? controller.actions.preferences.setPanelDockExtent(dock, {
					[session.preferenceProperty || 'size']: size,
				})
				: controller.actions.preferences.setPanelFrameSize(session.panelId, size));
		};
		const cancelResize = (event) => {
			const session = resizeSessionRef.current;
			if (event && session?.pointerId !== undefined && event.pointerId !== session.pointerId) return;
			resizeSessionRef.current = null;
			if (session?.initialWide !== undefined) session.element.dataset.workspaceDockWide = session.initialWide;
			if (session?.manual && dock === 'floating' && session.element) {
				session.element.style.width = `${session.initialWidth}px`;
				session.element.style.height = `${session.initialHeight}px`;
			} else if (session?.manual && session.sizeProperty) session.element?.style.removeProperty(session.sizeProperty);
		};
		return retainWorkspacePanelResizeLifecycle(window, {
			active: () => resizeSessionRef.current !== null,
			resize, finish: finishResize, cancel: cancelResize,
		});
	}, [controller, dock, run]);
	const beginFloatingMove = useFloatingWorkspacePanelMove({ dock, dockRef, resizeSessionRef,
		controller, run, setActiveFloatingPanelId, onPanelDragStart, onPanelDragEnd, onPanelMove });
	const beginResize = (event) => {
		if (event.button !== 0) return;
		const dockResizeHandle = event.target.closest?.('[data-workspace-dock-resize-handle]');
		if ((dock === 'left' || dock === 'right') && dockResizeHandle?.closest('[data-panel-dock]') === dockRef.current) {
			const element = dockRef.current;
			const bounds = element?.getBoundingClientRect();
			const workspaceBounds = element?.parentElement?.getBoundingClientRect();
			if (!element || !bounds) return;
			const minimumSize = minimumDockWidth;
			const maximumSize = Math.max(
				minimumSize,
				Math.round((workspaceBounds?.width || window.innerWidth) * 0.65),
			);
			resizeSessionRef.current = {
				element,
				initialWide: element.dataset.workspaceDockWide,
				horizontal: true,
				invertDelta: dock === 'right',
				initialWidth: Math.round(bounds.width),
				initialHeight: Math.round(bounds.height),
				initialSize: Math.round(bounds.width),
				maximumSize,
				minimumSize,
				manual: true,
				dockExtent: true,
				panelId: panels[0][0],
				panelIds: panels.map(([panelId]) => panelId),
				pointerId: event.pointerId,
				sizeProperty: 'width',
				cssSizeProperty: '--workspace-dock-width',
				preferenceProperty: 'width',
				startClientX: event.clientX,
				startClientY: event.clientY,
			};
			element.style.width = window.getComputedStyle(element).width;
			element.dataset.workspaceDockWide = 'true';
			event.preventDefault();
			return;
		}
		if ((dock === 'top' || dock === 'bottom') && dockResizeHandle?.closest('[data-panel-dock]') === dockRef.current) {
			const element = dockRef.current;
			const bounds = element?.getBoundingClientRect();
			if (!element || !bounds) return;
			resizeSessionRef.current = {
				element,
				horizontal: false,
				invertDelta: dock === 'bottom',
				initialWidth: Math.round(bounds.width),
				initialHeight: Math.round(bounds.height),
				initialSize: Math.round(bounds.height),
				maximumSize: Number.POSITIVE_INFINITY,
				minimumSize: 120,
				manual: true,
				dockExtent: true,
				panelId: panels[0][0],
				panelIds: panels.map(([panelId]) => panelId),
				pointerId: event.pointerId,
				sizeProperty: 'height',
				startClientX: event.clientX,
				startClientY: event.clientY,
			};
			event.preventDefault();
			return;
		}
		const element = event.target.closest?.('[data-workspace-panel-group]');
		if (!element || event.target.closest?.('[role="menu"]')) return;
		if (dock === 'top' || dock === 'bottom') return;
		const siblings = columns.find((column) => column.groups.some((group) => group.id === element.dataset.workspacePanelGroup))?.groups ?? groups;
		const panelIndex = siblings.findIndex((group) => group.id === element.dataset.workspacePanelGroup);
		if (panelIndex < 0 || (dock !== 'floating' && panelIndex === siblings.length - 1)) return;
		const panelGroup = siblings[panelIndex];
		const bounds = element.getBoundingClientRect();
		const threshold = 14;
		const horizontal = dock === 'floating';
		const resizeWidth = dock === 'floating' && event.clientX >= bounds.right - threshold;
		const resizeHeight = dock === 'floating' && event.clientY >= bounds.bottom - threshold;
		const onResizeEdge = dock === 'floating'
			? resizeWidth || resizeHeight
			: horizontal
				? event.clientX >= bounds.right - threshold
				: event.clientY >= bounds.bottom - threshold;
		if (!onResizeEdge) return;
		const dockBounds = dockRef.current?.getBoundingClientRect();
		const panelMinimumWidth = workspacePanelMinimumWidth(panelGroup.activePanelId);
		const maximumWidth = dock === 'floating'
			? Math.max(panelMinimumWidth, (dockBounds?.right || bounds.right) - bounds.left)
			: undefined;
		const maximumHeight = dock === 'floating'
			? Math.max(FLOATING_PANEL_MIN_HEIGHT, (dockBounds?.bottom || bounds.bottom) - bounds.top)
			: undefined;
		const minimumSize = horizontal ? panelMinimumWidth : Math.max(
			FLOATING_PANEL_MIN_HEIGHT,
			Number.parseFloat(window.getComputedStyle(element).minHeight) || 0,
		);
		const minimumFollowingHeight = dock === 'floating' ? 0 : Array.from(
			element.parentElement?.querySelectorAll(':scope > [data-workspace-panel-group]') || [],
		).slice(panelIndex + 1).reduce((total, panel) => total + Math.max(
			FLOATING_PANEL_MIN_HEIGHT,
			Number.parseFloat(window.getComputedStyle(panel).minHeight) || 0,
		), 0);
		resizeSessionRef.current = {
			element,
			horizontal,
			initialWidth: Math.round(bounds.width),
			initialHeight: Math.round(bounds.height),
			resizeWidth,
			resizeHeight,
			minimumWidth: panelMinimumWidth,
			minimumHeight: FLOATING_PANEL_MIN_HEIGHT,
			maximumWidth,
			maximumHeight,
			initialSize: Math.round(horizontal ? bounds.width : bounds.height),
			maximumSize: Math.max(
				minimumSize,
				dock === 'floating'
					? Number.POSITIVE_INFINITY
					: Math.round((dockBounds?.height || bounds.height) - minimumFollowingHeight),
			),
			minimumSize,
			manual: true,
			panelId: panelGroup.activePanelId,
			panelIds: panelGroup.entries.map(([panelId]) => panelId),
			pointerId: event.pointerId,
			sizeProperty: horizontal ? 'width' : 'height',
			startClientX: event.clientX,
			startClientY: event.clientY,
		};
		event.preventDefault();
	};
	const adjustFloatingPanelGeometry = (event, panelId, panel, mode) => {
		if (dock !== 'floating' || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return false;
		const workspaceBounds = dockRef.current?.getBoundingClientRect();
		if (!workspaceBounds) return false;
		event.preventDefault();
		const step = event.shiftKey ? 48 : 16;
		const current = clampFloatingPanelGeometry(panel, workspaceBounds, panelId);
		const next = { ...current };
		if (mode === 'resize') {
			if (event.key === 'ArrowLeft') next.width -= step;
			else if (event.key === 'ArrowRight') next.width += step;
			else if (event.key === 'ArrowUp') next.height -= step;
			else next.height += step;
		} else {
			if (event.key === 'ArrowLeft') next.x -= step;
			else if (event.key === 'ArrowRight') next.x += step;
			else if (event.key === 'ArrowUp') next.y -= step;
			else next.y += step;
		}
		const geometry = clampFloatingPanelGeometry(next, workspaceBounds, panelId);
		setActiveFloatingPanelId(panelId);
		run(() => controller.actions.preferences.setPanel(panelId, {
			x: Math.round(geometry.x),
			y: Math.round(geometry.y),
			width: Math.round(geometry.width),
			height: Math.round(geometry.height),
		}));
		return true;
	};
	const adjustHorizontalDockSize = (event) => {
		if ((dock !== 'top' && dock !== 'bottom') || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
		const bounds = dockRef.current?.getBoundingClientRect();
		if (!bounds) return;
		event.preventDefault();
		const step = event.shiftKey ? 48 : 16;
		const expands = dock === 'top' ? event.key === 'ArrowDown' : event.key === 'ArrowUp';
		const size = Math.max(120, bounds.height + (expands ? step : -step));
		run(() => controller.actions.preferences.setPanelDockExtent(dock, { size }));
	};
	const adjustSideDockSize = (event) => {
		if ((dock !== 'left' && dock !== 'right') || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
		const bounds = dockRef.current?.getBoundingClientRect();
		const workspaceBounds = dockRef.current?.parentElement?.getBoundingClientRect();
		if (!bounds) return;
		event.preventDefault();
		const minimumSize = minimumDockWidth;
		const maximumSize = Math.max(
			minimumSize,
			Math.round((workspaceBounds?.width || window.innerWidth) * 0.65),
		);
		const step = event.shiftKey ? 48 : 16;
		const expands = dock === 'left' ? event.key === 'ArrowRight' : event.key === 'ArrowLeft';
		const width = Math.max(minimumSize, Math.min(maximumSize, bounds.width + (expands ? step : -step)));
		run(() => controller.actions.preferences.setPanelDockExtent(dock, { width }));
	};

	const renderGroup = (group, groupIndex, siblings = groups) => <WorkspacePanelGroup
		key={group.id}
		group={group}
		groupIndex={groupIndex}
		groups={siblings}
		dock={dock}
		copy={copy}
		contentProps={{
			controller, snapshot, productId, capabilities, copy, locale, fileService, confirmFileSizeWarning, clipPropertiesFocusRequest,
			playbackMeterSettings, recordingMeterSettings,
			onPlaybackMeterSettingsChange, onRecordingMeterSettingsChange,
			clippingEnabled,
			run,
			showArmControls,
			displayAudioSupported,
			onOpenEffects,
			onRoutingGraphGesture,
			onRoutingParameterGesture,
			effectsPanelTarget,
			onEffectWindowChange,
			blocked,
			projectBinVisible: availablePanels.some(([id]) => id === 'project-bin'),
		}}
		floatingBounds={floatingBounds}
		activeFloatingPanelId={activeFloatingPanelId}
		setActiveFloatingPanelId={setActiveFloatingPanelId}
		draggedPanelId={draggedPanelId}
		onPanelDragStart={onPanelDragStart}
		onPanelDragEnd={onPanelDragEnd}
		onPanelMove={onPanelMove}
		onPanelActivate={(panelId) => run(() => controller.actions.preferences.activatePanelTab(panelId))}
		onTogglePanel={onTogglePanel}
		beginFloatingMove={beginFloatingMove}
		adjustFloatingPanelGeometry={adjustFloatingPanelGeometry}
		arrangeTargets={arrangeTargets
			.filter((target) => target.groupId !== group.id || group.entries.length > 1)
			.map((target) => {
				const sameGroup = target.groupId === group.id && target.dock === dock;
				return {
					...target,
					panelId: sameGroup
						? target.panelIds.find((panelId) => panelId !== group.activePanelId)
						: target.panelId,
					tabDisabled: sameGroup,
				};
			})}
	/>;
	if (!panels.length) return null;
	const dockStyle = dock === 'top' || dock === 'bottom'
		? {
			'--workspace-panel-size': `${panels[0][1].size}px`,
			'--workspace-panel-count': groups.length,
		}
		: (dock === 'left' || dock === 'right')
			? { '--workspace-dock-width': `${columns.reduce((total, column) => total + column.width, 0)}px`,
				'--workspace-dock-min-width': `${minimumDockWidth}px` }
			: undefined;
	return (
		<aside
			ref={dockRef}
			className={`kw-audio-editor__panel-dock kw-audio-editor__panel-dock--${dock}`}
			data-panel-dock={dock}
			data-workspace-auto-size={panels.every(([, panel]) => panel.autoSize === true) && panels.some(([id]) => id === 'video-preview' || id === 'source-monitor')}
			data-workspace-column-count={sideDock ? columns.length : undefined}
			data-meter-dock={panels.every(([id]) => id === 'playback-meter' || id === 'recording-meter') ? '' : undefined}
			data-workspace-dock-wide={columns.length > 1 || workspaceSideDockAllowsWidePanels(panels, snapshot.preferences?.workspace?.activeId)}
			style={dockStyle}
			aria-label={copy.panels}
			onPointerDownCapture={beginResize}
			onDragOver={(event) => {
				if (!draggedPanelId) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = 'move';
			}}
			onDrop={(event) => {
				if (!draggedPanelId) return;
				event.preventDefault();
				onPanelMove(draggedPanelId, { kind: 'dock', dock, groupIndex: Number.MAX_SAFE_INTEGER });
			}}
		>
			{(dock === 'left' || dock === 'right') && <button
				type="button"
				className={`kw-audio-editor__workspace-dock-resize-handle kw-audio-editor__workspace-dock-resize-handle--${dock}`}
				data-workspace-dock-resize-handle={dock}
				aria-label={formatResizeLabel(copy, workspaceDockLabel(copy, dock))}
				onKeyDown={adjustSideDockSize}
			/>}
			{(dock === 'top' || dock === 'bottom') && <button
				type="button"
				className={`kw-audio-editor__workspace-dock-resize-handle kw-audio-editor__workspace-dock-resize-handle--${dock}`}
				data-workspace-dock-resize-handle={dock}
				aria-label={formatResizeLabel(copy, workspaceDockLabel(copy, dock))}
				onKeyDown={adjustHorizontalDockSize}
			/>}
			{sideDock ? columns.map((column) => <div
				key={column.index}
				className="kw-audio-editor__workspace-panel-column"
				data-workspace-panel-column={column.index}
				style={{ '--workspace-column-min-width': `${column.minimumWidth}px`, flexGrow: column.width }}
			>
				{column.groups.map((group, index) => renderGroup(group, index, column.groups))}
			</div>) : groups.map((group, index) => renderGroup(group, index))}
		</aside>
	);
}
