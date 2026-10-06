/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';

/** Keep an omitted or canceled recording-alignment draft out of saved settings. */
export default function RecordingOffsetInput({ value, label, onCommit }: Readonly<{
	readonly value: number;
	readonly label: string;
	readonly onCommit: (value: number) => unknown;
}>) {
	const [draft, setDraft] = useState(String(value));
	const canceled = useRef(false);
	useEffect(() => { setDraft(String(value)); }, [value]);
	const commit = (): void => {
		if (canceled.current) { canceled.current = false; return; }
		const offset = Number(draft);
		if (!draft.trim() || !Number.isFinite(offset)) {
			setDraft(String(value));
			return;
		}
		const bounded = Math.max(-500, Math.min(500, offset));
		setDraft(String(bounded));
		if (bounded !== value) onCommit(bounded);
	};
	return <input aria-label={label} type="number" min="-500" max="500" step="any" value={draft}
		onChange={(event) => { canceled.current = false; setDraft(event.currentTarget.value); }}
		onBlur={commit} onKeyDown={(event) => {
			if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			canceled.current = true;
			setDraft(String(value));
		}} />;
}
