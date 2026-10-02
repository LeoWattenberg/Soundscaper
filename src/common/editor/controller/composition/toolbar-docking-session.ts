/* SPDX-License-Identifier: AGPL-3.0-only */

export const TOOLBAR_DOCKS = ['top', 'bottom', 'left', 'right', 'floating'] as const;
export type ToolbarDock = typeof TOOLBAR_DOCKS[number];
export interface ToolbarDockingState { readonly dock: ToolbarDock; readonly x: number; readonly y: number }
interface Point { readonly x: number; readonly y: number }
interface Bounds { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
interface StorageReader { getItem(key: string): string | null }
interface StorageWriter { setItem(key: string, value: string): void }
interface SessionOptions {
	readonly initialState: ToolbarDockingState;
	readonly storage?: StorageWriter | null;
	readonly storageKey: string;
	readonly onChange: (state: ToolbarDockingState) => void;
	readonly onFloatingPreview: (point: Point) => void;
	readonly getFloatingBounds?: () => Bounds | null;
	readonly events: {
		subscribe(type: 'mousemove' | 'mouseup' | 'keydown' | 'blur', handler: (event: MouseEvent | KeyboardEvent) => void): () => void;
	};
	readonly requestFrame: (callback: () => void) => number;
	readonly cancelFrame: (id: number) => void;
}
const DEFAULT_STATE: ToolbarDockingState = { dock: 'top', x: 24, y: 104 };

export function loadToolbarDockingState(storage: StorageReader | null | undefined, key: string): ToolbarDockingState {
	try {
		const candidate: unknown = JSON.parse(storage?.getItem(key) ?? 'null');
		if (!candidate || typeof candidate !== 'object') return DEFAULT_STATE;
		const value = candidate as Record<string, unknown>;
		if (!TOOLBAR_DOCKS.includes(value.dock as ToolbarDock)) return DEFAULT_STATE;
		return {
			dock: value.dock as ToolbarDock,
			x: typeof value.x === 'number' && Number.isFinite(value.x) ? Math.max(0, value.x) : DEFAULT_STATE.x,
			y: typeof value.y === 'number' && Number.isFinite(value.y) ? Math.max(0, value.y) : DEFAULT_STATE.y,
		};
	} catch { return DEFAULT_STATE; }
}

/** A cancellable docking gesture. Browser listeners, frames and storage are injected. */
export function createToolbarDockingSession(options: SessionOptions) {
	let state = options.initialState;
	let disposed = false;
	let frame = 0;
	let drag: {
		start: Point; offset: Point; editor: Bounds; toolbar: Bounds;
		initial: ToolbarDockingState; position: Point; moved: boolean;
	} | null = null;
	const change = (next: ToolbarDockingState) => { state = next; options.onChange(next); };
	const cancelFrame = () => {
		if (frame) options.cancelFrame(frame);
		frame = 0;
	};
	const persist = () => {
		try { options.storage?.setItem(options.storageKey, JSON.stringify(state)); } catch { /* Session remains usable without storage. */ }
	};
	const cancel = () => {
		cancelFrame();
		const gesture = drag;
		const initial = gesture?.initial;
		drag = null;
		if (initial && gesture) {
			const restored = initial.dock === 'floating' ? { ...initial, ...clampPosition(initial, gesture) } : { ...initial };
			if (restored.dock === 'floating') options.onFloatingPreview({ x: restored.x, y: restored.y });
			change(restored);
			if (restored.x !== initial.x || restored.y !== initial.y) persist();
		}
	};
	const finish = () => {
		cancelFrame();
		const ended = drag;
		drag = null;
		if (!ended) return;
		let corrected = false;
		if (state.dock === 'floating') {
			const position = clampPosition(ended.moved ? ended.position : state, ended);
			corrected = position.x !== state.x || position.y !== state.y;
			if (ended.moved || corrected) change({ dock: 'floating', ...position });
		}
		if (ended.moved || corrected) persist();
	};
	const clampPosition = (point: Point, gesture: { editor: Bounds; toolbar: Bounds }): Point => {
		const toolbar = options.getFloatingBounds?.() ?? gesture.toolbar;
		return {
			x: Math.max(0, Math.min(gesture.editor.right - gesture.editor.left - (toolbar.right - toolbar.left), point.x)),
			y: Math.max(0, Math.min(gesture.editor.bottom - gesture.editor.top - (toolbar.bottom - toolbar.top), point.y)),
		};
	};
	const move = (point: Point) => {
		if (!drag || disposed) return;
		if (!drag.moved && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) <= 4) return;
		drag.moved = true;
		const bounds = drag.editor;
		const edges = [
			['top', Math.abs(point.y - bounds.top)], ['bottom', Math.abs(bounds.bottom - point.y)],
			['left', Math.abs(point.x - bounds.left)], ['right', Math.abs(bounds.right - point.x)],
		] as const;
		const nearest = [...edges].sort((a, b) => a[1] - b[1])[0]!;
		const dock: ToolbarDock = nearest[1] <= 56 ? nearest[0] : 'floating';
		if (dock !== state.dock) change({ ...state, dock });
		if (dock !== 'floating') return;
		drag.position = {
			x: point.x - bounds.left - drag.offset.x,
			y: point.y - bounds.top - drag.offset.y,
		};
		if (frame) return;
		frame = options.requestFrame(() => {
			frame = 0;
			if (drag && state.dock === 'floating') options.onFloatingPreview(clampPosition(drag.position, drag));
		});
	};
	const releases = [
		options.events.subscribe('mousemove', (event) => {
			if ('clientX' in event) move({ x: event.clientX, y: event.clientY });
		}),
		options.events.subscribe('mouseup', finish),
		options.events.subscribe('blur', cancel),
		options.events.subscribe('keydown', (event) => {
			if ('key' in event && event.key === 'Escape' && drag) { event.preventDefault(); cancel(); }
		}),
	];
	return {
		begin(start: Point, toolbar: Bounds, editor: Bounds) {
			if (disposed) return;
			cancelFrame();
			drag = {
				start, toolbar, editor, initial: state, moved: false,
				offset: { x: start.x - toolbar.left, y: start.y - toolbar.top },
				position: { x: state.x, y: state.y },
			};
		},
		move,
		finish,
		cancel,
		setDock(dock: ToolbarDock) {
			if (disposed) return;
			cancel();
			change({ ...state, dock });
			persist();
		},
		reconcileFloatingBounds(editor: Bounds) {
			const toolbar = options.getFloatingBounds?.();
			if (disposed || state.dock !== 'floating' || !toolbar) return;
			if (drag) { drag.editor = editor; return; }
			const position = clampPosition(state, { editor, toolbar });
			if (position.x === state.x && position.y === state.y) return;
			change({ ...state, ...position });
			persist();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			cancelFrame();
			drag = null;
			for (const release of releases) release();
		},
	};
}
