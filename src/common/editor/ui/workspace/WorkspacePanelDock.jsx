import { useEffect, useRef, useState } from 'react';

import { groupWorkspacePanelEntries } from '../../workspace-panel-layout.ts';
import { formatResizeLabel } from '../localization-template.ts';
import { timelineAnnotationsAvailable } from '../timeline/timeline-annotation-ui-model.ts';
import { workspacePanelAvailable } from './workspace-product-panel-runtime.ts';
import WorkspacePanelGroup from './WorkspacePanelGroup.jsx';
import {
	ANALYZER_PANEL_ID_SET,
	FLOATING_PANEL_MIN_HEIGHT,
	FLOATING_PANEL_MIN_WIDTH,
	WORKSPACE_PANEL_IDS,
	clampFloatingPanelGeometry,
	workspaceDockLabel,
	workspacePanelLabel,
} from './workspace-panel-model.ts';

export default function WorkspacePanelDock({
	dock,
	controller,
	snapshot,
	productId = snapshot.productId,
	capabilities = snapshot.capabilities,
	copy,
	locale,
	fileService,
	playbackMeterSettings,
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
	const moveSessionRef = useRef(null);
	const [floatingBounds, setFloatingBounds] = useState({ width: 0, height: 0 });
	const [activeFloatingPanelId, setActiveFloatingPanelId] = useState(null);
	const availablePanels = WORKSPACE_PANEL_IDS
		.map((id) => [id, snapshot.preferences?.workspace?.panels?.[id]])
		.filter(([id, panel]) => (
			panel?.visible
			&& workspacePanelAvailable(productId, id, snapshot.webVcr, snapshot.capture)
			&& (capabilities?.audioEffects || id !== 'effects')
			&& (capabilities?.audioAnalysis || (!ANALYZER_PANEL_ID_SET.has(id) && id !== 'ebu-r128'))
			&& (id !== 'markers' || timelineAnnotationsAvailable(snapshot))
			&& !(snapshot.preferences?.workspace?.activeId === 'video-editor'
				&& (id === 'project-bin' || id === 'video-preview' || id === 'source-monitor'))
			&& (id !== 'project-bin' || projectBinEffectivelyOpen)
			&& (id !== 'video-preview' || snapshot.project?.tracks?.some((track) => (
				track.type === 'video' && track.clipIds?.length
			)))
		));
	const panels = availablePanels
		.filter(([, panel]) => panel.dock === dock)
		.sort((left, right) => left[1].order - right[1].order);
	const groups = groupWorkspacePanelEntries(panels);
	const arrangeTargets = ['left', 'right', 'bottom'].flatMap((targetDock) => (
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
			if (!session || dock === 'floating' || event.pointerId !== session.pointerId) return;
			event.preventDefault();
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
				}, containerBounds);
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
			if (session?.pointerId !== undefined && event?.pointerId !== session.pointerId) return;
			resizeSessionRef.current = null;
			if (session?.manual && session.sizeProperty) session.element?.style.removeProperty(session.sizeProperty);
		};
		window.addEventListener('pointermove', resize, { passive: false });
		window.addEventListener('pointerup', finishResize);
		window.addEventListener('mouseup', finishResize);
		window.addEventListener('pointercancel', cancelResize);
		return () => {
			window.removeEventListener('pointermove', resize);
			window.removeEventListener('pointerup', finishResize);
			window.removeEventListener('mouseup', finishResize);
			window.removeEventListener('pointercancel', cancelResize);
		};
	}, [controller, dock, run]);
	useEffect(() => {
		if (dock !== 'floating') return undefined;
		const move = (event) => {
			const session = moveSessionRef.current;
			if (!session || event.pointerId !== session.pointerId) return;
			event.preventDefault();
			const geometry = clampFloatingPanelGeometry({
				...session.startGeometry,
				x: session.startGeometry.x + event.clientX - session.startClientX,
				y: session.startGeometry.y + event.clientY - session.startClientY,
			}, session.workspaceBounds);
			session.geometry = geometry;
			session.moved = session.moved
				|| Math.abs(geometry.x - session.startGeometry.x) >= 1
				|| Math.abs(geometry.y - session.startGeometry.y) >= 1;
			Object.assign(session.element.style, {
				left: `${geometry.x}px`,
				top: `${geometry.y}px`,
			});
		};
		const finish = (event) => {
			const session = moveSessionRef.current;
			if (!session || event.pointerId !== session.pointerId) return;
			moveSessionRef.current = null;
			session.element.classList.remove('kw-audio-editor__workspace-panel--moving');
			if (!session.moved) return;
			run(() => controller.actions.preferences.setPanel(session.panelId, {
				x: Math.round(session.geometry.x),
				y: Math.round(session.geometry.y),
			}));
		};
		const cancel = (event) => {
			const session = moveSessionRef.current;
			if (!session || event.pointerId !== session.pointerId) return;
			moveSessionRef.current = null;
			session.element.classList.remove('kw-audio-editor__workspace-panel--moving');
			Object.assign(session.element.style, {
				left: `${session.startGeometry.x}px`,
				top: `${session.startGeometry.y}px`,
			});
		};
		window.addEventListener('pointermove', move, { passive: false });
		window.addEventListener('pointerup', finish);
		window.addEventListener('pointercancel', cancel);
		return () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', finish);
			window.removeEventListener('pointercancel', cancel);
			moveSessionRef.current?.element?.classList.remove('kw-audio-editor__workspace-panel--moving');
			moveSessionRef.current = null;
		};
	}, [controller, dock, run]);
	const beginResize = (event) => {
		if (event.button !== 0) return;
		const dockResizeHandle = event.target.closest?.('[data-workspace-dock-resize-handle]');
		if ((dock === 'left' || dock === 'right') && dockResizeHandle?.closest('[data-panel-dock]') === dockRef.current) {
			const element = dockRef.current;
			const bounds = element?.getBoundingClientRect();
			const workspaceBounds = element?.parentElement?.getBoundingClientRect();
			if (!element || !bounds) return;
			const hasEffects = panels.some(([panelId]) => panelId === 'effects');
			const minimumSize = hasEffects ? 360 : 240;
			const maximumSize = Math.max(
				minimumSize,
				Math.min(hasEffects ? 520 : 420, Math.round((workspaceBounds?.width || window.innerWidth) * 0.65)),
			);
			resizeSessionRef.current = {
				element,
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
			event.preventDefault();
			return;
		}
		if (dock === 'bottom' && dockResizeHandle?.closest('[data-panel-dock]') === dockRef.current) {
			const element = dockRef.current;
			const bounds = element?.getBoundingClientRect();
			if (!element || !bounds) return;
			resizeSessionRef.current = {
				element,
				horizontal: false,
				invertDelta: true,
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
		const panelGroup = groups.find((group) => group.id === element.dataset.workspacePanelGroup);
		if (!panelGroup) return;
		const bounds = element.getBoundingClientRect();
		const threshold = 14;
		const horizontal = dock === 'bottom' || dock === 'floating';
		const onResizeEdge = dock === 'floating'
			? event.clientX >= bounds.right - threshold || event.clientY >= bounds.bottom - threshold
			: horizontal
				? event.clientX >= bounds.right - threshold
				: event.clientY >= bounds.bottom - threshold;
		if (!onResizeEdge) return;
		const dockBounds = dockRef.current?.getBoundingClientRect();
		resizeSessionRef.current = {
			element,
			horizontal,
			initialWidth: Math.round(bounds.width),
			initialHeight: Math.round(bounds.height),
			initialSize: Math.round(horizontal ? bounds.width : bounds.height),
			maximumSize: Math.max(
				horizontal ? FLOATING_PANEL_MIN_WIDTH : FLOATING_PANEL_MIN_HEIGHT,
				dock === 'floating'
					? Number.POSITIVE_INFINITY
					: Math.round(horizontal ? dockBounds?.width || bounds.width : dockBounds?.height || bounds.height),
			),
			minimumSize: horizontal ? FLOATING_PANEL_MIN_WIDTH : FLOATING_PANEL_MIN_HEIGHT,
			manual: dock !== 'floating',
			panelId: panelGroup.activePanelId,
			panelIds: panelGroup.entries.map(([panelId]) => panelId),
			pointerId: event.pointerId,
			sizeProperty: horizontal ? 'width' : 'height',
			startClientX: event.clientX,
			startClientY: event.clientY,
		};
		if (dock !== 'floating') event.preventDefault();
	};
	const beginFloatingMove = (event, panelId) => {
		if (dock !== 'floating' || event.button !== 0 || resizeSessionRef.current) return;
		if (event.target.closest('button, select, input, label, a, [role="menu"]')) return;
		const element = event.currentTarget.closest('[data-workspace-panel]');
		const workspace = dockRef.current;
		if (!element || !workspace) return;
		const workspaceBounds = workspace.getBoundingClientRect();
		const elementBounds = element.getBoundingClientRect();
		const startGeometry = clampFloatingPanelGeometry({
			x: elementBounds.left - workspaceBounds.left,
			y: elementBounds.top - workspaceBounds.top,
			width: elementBounds.width,
			height: elementBounds.height,
		}, workspaceBounds);
		moveSessionRef.current = {
			panelId,
			element,
			pointerId: event.pointerId,
			startClientX: event.clientX,
			startClientY: event.clientY,
			startGeometry,
			geometry: startGeometry,
			workspaceBounds,
			moved: false,
		};
		setActiveFloatingPanelId(panelId);
		element.classList.add('kw-audio-editor__workspace-panel--moving');
		event.currentTarget.setPointerCapture?.(event.pointerId);
		event.preventDefault();
	};
	const adjustFloatingPanelGeometry = (event, panelId, panel, mode) => {
		if (dock !== 'floating' || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return false;
		const workspaceBounds = dockRef.current?.getBoundingClientRect();
		if (!workspaceBounds) return false;
		event.preventDefault();
		const step = event.shiftKey ? 48 : 16;
		const current = clampFloatingPanelGeometry(panel, workspaceBounds);
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
		const geometry = clampFloatingPanelGeometry(next, workspaceBounds);
		setActiveFloatingPanelId(panelId);
		run(() => controller.actions.preferences.setPanel(panelId, {
			x: Math.round(geometry.x),
			y: Math.round(geometry.y),
			width: Math.round(geometry.width),
			height: Math.round(geometry.height),
		}));
		return true;
	};
	const adjustBottomDockSize = (event) => {
		if (dock !== 'bottom' || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
		const bounds = dockRef.current?.getBoundingClientRect();
		if (!bounds) return;
		event.preventDefault();
		const step = event.shiftKey ? 48 : 16;
		const size = Math.max(120, bounds.height + (event.key === 'ArrowUp' ? step : -step));
		run(() => controller.actions.preferences.setPanelDockExtent('bottom', { size }));
	};
	const adjustSideDockSize = (event) => {
		if ((dock !== 'left' && dock !== 'right') || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
		const bounds = dockRef.current?.getBoundingClientRect();
		const workspaceBounds = dockRef.current?.parentElement?.getBoundingClientRect();
		if (!bounds) return;
		event.preventDefault();
		const hasEffects = panels.some(([panelId]) => panelId === 'effects');
		const minimumSize = hasEffects ? 360 : 240;
		const maximumSize = Math.max(
			minimumSize,
			Math.min(hasEffects ? 520 : 420, Math.round((workspaceBounds?.width || window.innerWidth) * 0.65)),
		);
		const step = event.shiftKey ? 48 : 16;
		const expands = dock === 'left' ? event.key === 'ArrowRight' : event.key === 'ArrowLeft';
		const width = Math.max(minimumSize, Math.min(maximumSize, bounds.width + (expands ? step : -step)));
		run(() => controller.actions.preferences.setPanelDockExtent(dock, { width }));
	};
	if (!panels.length) return null;
	const dockStyle = dock === 'bottom'
		? {
			'--workspace-panel-size': `${panels[0][1].size}px`,
			'--workspace-panel-count': groups.length,
		}
		: (dock === 'left' || dock === 'right')
			? { '--workspace-dock-width': `${panels[0][1].width}px` }
			: undefined;
	return (
		<aside
			ref={dockRef}
			className={`kw-audio-editor__panel-dock kw-audio-editor__panel-dock--${dock}`}
			data-panel-dock={dock}
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
			>↔</button>}
			{dock === 'bottom' && <button
				type="button"
				className="kw-audio-editor__workspace-dock-resize-handle"
				data-workspace-dock-resize-handle={dock}
				aria-label={formatResizeLabel(copy, workspaceDockLabel(copy, dock))}
				onKeyDown={adjustBottomDockSize}
			>↕</button>}
			{groups.map((group, groupIndex) => <WorkspacePanelGroup
				key={group.id}
				group={group}
				groupIndex={groupIndex}
				groups={groups}
				dock={dock}
				copy={copy}
				contentProps={{
					controller,
					snapshot,
					productId,
					capabilities,
					copy,
					locale,
					fileService,
					playbackMeterSettings,
					run,
					showArmControls,
					displayAudioSupported,
					onOpenEffects,
					onRoutingGraphGesture,
					onRoutingParameterGesture,
					effectsPanelTarget,
					onEffectWindowChange,
					blocked,
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
			/>)}
		</aside>
	);
}
