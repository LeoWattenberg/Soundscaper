import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { Flyout } from '@soundscaper/design-system/Flyout';
import { audioEffectTypes } from '../../effects.js';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { useAudioEditorThemeVariables } from '../DesignSystemRuntime.jsx';
import { LabeledDropdown } from './inspector-controls.jsx';
import { safeEffectLabel } from './effect-helpers.ts';

/**
 * The effects a chain may hold. The rack picker offers what the rack can
 * stream; the Macro Manager passes the wider set a macro step accepts.
 */
export default function EffectPicker({
	copy, disabled, flyout = false, anchor = null, effectTypes = null,
	onClose, onChoose, onCopyEffect = null, onRemoveEffect = null,
}) {
	const types = useMemo(() => effectTypes || audioEffectTypes(), [effectTypes]);
	const themeVariables = useAudioEditorThemeVariables();
	const triggerRef = useRef(anchor);
	const searchRef = useRef(null);
	const [type, setType] = useState(types[0] || '');
	const [query, setQuery] = useState('');
	const matchingTypes = useMemo(() => {
		const normalizedQuery = query.trim().toLocaleLowerCase();
		return normalizedQuery
			? types.filter((value) => safeEffectLabel(value, copy).toLocaleLowerCase().includes(normalizedQuery))
			: types;
	}, [copy, query, types]);
	useEffect(() => {
		triggerRef.current = anchor;
	}, [anchor]);
	useEffect(() => {
		if (!flyout) return undefined;
		const frame = requestAnimationFrame(() => searchRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [flyout]);
	const runAndRestoreFocus = (action) => {
		const trigger = triggerRef.current;
		const fallbackRoot = trigger?.closest('.effects-panel__track-section, .effects-panel__master-section');
		const restore = () => requestAnimationFrame(() => {
			const fallback = fallbackRoot?.querySelector('.effect-slot__settings-button')
				?? fallbackRoot?.querySelector('.effects-stack-header__add-button');
			(trigger?.isConnected ? trigger : fallback)?.focus({ preventScroll: true });
		});
		void Promise.resolve().then(action).then(restore, restore);
	};
	if (flyout) {
		const rect = anchor?.getBoundingClientRect?.();
		return (
			<Flyout
				isOpen
				onClose={onClose}
				x={rect ? rect.left + rect.width / 2 : 0}
				y={rect?.bottom || 0}
				direction={rect && window.innerHeight - rect.bottom < 300 ? 'up' : 'down'}
				triggerRef={triggerRef}
				showArrow
				closeOnOutsideClick
				closeOnEscape
				ariaLabel={copy.chooseEffect}
				role="group"
				className="audio-editor-effect-picker-flyout"
				style={{ ...themeVariables, zIndex: 10020, pointerEvents: 'auto' }}
			>
				{(onRemoveEffect || onCopyEffect) && (
					<div className="audio-editor-effect-picker-flyout__actions">
						{onRemoveEffect && (
							<button type="button" disabled={disabled} onClick={() => {
								runAndRestoreFocus(onRemoveEffect);
								onClose();
							}}>{copy.removeEffect}</button>
						)}
						{onCopyEffect && (
							<button type="button" disabled={disabled} onClick={() => {
								runAndRestoreFocus(onCopyEffect);
								onClose();
							}}>{copy.copyEffect}</button>
						)}
					</div>
				)}
				<input
					ref={searchRef}
					type="search"
					className="audio-editor-effect-picker-flyout__search"
					aria-label={copy.searchEffects}
					placeholder={copy.searchEffects}
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
				{matchingTypes.length > 0 && (
					<div className="audio-editor-effect-picker-flyout__grid" role="menu" aria-label={copy.chooseEffect}>
						{matchingTypes.map((value) => (
							<button
								key={value}
								type="button"
								role="menuitem"
								disabled={disabled}
								onClick={() => runAndRestoreFocus(() => onChoose(value))}
							>
								{safeEffectLabel(value, copy)}
							</button>
						))}
					</div>
				)}
				{matchingTypes.length === 0 && (
					<p className="audio-editor-effect-picker-flyout__empty" role="status">{copy.noMatchingEffects}</p>
				)}
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
