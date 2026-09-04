import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { TextInput } from '@soundscaper/design-system/TextInput';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { takeSelectedFile } from '../file-input-selection.ts';
import AudacityEffectHeader from './AudacityEffectHeader.jsx';

/**
 * The preset bar Audacity 4 puts above every effect's controls.
 *
 * Upstream's `EffectPresetsBar.qml` is a single row: the preset dropdown fills
 * the width, then four icon buttons sit to its right — Save (a menu offering
 * Save and Save as…), Reset, Delete, and Preset options (a menu offering
 * Import… and Export…). Naming happens in a prompt, so the row never grows a
 * text field, and the secondary actions never spill below the dropdown.
 *
 * Every surface with presets renders this component, so the effect rack, the
 * destructive effect dialog and the export dialog stay identical.
 */
export default function EffectPresetBar({
	copy,
	disabled = false,
	automation = null,
	presets,
	selectedId = '',
	unsaved = false,
	onSelect,
	onSave,
	onSaveAs,
	onReset,
	onDelete,
	onImport,
	onExport,
	resetKey = null,
	dataAttribute = 'data-effect-presets',
}) {
	const fileRef = useRef(null);
	const [saveMenu, setSaveMenu] = useState(null);
	const [optionsMenu, setOptionsMenu] = useState(null);
	const [saveAsName, setSaveAsName] = useState(null);

	// An open menu or half-typed preset name belongs to whatever was being
	// edited when it opened. When that changes underneath — a different project,
	// or a different effect in the rack — the transient state has to go with it
	// rather than land on the new subject.
	useEffect(() => {
		setSaveMenu(null);
		setOptionsMenu(null);
		setSaveAsName(null);
	}, [resetKey]);
	const selected = presets.find((preset) => preset.id === selectedId) || null;
	const canOverwrite = Boolean(selected?.custom) && !disabled;

	const labelFor = (preset) => {
		// Upstream marks stored presets as custom and flags unsaved edits with a
		// trailing asterisk, so the dropdown alone says whether Save will
		// overwrite anything and whether Reset has something to discard.
		const custom = preset.custom ? ` (${copy.effectPresetCustom})` : '';
		const edited = unsaved && preset.id === selectedId ? '*' : '';
		return `${preset.label}${custom}${edited}`;
	};
	const options = presets.map((preset) => ({ ...preset, display: labelFor(preset) }));
	const anchor = (event) => {
		const rect = event?.currentTarget?.getBoundingClientRect?.();
		return { x: rect?.left ?? 0, y: (rect?.bottom ?? 0) + 4 };
	};
	const close = () => {
		setSaveMenu(null);
		setOptionsMenu(null);
	};

	return (
		<div className="audio-editor-effect-preset-bar" {...{ [dataAttribute]: '' }}>
			<AudacityEffectHeader
				copy={copy}
				isDestructive={!automation}
				automationEnabled={automation?.enabled ?? false}
				onToggleAutomation={automation?.onToggle}
				presetName={selected ? labelFor(selected) : copy.noEffectPreset}
				presets={[copy.noEffectPreset, ...options.map(({ display }) => display)]}
				onPresetChange={(value) => {
					if (disabled) return;
					const choice = options.find((option) => option.display === value);
					onSelect(choice?.id || '');
				}}
				onSavePreset={(event) => {
					if (disabled) return;
					setOptionsMenu(null);
					setSaveMenu(anchor(event));
				}}
				canUndo={Boolean(selectedId) && unsaved && !disabled}
				onUndo={() => { if (!disabled) onReset(); }}
				canDelete={canOverwrite}
				onDeletePreset={() => { if (canOverwrite) onDelete(); }}
				onMoreOptions={(event) => {
					if (disabled) return;
					setSaveMenu(null);
					setOptionsMenu(anchor(event));
				}}
			/>

			<ContextMenu isOpen={Boolean(saveMenu)} onClose={close} x={saveMenu?.x || 0} y={saveMenu?.y || 0}>
				<ContextMenuItem
					label={copy.saveEffectPreset}
					disabled={!canOverwrite}
					onClick={() => { close(); if (canOverwrite) onSave(); }}
				/>
				<ContextMenuItem
					label={copy.saveEffectPresetAs}
					onClick={() => { close(); setSaveAsName(selected?.label || ''); }}
				/>
			</ContextMenu>

			<ContextMenu isOpen={Boolean(optionsMenu)} onClose={close} x={optionsMenu?.x || 0} y={optionsMenu?.y || 0}>
				<ContextMenuItem
					label={copy.importEffectPreset}
					onClick={() => { close(); fileRef.current?.click(); }}
				/>
				<ContextMenuItem
					label={copy.exportEffectPreset}
					disabled={!selectedId}
					onClick={() => { close(); if (selectedId) onExport(); }}
				/>
			</ContextMenu>

			<input
				ref={fileRef}
				type="file"
				accept="application/json,.json"
				hidden
				data-effect-preset-file
				onChange={(event) => {
					const file = takeSelectedFile(event.currentTarget);
					if (file) onImport(file);
				}}
			/>

			{saveAsName !== null && (
				<AudioEditorDialogShell
					isOpen
					title={copy.saveEffectPresetAs}
					onClose={() => setSaveAsName(null)}
					width={380}
					className="audio-editor-preset-name-dialog"
					dataAttributes={{ 'data-preset-name-dialog': '' }}
					footer={(
						<DialogFooter
							className="audio-editor-dialog-footer"
							rightContent={<>
								<Button variant="secondary" onClick={() => setSaveAsName(null)}>{copy.cancel}</Button>
								<Button
									variant="primary"
									disabled={!saveAsName.trim()}
									onClick={() => {
										const name = saveAsName.trim();
										setSaveAsName(null);
										if (name) onSaveAs(name);
									}}
								>{copy.saveEffectPreset}</Button>
							</>}
						/>
					)}
				>
					<label className="audio-editor-field">
						<span>{copy.effectPresetName}</span>
						<TextInput value={saveAsName} onChange={setSaveAsName} width="100%" data-preset-name />
					</label>
				</AudioEditorDialogShell>
			)}
		</div>
	);
}
