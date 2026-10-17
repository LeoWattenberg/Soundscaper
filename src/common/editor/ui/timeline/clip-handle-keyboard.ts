/* SPDX-License-Identifier: AGPL-3.0-only */

import { END_FADE_SHAPE_PRESETS } from '../../clip-fade-presets.ts';
import { fadeField, fadeShapeField, fadeShapeAtPointer, type ClipFadeEdge, type FadeClip } from './clip-fade-geometry.ts';
import { clipFadeLengthChange, nearestClipEdge } from './clip-fade-edit.ts';

interface KeyEvent {
	readonly target: EventTarget | null;
	readonly key: string;
	readonly code?: string;
	readonly altKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly shiftKey: boolean;
	readonly defaultPrevented?: boolean;
	readonly isComposing?: boolean;
	readonly nativeEvent?: { readonly isComposing?: boolean; readonly keyCode?: number };
	preventDefault(): void;
	stopPropagation(): void;
}
interface Clip extends FadeClip { readonly id: string; readonly kind?: string; }
type Family = 'fade' | 'trim' | 'stretch';
type Edge = 'left' | 'right';

interface Ports {
	readonly clips: readonly Clip[];
	readonly sampleRate: number;
	readonly blocked: boolean;
	readonly selectedIds: readonly string[];
	readonly playheadFrame: number;
	updateFade(id: string, changes: Readonly<{ fadeInFrames?: number; fadeOutFrames?: number; fadeInShape?: number; fadeOutShape?: number }>, editedEdge?: ClipFadeEdge): void;
	trim(id: string, edge: Edge, seconds: number): void;
	stretch(id: string, edge: Edge, seconds: number): void;
	seek(frame: number): void;
	openFades(id: string): void;
}

function baseKey(event: Pick<KeyEvent, 'code' | 'key'>): string {
	if (event.code?.startsWith('Key')) return event.code.slice(3).toLowerCase();
	if (event.code === 'BracketLeft') return '[';
	if (event.code === 'BracketRight') return ']';
	return event.key.toLowerCase();
}

/** Keep context keys ahead of global commands; editable fields and menus retain their keys. */
export function clipInteractionOwnsKey(event: Omit<KeyEvent, 'preventDefault' | 'stopPropagation'>): boolean {
	const target = event.target as Element | null;
	if (!target?.closest || target.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')) return false;
	const clip = target.closest('[data-clip-id]');
	if (!clip) return false;
	const key = baseKey(event);
	if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) return key === '[' || key === ']';
	if (event.ctrlKey || event.metaKey) return false;
	if (event.altKey) return ['f', 't', 's', '[', ']'].includes(key);
	if (!event.shiftKey && ['f', 't', 's'].includes(key)) return true;
	return Boolean(target.closest('[data-clip-fade-handle], [data-clip-fade-shape-handle], .clip-display__handle'))
		&& ['escape', 'tab', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'delete', 'backspace', '0', '1', '2', '3', '4', '5'].includes(key);
}

function currentHandle(target: HTMLElement): { family: Family; edge: Edge } | null {
	if (target.dataset.clipFadeHandle || target.dataset.clipFadeShapeHandle) return {
		family: 'fade', edge: (target.dataset.clipFadeHandle ?? target.dataset.clipFadeShapeHandle) === 'in' ? 'left' : 'right',
	};
	for (const family of ['trim', 'stretch'] as const) for (const edge of ['left', 'right'] as const) {
		if ((target.getAttribute('class') ?? '').split(/\s+/u).includes(`clip-display__handle--${family}-${edge}`)) return { family, edge };
	}
	return null;
}

function handleSelector(family: Family, edge: Edge): string {
	return family === 'fade' ? `[data-clip-fade-handle="${edge === 'left' ? 'in' : 'out'}"]`
		: `.clip-display__handle--${family}-${edge}`;
}

const heldHandleRelease = new WeakMap<Document, () => void>();

/** Hold a keyboard control through its menu, releasing it when focus leaves. */
function holdKeyboardHandle(clipElement: HTMLElement, handle: HTMLElement): void {
	const document = handle.ownerDocument;
	heldHandleRelease.get(document)?.();
	const release = () => {
		delete handle.dataset.keyboardHandle;
		delete handle.dataset.handleSecond;
		document.removeEventListener('focusin', onFocus);
		heldHandleRelease.delete(document);
	};
	const onFocus = (event: FocusEvent) => {
		const target = event.target as Element | null;
		if (!target || clipElement.contains(target) || target.closest('[role="menu"], [role="dialog"]')) return;
		release();
	};
	heldHandleRelease.set(document, release);
	document.addEventListener('focusin', onFocus);
	handle.dataset.keyboardHandle = 'true';
}

/** F/T/S hold one edge at a time; the third press returns to the clip. */
function focusHandle(clipElement: HTMLElement, family: Family, edge: Edge, second: boolean): boolean {
	const handle = clipElement.querySelector<HTMLButtonElement>(handleSelector(family, edge));
	if (!handle || handle.disabled) return false;
	holdKeyboardHandle(clipElement, handle);
	handle.dataset.handleSecond = second ? 'true' : 'false';
	handle.focus({ preventScroll: true });
	return true;
}

