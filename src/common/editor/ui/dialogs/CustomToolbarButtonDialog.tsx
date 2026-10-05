/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useId, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';

import { MUSESCORE_ICON_CODES, iconNameToChar } from '../../audacity-iconcodes.js';
import type { CustomToolbarButton } from '../../custom-toolbar-buttons.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import type { CustomToolbarButtonAction } from '../toolbar/custom-toolbar-button-actions.ts';
import './CustomToolbarButtonDialog.css';

interface Props {
	readonly button?: CustomToolbarButton | null;
	readonly copy: Record<string, string>;
	readonly actions: readonly CustomToolbarButtonAction[];
	readonly onSave: (button: CustomToolbarButton) => Promise<unknown>;
	readonly onRemove?: () => Promise<unknown>;
	readonly onClose: () => void;
}

const SYMBOLS = Object.keys(MUSESCORE_ICON_CODES);

export default function CustomToolbarButtonDialog({ button, copy, actions, onSave, onRemove, onClose }: Props) {
	const formId = useId();
	const descriptionId = useId();
	const [name, setName] = useState(button?.name ?? '');
	const [actionId, setActionId] = useState(button?.actionId ?? '');
	const [icon, setIcon] = useState(button?.icon ?? 'PLUS');
	const [actionSearch, setActionSearch] = useState('');
	const [symbolSearch, setSymbolSearch] = useState('');
	const [saving, setSaving] = useState(false);
	const savingRef = useRef(false);
	const [failure, setFailure] = useState('');
	const matchingActions = actions.filter((action) => `${action.path.join(' ')} ${action.actionId}`.toLowerCase().includes(actionSearch.trim().toLowerCase()));
	const selectedAction = actions.find((action) => action.actionId === actionId);
	const matchingSymbols = SYMBOLS.filter((symbol) => symbol.replaceAll('_', ' ').toLowerCase().includes(symbolSearch.trim().replaceAll('_', ' ').toLowerCase()));
	const canSave = name.trim().length > 0 && Boolean(selectedAction) && !saving;
	const persist = (operation: () => Promise<unknown>) => {
		if (savingRef.current) return;
		savingRef.current = true;
		setSaving(true);
		setFailure('');
		void Promise.resolve().then(operation).then(onClose).catch((error: unknown) => {
			setFailure(error instanceof Error ? error.message : String(error));
			savingRef.current = false;
			setSaving(false);
		});
	};
	return <AudioEditorDialogShell
		title={copy.customToolbarButton}
		onClose={saving ? undefined : onClose}
		width={640}
		initialFocus="input[name='custom-button-name']"
		className="kw-audio-editor-custom-button-dialog"
		ariaDescribedBy={descriptionId}
		footer={<DialogFooter className="audio-editor-dialog-footer"
			leftContent={button && onRemove ? <Button variant="secondary" disabled={saving} onClick={() => persist(onRemove)}>{copy.customToolbarButtonRemove}</Button> : undefined}
			rightContent={<>
				<Button variant="secondary" disabled={saving} onClick={onClose}>{copy.cancel}</Button>
				<Button type="submit" form={formId} variant="primary" disabled={!canSave}>{copy.save}</Button>
			</>}
		/>}
	>
		<form id={formId} onSubmit={(event) => {
			event.preventDefault();
			if (canSave) persist(() => onSave({ id: button?.id ?? `custom-${globalThis.crypto.randomUUID()}`, name: name.trim(), icon, actionId }));
		}}>
			<p id={descriptionId}>{copy.customToolbarButtonHelp}</p>
			<label className="kw-audio-editor-custom-button-dialog__field">
				<span>{copy.customToolbarButtonName}</span>
				<input name="custom-button-name" aria-label={copy.customToolbarButtonName} value={name} onChange={(event) => setName(event.currentTarget.value)} required disabled={saving} />
			</label>
			<label className="kw-audio-editor-custom-button-dialog__field">
				<span>{copy.customToolbarButtonActionSearch}</span>
				<input type="search" aria-label={copy.customToolbarButtonActionSearch} value={actionSearch} onChange={(event) => setActionSearch(event.currentTarget.value)} disabled={saving} />
			</label>
			<label className="kw-audio-editor-custom-button-dialog__field">
				<span>{copy.customToolbarButtonAction}</span>
				<select aria-label={copy.customToolbarButtonAction} value={actionId} onChange={(event) => setActionId(event.currentTarget.value)} required disabled={saving}>
					<option value="">{copy.customToolbarButtonAction}</option>
					{actionId && !selectedAction && <option value={actionId}>{actionId}</option>}
					{selectedAction && !matchingActions.includes(selectedAction) && <option value={selectedAction.actionId}>{selectedAction.path.join(' › ')}</option>}
					{matchingActions.map((action) => <option key={action.actionId} value={action.actionId}>{action.path.join(' › ')}</option>)}
				</select>
				{matchingActions.length === 0 && <span role="status">{copy.customToolbarButtonNoActions}</span>}
			</label>
			{actionId && (!selectedAction || selectedAction.disabled) && <p>{selectedAction?.disabledReason || copy.customToolbarButtonUnavailable}</p>}
			<label className="kw-audio-editor-custom-button-dialog__field">
				<span>{copy.customToolbarButtonSymbolSearch}</span>
				<input type="search" aria-label={copy.customToolbarButtonSymbolSearch} value={symbolSearch} onChange={(event) => setSymbolSearch(event.currentTarget.value)} disabled={saving} />
			</label>
			<div className="kw-audio-editor-custom-button-dialog__symbol-heading">
				<span>{copy.customToolbarButtonSymbol}: {icon.replaceAll('_', ' ')}</span>
				<span className="musescore-icon" aria-hidden="true">{iconNameToChar(icon)}</span>
			</div>
			<div className="kw-audio-editor-custom-button-dialog__symbols" role="group" aria-label={copy.customToolbarButtonSymbol}>
				{matchingSymbols.map((symbol) => <button key={symbol} type="button" aria-label={symbol} aria-pressed={icon === symbol} title={symbol.replaceAll('_', ' ')} disabled={saving} onClick={() => setIcon(symbol)}>
					<span className="musescore-icon" aria-hidden="true">{iconNameToChar(symbol)}</span>
				</button>)}
				{matchingSymbols.length === 0 && <p role="status">{copy.customToolbarButtonNoSymbols}</p>}
			</div>
			{failure && <p role="alert">{failure}</p>}
		</form>
	</AudioEditorDialogShell>;
}
