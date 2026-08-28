/* SPDX-License-Identifier: AGPL-3.0-only */

import React from 'react';

export function ParametricEqNumericInput({ value, onCommit, disabled, min, max, step }) {
	const formattedValue = String(roundForInput(value));
	const [text, setText] = React.useState(formattedValue);
	const editingRef = React.useRef(false);
	const cancelRef = React.useRef(false);

	React.useEffect(() => {
		if (!editingRef.current) setText(formattedValue);
	}, [formattedValue]);

	const finish = () => {
		editingRef.current = false;
		const result = resolveParametricEqNumericCommit(text, formattedValue, cancelRef.current);
		cancelRef.current = false;
		if (!result.commit) {
			setText(result.replacement);
			return;
		}
		onCommit?.(result.value);
	};

	return React.createElement('input', {
		disabled,
		type: 'number',
		inputMode: 'decimal',
		min,
		max,
		step,
		value: text,
		onFocus: () => { editingRef.current = true; },
		onChange: (event) => setText(event.currentTarget.value),
		onBlur: finish,
		onKeyDown: (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				event.currentTarget.blur();
			} else if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				cancelRef.current = true;
				event.currentTarget.blur();
			}
		},
	});
}

export function resolveParametricEqNumericCommit(text, formattedValue, cancelled) {
	if (cancelled) return { commit: false, replacement: formattedValue };
	const number = Number(text);
	if (!text.trim() || !Number.isFinite(number)) {
		return { commit: false, replacement: formattedValue };
	}
	return { commit: true, value: number };
}

function roundForInput(value) {
	return Math.round(Number(value) * 100) / 100;
}
