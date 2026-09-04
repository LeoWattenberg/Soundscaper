import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { Flyout } from '@soundscaper/design-system/Flyout';
import { audioEffectTypes } from '../../effects.js';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { useAudioEditorThemeVariables } from '../DesignSystemRuntime.jsx';
import { LabeledDropdown } from './inspector-controls.jsx';
import { safeEffectLabel } from './effect-helpers.ts';

export default function EffectPicker({ copy, disabled, flyout = false, anchor = null, onClose, onChoose }) {
	const types = useMemo(() => audioEffectTypes(), []);
	const themeVariables = useAudioEditorThemeVariables();
	const triggerRef = useRef(anchor);
	const [type, setType] = useState(types[0] || '');
	useEffect(() => {
		triggerRef.current = anchor;
	}, [anchor]);
	if (flyout) {
		const rect = anchor?.getBoundingClientRect?.();
		return (
			<Flyout
				isOpen
				onClose={onClose}
				x={rect ? rect.left + rect.width / 2 : 0}
				y={rect?.bottom || 0}
				direction={rect && window.innerHeight - rect.bottom < 300 ? 'up' : 'down'}
				autoFocus
				triggerRef={triggerRef}
				showArrow
				closeOnOutsideClick
				closeOnEscape
				ariaLabel={copy.chooseEffect}
				role="menu"
				className="audio-editor-effect-picker-flyout"
				style={{ ...themeVariables, zIndex: 10020, pointerEvents: 'auto' }}
			>
				<div className="audio-editor-effect-picker-flyout__grid">
					{types.map((value) => (
						<button
							key={value}
							type="button"
							role="menuitem"
							disabled={disabled}
							onClick={() => onChoose(value)}
						>
							{safeEffectLabel(value, copy)}
						</button>
					))}
				</div>
			</Flyout>
		);
	}
	return (
		<AudioEditorDialogShell
			isOpen
			title={copy.chooseEffect}
			onClose={onClose}
			width={440}
			className="audio-editor-effect-picker-dialog"
			dataAttributes={{ 'data-effect-picker': '' }}
			footer={<DialogFooter
				className="audio-editor-dialog-footer"
				rightContent={<>
					<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
					<Button variant="primary" disabled={disabled || !type} onClick={() => onChoose(type)}>{copy.addEffect}</Button>
				</>}
			/>}
		>
			<div className="audio-editor-local-dialog__body">
				<LabeledDropdown
					label={copy.chooseEffect}
					options={types.map((value) => ({ value, label: safeEffectLabel(value, copy) }))}
					value={type}
					onChange={setType}
					disabled={disabled}
					hook="effect-type"
				/>
			</div>
		</AudioEditorDialogShell>
	);
}
