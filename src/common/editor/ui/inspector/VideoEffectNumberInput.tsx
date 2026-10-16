/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';

export default function VideoEffectNumberInput({ value, minimum, maximum, step, label, disabled,
	onBegin, onPreview, onCommit, onCancel }: Readonly<{
	value: number;
	minimum: number;
	maximum: number;
	step: number;
	label: string;
	disabled: boolean;
	onBegin: () => void;
	onPreview: (value: number) => void;
	onCommit: () => void;
	onCancel: () => void;
}>) {
	const [draft, setDraft] = useState(() => String(value));
	const active = useRef(false);
	const original = useRef(value);
	const pointerOwner = useRef<number | null>(null);
	useEffect(() => { if (!active.current) setDraft(String(value)); }, [value]);
	const begin = () => {
		if (disabled || active.current) return;
		original.current = value;
		active.current = true;
		onBegin();
	};
	const cancel = () => {
		if (!active.current) return;
		active.current = false;
		onCancel();
		setDraft(String(original.current));
	};
	const commit = () => {
		if (!active.current) return;
		const number = draft.trim() ? Number(draft) : Number.NaN;
		if (!Number.isFinite(number)) { cancel(); return; }
		active.current = false;
		onCommit();
		// Preview may normalize integer or bounded parameters before commit.
		setDraft(String(value));
	};
	const finishPointer = (pointerId: number): boolean => {
		if (pointerOwner.current !== pointerId) return false;
		pointerOwner.current = null;
		return true;
	};
	return <input type="number" value={draft} min={minimum} max={maximum} step={step}
		aria-label={label} disabled={disabled} onFocus={begin} onPointerDown={(event) => {
			if (disabled || event.button !== 0) return;
			if (event.isPrimary === false || pointerOwner.current !== null) { event.preventDefault(); return; }
			pointerOwner.current = event.pointerId;
			event.currentTarget.setPointerCapture?.(event.pointerId);
			begin();
		}}
		onChange={(event) => {
			begin();
			setDraft(event.currentTarget.value);
			if (Number.isFinite(event.currentTarget.valueAsNumber)) onPreview(event.currentTarget.valueAsNumber);
		}} onPointerUp={(event) => { if (finishPointer(event.pointerId)) commit(); }}
		onPointerCancel={(event) => { if (finishPointer(event.pointerId)) cancel(); }}
		onLostPointerCapture={(event) => { if (finishPointer(event.pointerId)) cancel(); }}
		onBlur={commit} onKeyDown={(event) => {
			if (event.nativeEvent?.isComposing) return;
			if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
			else if (event.key === 'Enter') { event.preventDefault(); commit(); }
		}} />;
}
