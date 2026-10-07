import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { TextInput } from '@soundscaper/design-system/TextInput';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { takeSelectedFile } from '../file-input-selection.ts';
import { useMenuTriggerDismissal } from '../use-menu-trigger-dismissal.ts';
import { canonicalCopyValue } from '../../../i18n/canonical-extras.js';
import { usePresetOptions, useDefaultPresetEdited, useEffectAboutPresentation } from './useEffectPresentation.ts';
import AudacityEffectHeader from './AudacityEffectHeader.jsx';
import EffectAboutDialog from './EffectAboutDialog.tsx';
import EffectPresetMenuPortal from './EffectPresetMenuPortal.tsx';
import { usePresetDeletionFocus } from './usePresetDeletionFocus.ts';

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
	defaultParams = /** @type {null | Record<string, unknown>} */ (null),
	currentParams = /** @type {null | Record<string, unknown>} */ (null),
	onDefault = /** @type {null | (() => void)} */ (null),
	onAdvancedSettings = /** @type {null | (() => void)} */ (null),
	aboutEffect = /** @type {import('./effect-about-metadata.ts').EffectAboutSubject | string | null} */ (null),
	onSelect,
	onSave,
	onSaveAs,
	onReset,
	onDelete,
	onImport,
	onExport,
	acceptAudacityPresets = true,
	resetKey = /** @type {unknown} */ (null),
	dataAttribute = 'data-effect-presets',
}) {
	const saveFormId = useId();
	const fileRef = useRef(null);
	const barRef = useRef(null);
	const saveTriggerRef = useRef(null);
	const optionsTriggerRef = useRef(null);
	const [saveMenu, setSaveMenu] = useState(null);
	const [optionsMenu, setOptionsMenu] = useState(null);
	const consumeSaveDismissal = useMenuTriggerDismissal(saveTriggerRef, Boolean(saveMenu));
	const consumeOptionsDismissal = useMenuTriggerDismissal(optionsTriggerRef, Boolean(optionsMenu));
	const [saveAsName, setSaveAsName] = useState(null);
	const [aboutOpen, setAboutOpen] = useState(false);
	const hasAbout = aboutEffect != null;
	const about = useEffectAboutPresentation(aboutOpen, aboutEffect, copy);
	useEffect(() => {
		const buttons = barRef.current?.querySelectorAll('.effect-header__icon-button');
		saveTriggerRef.current = buttons?.[0] || null;
		optionsTriggerRef.current = buttons?.[3] || null;
	});

	// An open menu or half-typed preset name belongs to whatever was being
	// edited when it opened. When that changes underneath — a different project,
	// or a different effect in the rack — the transient state has to go with it
	// rather than land on the new subject.
	useEffect(() => {
		setSaveMenu(null);
		setOptionsMenu(null);
		setSaveAsName(null);
		setAboutOpen(false);
	}, [resetKey]);
	const selectedIndex = presets.findIndex((preset) => preset.id === selectedId);
	const selected = presets[selectedIndex] || null;
	const canOverwrite = Boolean(selected?.custom) && !disabled;
	const captureDeletionFocus = usePresetDeletionFocus(barRef, presets, selectedId, disabled, resetKey);
	const hasDefault = defaultParams != null;
	const defaultBaseline = hasDefault && !selected;
	const defaultEdited = useDefaultPresetEdited(defaultBaseline, currentParams, defaultParams);
	const baselineLabel = hasDefault ? canonicalCopyValue('effectDefaultPreset', copy) : copy.noEffectPreset;
	const baselineDisplay = `${baselineLabel}${defaultEdited ? '*' : ''}`;

	const options = usePresetOptions(presets, selectedId, unsaved, copy.effectPresetCustom);
	const anchor = (event) => {
		event?.currentTarget?.focus?.({ preventScroll: true });
		const rect = event?.currentTarget?.getBoundingClientRect?.();
		return { x: rect?.left ?? 0, y: (rect?.bottom ?? 0) + 4 };
	};
	const close = () => {
		setSaveMenu(null);
		setOptionsMenu(null);
	};
	const saveAs = () => {
		const name = saveAsName?.trim();
		if (!name || disabled) return;
		setSaveAsName(null);
		onSaveAs(name);
	};

	return (
		<div ref={barRef} className="audio-editor-effect-preset-bar" {...{ [dataAttribute]: '' }}>
			<AudacityEffectHeader
				copy={copy}
				isDestructive={!automation}
				automationEnabled={automation?.enabled ?? false}
				onToggleAutomation={automation?.onToggle}
				presetName={selected ? options[selectedIndex]?.display : baselineDisplay}
				presetValue={selected?.id || ''}
				presetOptions={[{ value: '', label: baselineDisplay },
					...options.map(({ id, display }) => ({ value: id, label: display }))]}
				onPresetChange={(value) => {
					if (disabled) return;
					const choice = options.find((option) => option.id === value);
					if (!choice && hasDefault && onDefault) onDefault();
					else onSelect(choice?.id || '');
				}}
				onSavePreset={(event) => {
					if (consumeSaveDismissal()) return;
					if (disabled) return;
					if (saveMenu) { close(); return; }
					setOptionsMenu(null);
					setSaveMenu(anchor(event));
				}}
				canUndo={(Boolean(selectedId) && unsaved || defaultEdited) && !disabled}
				onUndo={() => {
					if (disabled) return;
					if (defaultBaseline && onDefault) onDefault();
					else onReset();
				}}
				canDelete={canOverwrite}
				onDeletePreset={() => { if (canOverwrite) { captureDeletionFocus(); onDelete(); } }}
				onMoreOptions={(event) => {
					if (consumeOptionsDismissal()) return;
					if (disabled && !hasAbout) return;
					if (optionsMenu) { close(); return; }
					setSaveMenu(null);
					setOptionsMenu(anchor(event));
				}}
			/>

			{(saveMenu || optionsMenu) && <EffectPresetMenuPortal target={fileRef.current}>
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
					{onAdvancedSettings && <ContextMenuItem
						label={canonicalCopyValue('effectAdvancedSettings', copy)}
						disabled={disabled}
						onClick={() => { close(); onAdvancedSettings(); }}
					/>}
					<ContextMenuItem
						label={copy.importEffectPreset}
						disabled={disabled}
						onClick={() => { close(); fileRef.current?.click(); }}
					/>
					<ContextMenuItem
						label={copy.exportEffectPreset}
						disabled={disabled || !selectedId}
						onClick={() => { close(); if (selectedId) onExport(); }}
					/>
					{hasAbout && <>
						<ContextMenuItem isDivider />
						<ContextMenuItem label={canonicalCopyValue('effectAbout', copy)}
							onClick={() => { close(); setAboutOpen(true); }} />
					</>}
				</ContextMenu>
			</EffectPresetMenuPortal>}

			<input
				ref={fileRef}
				type="file"
				accept={acceptAudacityPresets ? 'application/json,.json,text/plain,.txt' : 'application/json,.json'}
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
									type="submit" form={saveFormId}
									disabled={disabled || !saveAsName.trim()}
								>{copy.saveEffectPreset}</Button>
							</>}
						/>
					)}
				>
					<form id={saveFormId} onSubmit={(event) => { event.preventDefault(); saveAs(); }}>
						<label className="audio-editor-field">
							<span>{copy.effectPresetName}</span>
							<TextInput value={saveAsName} onChange={setSaveAsName} width="100%" data-preset-name />
						</label>
					</form>
				</AudioEditorDialogShell>
			)}
			{aboutOpen && about && <EffectPresetMenuPortal target={fileRef.current}>
				<EffectAboutDialog about={about} copy={copy} onClose={() => setAboutOpen(false)} />
			</EffectPresetMenuPortal>}
		</div>
	);
}
