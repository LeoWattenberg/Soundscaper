import { useCallback, useEffect, useRef, useState } from 'react';

import { createToolbarDockingSession, loadToolbarDockingState } from '../../controller/composition/toolbar-docking-session.ts';

function toolbarStorage() {
	try { return globalThis.localStorage; } catch { return null; }
}

export function useWorkspaceToolbarDocking(editorRef, productId) {
	const storageKey = `${productId}-toolbar-docking-v1`;
	const [state, setState] = useState(() => loadToolbarDockingState(toolbarStorage(), storageKey));
	const sessionRef = useRef(null);
	const floatingToolbarElementRef = useRef(null);
	const [floatingToolbar, setFloatingToolbar] = useState(null);
	const floatingToolbarRef = useCallback((element) => {
		floatingToolbarElementRef.current = element;
		setFloatingToolbar(element);
	}, []);
	useEffect(() => {
		const session = createToolbarDockingSession({
			initialState: loadToolbarDockingState(toolbarStorage(), storageKey),
			storage: toolbarStorage(),
			storageKey,
			onChange: setState,
			getFloatingBounds: () => floatingToolbarElementRef.current?.getBoundingClientRect() ?? null,
			onFloatingPreview: ({ x, y }) => {
				const toolbar = floatingToolbarElementRef.current;
				if (toolbar) Object.assign(toolbar.style, { left: `${x}px`, top: `${y}px` });
			},
			events: { subscribe: (type, handler) => {
				window.addEventListener(type, handler);
				return () => window.removeEventListener(type, handler);
			} },
			requestFrame: (callback) => requestAnimationFrame(callback),
			cancelFrame: (id) => cancelAnimationFrame(id),
		});
		sessionRef.current = session;
		return () => { session.dispose(); sessionRef.current = null; };
	}, [storageKey]);
	useEffect(() => {
		const editor = editorRef.current;
		const toolbar = floatingToolbar;
		if (state.dock !== 'floating' || !editor || !toolbar) return undefined;
		const reconcile = () => sessionRef.current?.reconcileFloatingBounds(editor.getBoundingClientRect());
		reconcile();
		const observer = new ResizeObserver(reconcile);
		observer.observe(editor);
		observer.observe(toolbar);
		return () => observer.disconnect();
	}, [editorRef, floatingToolbar, state.dock]);
	const handleToolbarGripperMouseDown = useCallback((event, toolbarRect) => {
		if (event.button !== 0 || !editorRef.current) return;
		event.preventDefault();
		sessionRef.current?.begin(
			{ x: event.clientX, y: event.clientY },
			toolbarRect,
			editorRef.current.getBoundingClientRect(),
		);
	}, [editorRef]);
	const setToolbarDock = useCallback((dock) => sessionRef.current?.setDock(dock), []);
	return {
		floatingToolbarPosition: { x: state.x, y: state.y },
		floatingToolbarRef,
		handleToolbarGripperMouseDown,
		toolbarDock: state.dock,
		setToolbarDock,
	};
}
