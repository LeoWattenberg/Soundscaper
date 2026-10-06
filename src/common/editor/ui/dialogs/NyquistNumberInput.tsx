/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';

/** Nyquist bindings receive complete numbers while the field retains its draft. */
export default function NyquistNumberInput({ value, minimum, maximum, integer, disabled, onChange }: Readonly<{
	value: number;
	minimum?: number;
	maximum?: number;
	integer: boolean;
	disabled: boolean;
	onChange: (value: number) => void;
}>) {
	const [draft, setDraft] = useState(String(value));
	const active = useRef(false);
	const original = useRef(value);
	useEffect(() => { if (!active.current) setDraft(String(value)); }, [value]);
	const begin = () => {
		if (active.current || disabled) return;
		active.current = true;
		original.current = value;
	};
	const normalize = (number: number) => Math.max(minimum ?? -Infinity,
		Math.min(maximum ?? Infinity, integer ? Math.round(number) : number));
	const cancel = () => {
		if (!active.current) return;
		active.current = false;
		onChange(original.current);
		setDraft(String(original.current));
	};
	const commit = () => {
		if (!active.current) return;
		const number = draft.trim() ? Number(draft) : Number.NaN;
		if (!Number.isFinite(number)) { cancel(); return; }
		active.current = false;
		const next = normalize(number);
		onChange(next);
		setDraft(String(next));
	};
	return <input type="number" value={draft} disabled={disabled} min={minimum} max={maximum}
		step={integer ? 1 : 'any'} onFocus={begin} onBlur={commit}
		onChange={event => {
			begin();
			setDraft(event.currentTarget.value);
			const number = event.currentTarget.valueAsNumber;
			if (Number.isFinite(number) && number >= (minimum ?? -Infinity)
				&& number <= (maximum ?? Infinity)) onChange(integer ? Math.round(number) : number);
		}} onKeyDown={event => {
			if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
			else if (event.key === 'Enter') { event.preventDefault(); commit(); }
		}} />;
}
