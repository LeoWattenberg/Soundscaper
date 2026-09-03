/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef } from 'react';
import { LabeledCheckbox } from '@soundscaper/design-system/LabeledCheckbox';

interface PreferenceCheckboxProps {
	readonly label: string;
	readonly ariaDescribedBy?: string;
	readonly checked: boolean;
	readonly disabled?: boolean;
	readonly onChange: (checked: boolean) => void;
}

type Schedule = (callback: () => void) => void;

/** Coalesce the vendor wrapper and inner-control callbacks for one gesture. */
export function createCheckboxChangeCoalescer(
	publish: (checked: boolean) => void,
	schedule: Schedule = queueMicrotask,
): (checked: boolean) => void {
	let pending: boolean | null = null;
	return (checked) => {
		if (pending === checked) return;
		pending = checked;
		schedule(() => { pending = null; });
		publish(checked);
	};
}

export default function PreferenceCheckbox({
	label,
	ariaDescribedBy,
	checked,
	disabled = false,
	onChange,
}: PreferenceCheckboxProps) {
	const publishRef = useRef(onChange);
	const changeRef = useRef<((next: boolean) => void) | null>(null);
	publishRef.current = onChange;
	changeRef.current ??= createCheckboxChangeCoalescer((next) => publishRef.current(next));
	return (
		<LabeledCheckbox
			label={label}
			aria-describedby={ariaDescribedBy}
			checked={checked}
			disabled={disabled}
			onChange={changeRef.current}
		/>
	);
}
