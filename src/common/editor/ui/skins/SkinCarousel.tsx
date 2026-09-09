/* SPDX-License-Identifier: AGPL-3.0-only */
import React, { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/** Browsing moves the viewport/focus only; the existing buttons own selection. */
export default function SkinCarousel({ current, copy, children }: {
	current: string;
	copy: Record<string, string>;
	children: ReactNode;
}) {
	const viewport = useRef<HTMLDivElement>(null);
	const id = useId();
	const [edges, setEdges] = useState({ start: true, end: false });
	const updateEdges = () => {
		const element = viewport.current;
		if (!element) return;
		const position = Math.abs(element.scrollLeft);
		const start = position < 1;
		const end = position >= element.scrollWidth - element.clientWidth - 1;
		setEdges((previous) => previous.start === start && previous.end === end ? previous : { start, end });
	};
	useLayoutEffect(() => {
		const element = viewport.current;
		if (!element) return;
		element.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		updateEdges();
		const observer = new ResizeObserver(updateEdges);
		observer.observe(element);
		return () => { observer.disconnect(); };
	}, [current]);
	const browse = (step: number) => {
		const element = viewport.current;
		if (!element) return;
		const direction = getComputedStyle(element).direction === 'rtl' ? -1 : 1;
		element.scrollBy({ left: direction * step * element.clientWidth * 0.8, behavior: 'instant' });
	};
	const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
		const element = viewport.current;
		if (!element || !(event.target instanceof HTMLButtonElement)) return;
		const buttons = Array.from(element.querySelectorAll<HTMLButtonElement>('button'));
		const index = buttons.indexOf(event.target);
		const forward = getComputedStyle(element).direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
		const backward = forward === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
		const target = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
			: event.key === forward ? index + 1 : event.key === backward ? index - 1 : null;
		if (target === null) return;
		event.preventDefault();
		buttons[Math.max(0, Math.min(buttons.length - 1, target))]?.focus();
	};
	return <div className="editor-skin-carousel" role="group" aria-label={copy.skin} aria-roledescription={copy.skinCarousel}>
		<button type="button" className="editor-skin-carousel__step" aria-label={copy.skinPrevious} aria-controls={id}
			disabled={edges.start} onClick={() => { browse(-1); }}><span aria-hidden="true">‹</span></button>
		<div ref={viewport} id={id} className="editor-skin-choices" onScroll={updateEdges} onKeyDown={navigate}>
			{children}
		</div>
		<button type="button" className="editor-skin-carousel__step" aria-label={copy.skinNext} aria-controls={id}
			disabled={edges.end} onClick={() => { browse(1); }}><span aria-hidden="true">›</span></button>
	</div>;
}
