import React, {
	type CSSProperties,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';
import { DialogHeader } from '@dilsonspickles/components';

import AudioEditorResizableSurface from './AudioEditorResizableSurface.jsx';
import { resolveEditorReturnFocus } from './focus-restoration.ts';

interface ResizableSurfaceProps extends React.HTMLAttributes<HTMLElement> {
	readonly children?: ReactNode;
	readonly resizeLabel?: string;
}

const ResizableSurface = AudioEditorResizableSurface as unknown as React.ForwardRefExoticComponent<
	ResizableSurfaceProps & React.RefAttributes<HTMLElement>
>;

const FOCUSABLE_SELECTOR = [
	'button:not([disabled])',
	'input:not([disabled])',
	'textarea:not([disabled])',
	'select:not([disabled])',
	'[href]',
	'[contenteditable="true"]',
	'[tabindex]:not([tabindex="-1"])',
].join(', ');

type DataAttributes = Record<`data-${string}`, string | number | boolean | undefined>;
type InitialFocus = 'first' | 'dialog' | string;

export interface AudioEditorDialogShellProps {
	readonly isOpen?: boolean;
	readonly title: string;
	readonly headerTitle?: string;
	readonly headerOs?: 'windows' | 'macos' | null;
	readonly onClose?: () => void;
	readonly children: ReactNode;
	readonly className?: string;
	readonly width?: number | string;
	readonly modal?: boolean;
	readonly draggable?: boolean;
	readonly closeOnEscape?: boolean;
	readonly closeOnOutside?: boolean;
	readonly initialFocus?: InitialFocus;
	readonly resizeLabel?: string;
	readonly ariaDescribedBy?: string;
	readonly dataAttributes?: DataAttributes;
	readonly overlayClassName?: string;
	readonly overlayDataAttributes?: DataAttributes;
	readonly headerSlot?: ReactNode;
	readonly footer?: ReactNode;
	readonly wrapBody?: boolean;
	readonly bodyClassName?: string;
	readonly style?: CSSProperties;
}

interface DragSession {
	readonly startX: number;
	readonly startY: number;
	readonly startOffset: Readonly<{ x: number; y: number }>;
}

/**
 * Shared editor-owned dialog contract. It centralizes modal focus containment,
 * dismissal, focus restoration, dragging, and the accessible resize surface
 * without inheriting the design-system Dialog's fixed content geometry.
 */
export default function AudioEditorDialogShell({
	isOpen = true,
	title,
	headerTitle = title,
	headerOs = 'windows',
	onClose,
	children,
	className = '',
	width = 640,
	modal = true,
	draggable = false,
	closeOnEscape = true,
	closeOnOutside = true,
	initialFocus = 'first',
	resizeLabel = `Resize: ${title}`,
	ariaDescribedBy,
	dataAttributes = {},
	overlayClassName = '',
	overlayDataAttributes = {},
	headerSlot = null,
	footer = null,
	wrapBody = true,
	bodyClassName = 'kw-audio-editor-dialog__body audio-editor-controlled-dialog__body',
	style,
}: AudioEditorDialogShellProps) {
	const panelRef = useRef<HTMLElement | null>(null);
	const onCloseRef = useRef(onClose);
	const dragRef = useRef<DragSession | null>(null);
	const dragCleanupRef = useRef<(() => void) | null>(null);
	const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
	onCloseRef.current = onClose;

	const stopDragging = useCallback(() => {
		dragRef.current = null;
		dragCleanupRef.current?.();
		dragCleanupRef.current = null;
	}, []);

	const handleHeaderMouseDown = (event: ReactMouseEvent<Element>) => {
		if (
			!draggable
			|| event.button !== 0
			|| (event.target instanceof Element
				&& event.target.closest('button, input, select, textarea, a'))
		) return;
		event.preventDefault();
		stopDragging();
		dragRef.current = {
			startX: event.clientX,
			startY: event.clientY,
			startOffset: dragOffset,
		};
		const handleMouseMove = (moveEvent: MouseEvent) => {
			const drag = dragRef.current;
			if (!drag) return;
			setDragOffset({
				x: drag.startOffset.x + moveEvent.clientX - drag.startX,
				y: drag.startOffset.y + moveEvent.clientY - drag.startY,
			});
		};
		const handleMouseUp = () => stopDragging();
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
		dragCleanupRef.current = () => {
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
		};
	};

	useEffect(() => () => stopDragging(), [stopDragging]);
	useEffect(() => {
		if (!isOpen) {
			stopDragging();
			setDragOffset({ x: 0, y: 0 });
		}
	}, [isOpen, stopDragging]);

	useLayoutEffect(() => {
		if (!isOpen) return undefined;
		const previouslyFocused = resolveEditorReturnFocus(document, document.activeElement);
		const panel = panelRef.current;
		const focusableElements = () => [...(panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) || [])]
			.filter((element) => !element.closest('[hidden], [aria-hidden="true"], [inert]'));
		const frame = requestAnimationFrame(() => {
			(resolveInitialFocus(panel, initialFocus, focusableElements) || panel)?.focus({ preventScroll: true });
		});
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && closeOnEscape) {
				event.preventDefault();
				onCloseRef.current?.();
				return;
			}
			if (!modal || event.key !== 'Tab' || !panel) return;
			const focusable = focusableElements();
			if (!focusable.length) {
				event.preventDefault();
				panel.focus({ preventScroll: true });
				return;
			}
			const first = focusable[0];
			const last = focusable.at(-1) || first;
			if (!panel.contains(document.activeElement)) {
				event.preventDefault();
				(event.shiftKey ? last : first).focus({ preventScroll: true });
			} else if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus({ preventScroll: true });
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus({ preventScroll: true });
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener('keydown', handleKeyDown);
			if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
				previouslyFocused.focus({ preventScroll: true });
			}
		};
	}, [closeOnEscape, initialFocus, isOpen, modal]);

	if (!isOpen) return null;
	const overlayClasses = overlayClassName || [
		'kw-audio-editor-dialog-backdrop',
		'audio-editor-controlled-dialog__backdrop',
		modal ? '' : 'audio-editor-controlled-dialog__backdrop--non-modal',
	].filter(Boolean).join(' ');
	const panelClasses = [
		'kw-audio-editor-dialog',
		'audio-editor-controlled-dialog',
		draggable ? 'audio-editor-controlled-dialog--draggable' : '',
		className,
	].filter(Boolean).join(' ');
	const resolvedWidth = typeof width === 'number' ? `${width}px` : width;
	const headerProps = headerOs ? { os: headerOs } : {};
	const body = wrapBody
		? <div className={bodyClassName}>{children}</div>
		: children;

	return (
		<div
			className={overlayClasses}
			onMouseDown={(event) => {
				if (modal && closeOnOutside && event.target === event.currentTarget) onCloseRef.current?.();
			}}
			{...overlayDataAttributes}
		>
			<ResizableSurface
				ref={panelRef}
				tabIndex={-1}
				className={panelClasses}
				role="dialog"
				{...(modal ? { 'aria-modal': 'true' } : {})}
				aria-label={title}
				aria-describedby={ariaDescribedBy}
				resizeLabel={resizeLabel}
				style={{
					width: `min(${resolvedWidth}, calc(100vw - 32px))`,
					transform: draggable ? `translate(${dragOffset.x}px, ${dragOffset.y}px)` : undefined,
					...style,
				}}
				{...dataAttributes}
			>
				<DialogHeader
					title={headerTitle}
					{...headerProps}
					onClose={onClose}
					onMouseDown={handleHeaderMouseDown}
				/>
				{headerSlot}
				{body}
				{footer}
			</ResizableSurface>
		</div>
	);
}

function resolveInitialFocus(
	panel: HTMLElement | null,
	initialFocus: InitialFocus,
	focusableElements: () => HTMLElement[],
): HTMLElement | null {
	if (!panel || initialFocus === 'dialog') return panel;
	if (initialFocus === 'first') return focusableElements()[0] || panel;
	try {
		return panel.querySelector<HTMLElement>(initialFocus) || focusableElements()[0] || panel;
	} catch {
		return focusableElements()[0] || panel;
	}
}
