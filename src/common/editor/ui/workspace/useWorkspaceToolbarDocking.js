import { useCallback, useEffect, useRef, useState } from 'react';

export function useWorkspaceToolbarDocking(editorRef) {
	const [toolbarDock, setToolbarDock] = useState('top');
	const [floatingToolbarPosition, setFloatingToolbarPosition] = useState({ x: 24, y: 104 });
	const toolbarDragRef = useRef(null);
	const floatingToolbarRef = useRef(null);
	const finishToolbarDrag = useCallback(() => {
		const drag = toolbarDragRef.current;
		if (drag?.frame) cancelAnimationFrame(drag.frame);
		if (drag?.moved) {
			setToolbarDock(drag.dock);
			if (drag.dock === 'floating') {
				setFloatingToolbarPosition({ x: drag.x, y: drag.y });
			}
		}
		toolbarDragRef.current = null;
	}, []);
	const handleToolbarGripperMouseDown = useCallback((event, toolbarRect) => {
		if (event.button !== 0 || !editorRef.current) return;
		event.preventDefault();
		const editorRect = editorRef.current.getBoundingClientRect();
		toolbarDragRef.current = {
			startX: event.clientX,
			startY: event.clientY,
			offsetX: event.clientX - toolbarRect.left,
			offsetY: event.clientY - toolbarRect.top,
			editorLeft: editorRect.left,
			editorTop: editorRect.top,
			editorBottom: editorRect.bottom,
			dock: toolbarDock,
			x: floatingToolbarPosition.x,
			y: floatingToolbarPosition.y,
			frame: 0,
			moved: false,
		};
	}, [editorRef, floatingToolbarPosition.x, floatingToolbarPosition.y, toolbarDock]);
	useEffect(() => {
		const handleToolbarDrag = (event) => {
			const drag = toolbarDragRef.current;
			if (!drag) return;
			const moved = drag.moved || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4;
			if (!moved) return;
			drag.moved = true;
			const edgeDistance = 56;
			if (event.clientY - drag.editorTop <= edgeDistance) {
				if (drag.dock !== 'top') {
					drag.dock = 'top';
					setToolbarDock('top');
				}
				return;
			}
			if (drag.editorBottom - event.clientY <= edgeDistance) {
				if (drag.dock !== 'bottom') {
					drag.dock = 'bottom';
					setToolbarDock('bottom');
				}
				return;
			}
			drag.x = Math.max(0, event.clientX - drag.editorLeft - drag.offsetX);
			drag.y = Math.max(0, event.clientY - drag.editorTop - drag.offsetY);
			if (drag.dock !== 'floating') {
				drag.dock = 'floating';
				setToolbarDock('floating');
			}
			if (drag.frame) return;
			drag.frame = requestAnimationFrame(() => {
				drag.frame = 0;
				if (toolbarDragRef.current !== drag || drag.dock !== 'floating') return;
				const toolbar = floatingToolbarRef.current;
				if (!toolbar) return;
				toolbar.style.left = `${drag.x}px`;
				toolbar.style.top = `${drag.y}px`;
			});
		};
		window.addEventListener('mousemove', handleToolbarDrag);
		window.addEventListener('mouseup', finishToolbarDrag);
		return () => {
			window.removeEventListener('mousemove', handleToolbarDrag);
			window.removeEventListener('mouseup', finishToolbarDrag);
			const drag = toolbarDragRef.current;
			if (drag?.frame) {
				cancelAnimationFrame(drag.frame);
				drag.frame = 0;
			}
		};
	}, [finishToolbarDrag]);

	return {
		floatingToolbarPosition,
		floatingToolbarRef,
		handleToolbarGripperMouseDown,
		toolbarDock,
		toolbarDragRef,
	};
}
