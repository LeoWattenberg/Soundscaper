import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';

const RESIZE_STEP = 16;

/**
 * Editor-owned dialog frame with a mouse and keyboard accessible resize grip.
 * Keeping this separate from the design-system Dialog avoids inheriting its
 * fixed geometry while giving every editor window the same resize behavior.
 */
const AudioEditorResizableSurface = React.forwardRef(function AudioEditorResizableSurface({
	children,
	className = '',
	resizeLabel = 'Resize window',
	minWidth = 280,
	minHeight = 160,
	style,
	...props
}, forwardedRef) {
	const surfaceRef = useRef(null);
	const dragRef = useRef(null);
	const [isResizing, setIsResizing] = useState(false);
	const [size, setSize] = useState(null);
	useImperativeHandle(forwardedRef, () => surfaceRef.current);

	const resizeTo = (width, height) => {
		const surface = surfaceRef.current;
		if (!surface) return;
		const rect = surface.getBoundingClientRect();
		const maxWidth = Math.max(minWidth, window.innerWidth - rect.left - 8);
		const maxHeight = Math.max(minHeight, window.innerHeight - rect.top - 8);
		setSize({
			width: Math.round(Math.max(minWidth, Math.min(maxWidth, width))),
			height: Math.round(Math.max(minHeight, Math.min(maxHeight, height))),
		});
	};

	useEffect(() => {
		if (!isResizing) return undefined;
		const handleMouseMove = (event) => {
			const drag = dragRef.current;
			if (!drag) return;
			resizeTo(
				drag.width + event.clientX - drag.x,
				drag.height + event.clientY - drag.y,
			);
		};
		const handleMouseUp = () => {
			dragRef.current = null;
			setIsResizing(false);
		};
		document.addEventListener('mousemove', handleMouseMove);
		document.addEventListener('mouseup', handleMouseUp);
		return () => {
			document.removeEventListener('mousemove', handleMouseMove);
			document.removeEventListener('mouseup', handleMouseUp);
		};
	}, [isResizing, minHeight, minWidth]);

	return (
		<section
			ref={surfaceRef}
			className={`${className}${isResizing ? ' audio-editor-resizable-surface--resizing' : ''}`}
			style={{
				...style,
				...(size ? { width: `${size.width}px`, height: `${size.height}px` } : null),
			}}
			{...props}
		>
			{children}
			<div
				className="audio-editor-resize-handle"
				data-resize-handle
				role="button"
				tabIndex={0}
				aria-label={resizeLabel}
				onMouseDown={(event) => {
					if (event.button !== 0 || !surfaceRef.current) return;
					event.preventDefault();
					const rect = surfaceRef.current.getBoundingClientRect();
					dragRef.current = {
						x: event.clientX,
						y: event.clientY,
						width: rect.width,
						height: rect.height,
					};
					setIsResizing(true);
				}}
				onKeyDown={(event) => {
					const rect = surfaceRef.current?.getBoundingClientRect();
					if (!rect || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
					event.preventDefault();
					resizeTo(
						rect.width + (event.key === 'ArrowRight' ? RESIZE_STEP : event.key === 'ArrowLeft' ? -RESIZE_STEP : 0),
						rect.height + (event.key === 'ArrowDown' ? RESIZE_STEP : event.key === 'ArrowUp' ? -RESIZE_STEP : 0),
					);
				}}
			/>
		</section>
	);
});

export default AudioEditorResizableSurface;