/** Presentation adapter for upstream 20ce5547's clip/handle keyboard rules. */
export function routeClipHandleKeyboard(event: KeyEvent, ports: Ports): boolean {
	if (event.defaultPrevented || event.isComposing || event.nativeEvent?.isComposing || event.nativeEvent?.keyCode === 229) return false;
	const target = event.target as HTMLElement | null;
	const clipElement = target?.closest<HTMLElement>('[data-clip-id]');
	if (!target || !clipElement || target.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')) return false;
	const focused = ports.clips.find(clip => clip.id === clipElement.dataset.clipId);
	if (!focused) return false;
	const handle = currentHandle(target);
	const key = baseKey(event);
	const stop = () => { event.preventDefault(); event.stopPropagation(); return true; };
	const returnToClip = () => {
		heldHandleRelease.get(target.ownerDocument)?.();
		clipElement.focus({ preventScroll: true });
	};
	if (!handle && event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
		&& ports.selectedIds.includes(focused.id)) { ports.seek(focused.timelineStartFrame); return stop(); }
	if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && ['[', ']'].includes(key)) {
		ports.seek(focused.timelineStartFrame + (key === ']' ? focused.durationFrames : 0)); return stop();
	}
	if (event.ctrlKey || event.metaKey) return false;
	if (event.altKey && ['f', 't', 's', '[', ']'].includes(key)) {
		if (ports.blocked) return stop();
		const clip = handle ? focused : ports.clips.find(clip => ports.playheadFrame >= clip.timelineStartFrame
			&& ports.playheadFrame < clip.timelineStartFrame + clip.durationFrames);
		if (!clip || clip.kind !== 'audio') return stop();
		if (key === 'f' && event.shiftKey) { ports.openFades(clip.id); return stop(); }
		if (event.shiftKey) return false;
		const edge = handle?.edge ?? (key === '[' ? 'left' : key === ']' ? 'right' : nearestClipEdge(clip, ports.playheadFrame));
		const seconds = (edge === 'left' ? ports.playheadFrame - clip.timelineStartFrame
			: clip.timelineStartFrame + clip.durationFrames - ports.playheadFrame) / ports.sampleRate;
		if (key === 'f') ports.updateFade(clip.id, clipFadeLengthChange(clip, edge === 'left' ? 'in' : 'out', seconds * ports.sampleRate, ports.sampleRate), edge === 'left' ? 'in' : 'out');
		else (key === 's' ? ports.stretch : ports.trim)(clip.id, edge, seconds);
		return stop();
	}
	if (event.altKey) return false;
	if (handle && event.key === 'Escape') { returnToClip(); return stop(); }
	if (handle && event.key === 'Tab') {
		returnToClip();
		clipElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: event.shiftKey, bubbles: true, cancelable: true }));
		return stop();
	}
	if (!event.shiftKey && ['f', 't', 's'].includes(key)) {
		if (ports.blocked || focused.kind !== 'audio') return stop();
		const family: Family = key === 'f' ? 'fade' : key === 't' ? 'trim' : 'stretch';
		if (handle?.family === family && target.dataset.handleSecond === 'true') { returnToClip(); return stop(); }
		const edge = handle?.edge ?? nearestClipEdge(focused, ports.playheadFrame);
		const next = handle?.family === family ? edge === 'left' ? 'right' : 'left' : edge;
		if (focusHandle(clipElement, family, next, handle?.family === family)) return stop();
		// Automatic crossfades own their joined edge; keep the free edge reachable.
		if (!handle && family === 'fade' && focusHandle(clipElement, family, next === 'left' ? 'right' : 'left', false)) return stop();
		if (handle?.family === family) { returnToClip(); return stop(); }
		return false;
	}
	if (!handle) return false;
	if (ports.blocked) return stop();
	if (handle.family !== 'fade') {
		if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return false;
		const later = event.key === 'ArrowRight';
		const seconds = (event.shiftKey ? 1 : 0.1) * ((handle.edge === 'left') === later ? 1 : -1);
		ports[handle.family](focused.id, handle.edge, seconds);
		return stop();
	}
	const edge: ClipFadeEdge = handle.edge === 'left' ? 'in' : 'out';
	const field = fadeField(edge);
	const shapeField = fadeShapeField(edge);
	if (event.key === 'Delete' || event.key === 'Backspace') { ports.updateFade(focused.id, { [field]: 0 }, edge); return stop(); }
	if (/^[0-5]$/u.test(key)) {
		ports.updateFade(focused.id, { [shapeField]: key === '0' ? 2 : END_FADE_SHAPE_PRESETS[Number(key) - 1]?.shape }); return stop();
	}
	if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
		const later = event.key === 'ArrowRight';
		const delta = Math.round(ports.sampleRate * (event.shiftKey ? 1 : 0.1)) * ((edge === 'in') === later ? 1 : -1);
		ports.updateFade(focused.id, clipFadeLengthChange(focused, edge, (focused[field] ?? 0) + delta, ports.sampleRate), edge); return stop();
	}
	if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
		if ((focused[field] ?? 0) > 0) {
			const shape = focused[shapeField] ?? 2;
			const gain = focused[shapeField] === undefined ? 0.5 : Math.SQRT1_2 ** shape;
			const step = event.shiftKey ? 0.2 : 0.05;
			ports.updateFade(focused.id, { [shapeField]: fadeShapeAtPointer(shape, 0, (event.key === 'ArrowUp' ? -step : step), 1, Math.SQRT1_2, gain) });
		}
		return stop();
	}
	return false;
}
