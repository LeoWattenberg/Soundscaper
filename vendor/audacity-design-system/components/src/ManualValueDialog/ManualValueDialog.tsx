/** Manual numeric entry, ported from Audacity design system 20ce5547. */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialog } from '../Dialog/Dialog';
import { DialogFooter } from '../Footer/Footer';
import { NumberStepper } from '../NumberStepper/NumberStepper';
import { parseManualValue } from './manual-value';
export { parseManualValue } from './manual-value';

export interface ManualValueDialogProps {
	isOpen: boolean;
	title: string;
	label?: string;
	value: number;
	unit?: string;
	min?: number;
	max?: number;
	step?: number;
	decimals?: number;
	hint?: string;
	onApply: (value: number) => void;
	onClose: () => void;
	os?: 'macos' | 'windows';
}

export function ManualValueDialog({ isOpen, title, label = 'Value', value, unit, min, max, step = 1, decimals = 2, hint, onApply, onClose, os = 'windows' }: ManualValueDialogProps) {
	const [text, setText] = useState('');
	const inputRef = useRef<HTMLInputElement>(null);
	const portalRef = useRef<HTMLDivElement>(null);
	const openerRef = useRef<HTMLElement | null>(null);
	useEffect(() => {
		if (!isOpen) return;
		const portal = portalRef.current;
		openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		setText(`${Number(value.toFixed(decimals))}${unit ? ` ${unit}` : ''}`);
		const timer = window.setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select?.(); }, 50);
		return () => {
			window.clearTimeout(timer);
			const active = document.activeElement;
			if (openerRef.current?.isConnected && (active === document.body || portal?.contains(active))) openerRef.current.focus();
		};
	}, [isOpen, value, unit, decimals]);
	const parsed = parseManualValue(text);
	const apply = () => {
		if (parsed === null) return;
		onApply(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, parsed)));
		onClose();
	};
	if (!isOpen) return null;
	const portalHost = openerRef.current?.closest('[data-audio-editor]') ?? document.activeElement?.closest('[data-audio-editor]') ?? document.body;
	return createPortal(<div ref={portalRef} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
		<Dialog isOpen={isOpen} title={title} onClose={onClose} os={os} width={320} minHeight={0} className="manual-value-dialog"
		footer={<DialogFooter primaryText="Apply" secondaryText="Cancel" primaryDisabled={parsed === null} onPrimaryClick={apply} onSecondaryClick={onClose} />}>
		<div data-manual-value-dialog onKeyDown={event => {
			if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); apply(); }
			if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
		}}>
			<label>{label}<NumberStepper ref={inputRef} ariaLabel={label} value={text} onChange={setText} min={min} max={max} step={step} width="100%" /></label>
			{hint && <p>{hint}</p>}
		</div>
		</Dialog>
	</div>, portalHost);
}
