/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useState } from 'react';

interface PreferenceNumberInputProps {
	readonly label: string;
	readonly value: number;
	readonly minimum: number;
	readonly maximum: number;
	readonly disabled?: boolean;
	readonly onCommit: (value: number) => unknown;
}

/** Retain incomplete keystrokes until the user commits a bounded number. */
export default function PreferenceNumberInput({
	label, value, minimum, maximum, disabled, onCommit,
}: PreferenceNumberInputProps) {
	const [draft, setDraft] = useState(String(value));
	useEffect(() => setDraft(String(value)), [value]);
	const commit = () => {
		const next = Number(draft);
		if (!draft.trim() || !Number.isFinite(next) || next < minimum || next > maximum) {
			setDraft(String(value));
			return;
		}
		if (next !== value) onCommit(next);
	};
	return <input aria-label={label} disabled={disabled} type="number" min={minimum} max={maximum}
		step="1" value={draft} onChange={(event) => setDraft(event.currentTarget.value)}
		onBlur={commit} onKeyDown={(event) => {
			if (event.key !== 'Enter') return;
			event.preventDefault();
			event.currentTarget.blur();
		}} />;
}
