/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * The field primitives the generator dialog lays out. They live beside it
 * rather than inside it because each one exists to bolt the accessible name,
 * keyboard behaviour and draft handling the dialog needs onto a design-system
 * control, and that plumbing has nothing to say about any one generator.
 */

import { useEffect, useRef, useState } from 'react';
import { Dropdown } from '@soundscaper/design-system/Dropdown';
import { Knob } from '@soundscaper/design-system/Knob';
import { LabeledRadio } from '@soundscaper/design-system/LabeledRadio';
import { NumberStepper } from '@soundscaper/design-system/NumberStepper';

export function GeneratorNumberField({ name, label, ariaLabel = label, value, min, max, step, onChange }) {
	const inputRef = useRef(null);
	const valueRef = useRef(value);
	const [draft, setDraft] = useState(() => String(value));
	valueRef.current = value;
	useEffect(() => {
		const input = inputRef.current;
		if (!input) return undefined;
		input.setAttribute('aria-label', ariaLabel);
		const handleBlur = () => {
			setDraft((current) => current.trim() && Number.isFinite(Number(current)) ? current : String(valueRef.current));
		};
		input.addEventListener('blur', handleBlur);
		return () => input.removeEventListener('blur', handleBlur);
	}, [ariaLabel]);
	useEffect(() => {
		if (document.activeElement !== inputRef.current) setDraft(String(value));
	}, [value]);
	return (
		<label className="kw-audio-editor-dialog__field" data-generator-field={name}>
			<span>{label}</span>
			<NumberStepper
				ref={inputRef}
				value={draft}
				min={min}
				max={max}
				step={step}
				width="100%"
				onChange={(next) => {
					setDraft(next);
					if (next.trim() && Number.isFinite(Number(next))) onChange(Number(next));
				}}
			/>
		</label>
	);
}

export function GeneratorSelect({ label, value, disabled = false, onChange, options }) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		wrapperRef.current?.querySelector('.dropdown__trigger')?.setAttribute('aria-label', label);
	}, [label]);
	return (
		<div ref={wrapperRef} className="kw-audio-editor-dialog__field" data-generator-field={label} role="group" aria-label={label}>
			<span>{label}</span>
			<Dropdown
				disabled={disabled}
				value={value}
				onChange={onChange}
				options={options.map(([id, text]) => ({ value: id, label: text }))}
				width="100%"
			/>
		</div>
	);
}

export function GeneratorRadioGroup({ label, value, onChange, options }) {
	const groupRef = useRef(null);
	useEffect(() => {
		const radios = [...(groupRef.current?.querySelectorAll('[role="radio"]') || [])];
		radios.forEach((radio, index) => {
			radio.setAttribute('aria-label', options[index][1]);
			radio.setAttribute('tabindex', options[index][0] === value ? '0' : '-1');
		});
	}, [options, value]);
	const selectAndFocus = (nextValue) => {
		onChange(nextValue);
		queueMicrotask(() => groupRef.current?.querySelector(`[data-generator-radio-value="${nextValue}"] [role="radio"]`)?.focus());
	};
	return (
		<div
			ref={groupRef}
			className="kw-audio-editor-generator__radio-group"
			role="radiogroup"
			aria-label={label}
			onKeyDown={(event) => {
				if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
				event.preventDefault();
				const currentIndex = Math.max(0, options.findIndex(([id]) => id === value));
				const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
				const nextIndex = (currentIndex + direction + options.length) % options.length;
				selectAndFocus(options[nextIndex][0]);
			}}
		>
			{options.map(([id, text]) => (
				<div
					key={id}
					className="kw-audio-editor-generator__radio-option"
					data-generator-radio-value={id}
					onClick={(event) => {
						if (!event.target.closest('[role="radio"]')) selectAndFocus(id);
					}}
				>
					<LabeledRadio label={text} name="generator-interpolation" value={id} checked={value === id} tabIndex={value === id ? 0 : -1} onChange={() => onChange(id)} />
				</div>
			))}
		</div>
	);
}

export function GeneratorKnob({ value, label, minimum = 1, maximum = 100, onChange }) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		const knob = wrapperRef.current?.querySelector('.knob');
		if (!knob) return undefined;
		knob.setAttribute('type', 'button');
		const handleKeyDown = (event) => {
			if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
			event.preventDefault();
			if (event.key === 'Home') onChange(minimum);
			else if (event.key === 'End') onChange(maximum);
			else onChange(Math.max(minimum, Math.min(maximum, value + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1))));
		};
		knob.addEventListener('keydown', handleKeyDown);
		return () => knob.removeEventListener('keydown', handleKeyDown);
	}, [maximum, minimum, onChange, value]);
	return (
		<div ref={wrapperRef} className="kw-audio-editor-generator__knob">
			<Knob value={value} min={minimum} max={maximum} step={1} label={label} mode="unipolar" onChange={onChange} />
		</div>
	);
}
