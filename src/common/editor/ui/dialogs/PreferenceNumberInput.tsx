/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';

interface PreferenceNumberInputProps {
	readonly label: string;
	readonly value: number;
	readonly minimum: number;
	readonly maximum: number;
	readonly disabled?: boolean;
	readonly integer?: boolean;
	readonly dataAttributes?: Readonly<Record<`data-${string}`, string>>;
	readonly onCommit: (value: number) => unknown;
}

/** Retain incomplete keystrokes until the user commits a bounded number. */
export default function PreferenceNumberInput({
	label, value, minimum, maximum, disabled, integer = false, dataAttributes, onCommit,
}: PreferenceNumberInputProps) {
	const [draft, setDraft] = useState(String(value));
	const canceled = useRef(false);
	useEffect(() => { canceled.current = false; setDraft(String(value)); }, [value]);
	const commit = () => {
		if (canceled.current) { canceled.current = false; return; }
		const next = Number(draft);
		if (!draft.trim() || !Number.isFinite(next) || (integer && !Number.isSafeInteger(next)) || next < minimum || next > maximum) {
			setDraft(String(value));
			return;
		}
		if (next !== value) onCommit(next);
	};
	return <input aria-label={label} disabled={disabled} type="number" min={minimum} max={maximum}
		step="1" {...dataAttributes} value={draft} onChange={(event) => { canceled.current = false; setDraft(event.currentTarget.value); }}
		onBlur={commit} onKeyDown={(event) => {
			if (event.nativeEvent?.isComposing) return;
			if (event.key === 'Escape' && draft !== String(value)) {
				event.preventDefault();
				event.stopPropagation();
				canceled.current = true;
				setDraft(String(value));
				return;
			}
			if (event.key !== 'Enter') return;
			event.preventDefault();
			event.currentTarget.blur();
		}} />;
}
