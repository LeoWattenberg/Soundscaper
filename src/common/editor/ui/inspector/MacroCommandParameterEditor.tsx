/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import {
	createMacroCommandStep, macroCommandStepProfile, type MacroCommandStep,
} from '../../macro-command-steps.ts';
import type { MacroCommandParameterDescriptor } from '../../audacity-macro-select-commands.ts';

interface Props {
	readonly step: MacroCommandStep;
	readonly onChange: (step: MacroCommandStep) => void;
}

/** Commands retain their optional parameters instead of entering the effect editor. */
export default function MacroCommandParameterEditor({ step, onChange }: Props) {
	const params = macroCommandStepProfile(step.command)?.params ?? [];
	const update = (name: string, value: unknown): void => {
		const next = { ...step.params };
		if (value === undefined) delete next[name];
		else next[name] = value;
		onChange(createMacroCommandStep(step.command, { ...step, params: next }));
	};
	return <div className="audio-editor-effect-settings">
		{params.map((descriptor) => descriptor.kind === 'number'
			? <CommandNumber key={descriptor.model} descriptor={descriptor}
				value={step.params[descriptor.model]} onChange={(value) => update(descriptor.model, value)} />
			: <label key={descriptor.model} className="audio-editor-field">
				<span>{descriptor.native}</span>
				<select value={String(step.params[descriptor.model] ?? '')}
					onChange={(event) => update(descriptor.model, event.currentTarget.value || undefined)}>
					<option value="">—</option>
					{descriptor.values?.map((value) => <option key={value} value={value}>{descriptor.encode?.(value) ?? value}</option>)}
				</select>
			</label>)}
	</div>;
}

function CommandNumber({ descriptor, value, onChange }: Readonly<{
	descriptor: MacroCommandParameterDescriptor;
	value: unknown;
	onChange(value: number | undefined): void;
}>) {
	const current = String(value ?? '');
	const [draft, setDraft] = useState(current);
	const cancelled = useRef(false);
	useEffect(() => setDraft(current), [current]);
	return <label className="audio-editor-field">
		<span>{descriptor.native}</span>
		<input type="number" step="any" min={descriptor.minimum} max={descriptor.maximum} value={draft}
			onChange={(event) => setDraft(event.currentTarget.value)}
			onBlur={() => {
				if (cancelled.current) { cancelled.current = false; return; }
				if (!draft.trim()) { onChange(undefined); return; }
				const next = Number(draft);
				if (Number.isFinite(next) && next >= (descriptor.minimum ?? -Infinity)
					&& next <= (descriptor.maximum ?? Infinity)) onChange(next);
				else setDraft(current);
			}}
		onKeyDown={(event) => {
			if (event.nativeEvent?.isComposing) return;
			if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					cancelled.current = true;
					setDraft(current);
					event.currentTarget.blur();
				} else if (event.key === 'Enter') {
					event.preventDefault();
					event.currentTarget.blur();
				}
			}} />
	</label>;
}
