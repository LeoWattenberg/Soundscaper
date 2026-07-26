import { useEffect, useRef, useState } from 'react';
import { Button, DialogFooter, Separator, TextInput } from '@dilsonspickles/components';
import {
	AUDACITY_EFFECT_DEFINITIONS,
	audacityEffectDefaults,
	audacityEffectTypes,
} from '../../audacity-effects/manifest.js';
import { AUDIO_EDITOR_SAMPLE_RATE, findTrack } from '../../project.js';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { selectAudioEditorEditBlock } from '../edit-blocking.ts';
import AudacityEffectHeader from './AudacityEffectHeader.jsx';
import EffectParameterEditor from './EffectParameterEditor.jsx';
import { LabeledDropdown } from './inspector-controls.jsx';
import { effectPresetChoices, safeEffectLabel } from './effect-helpers.ts';
import { createFallbackFileService } from './inspector-helpers.ts';

export function SelectionEffectsDialog({ isOpen, controller, snapshot, copy, fileService, onClose }) {
	const project = snapshot.project;
	const selectedTrack = project ? findTrack(project, snapshot.selectedTrackId) : null;
	const blocked = !snapshot.ready || !project || selectAudioEditorEditBlock(snapshot).blocked;
	const initialType = snapshot.effects?.selectionType || audacityEffectTypes()[0];
	const [selectionType, setSelectionType] = useState(initialType);
	const [selectionParams, setSelectionParams] = useState(() => (
		snapshot.effects?.selectionParams || audacityEffectDefaults(initialType)
	));
	const [controlTrackId, setControlTrackId] = useState(snapshot.effects?.controlTrackId || '');
	const [message, setMessage] = useState('');
	const [selectedPresetId, setSelectedPresetId] = useState('');
	const [presetName, setPresetName] = useState('');
	const [presetsExpanded, setPresetsExpanded] = useState(false);
	const presetFileRef = useRef(null);

	useEffect(() => {
		if (!snapshot.effects) return;
		const nextType = snapshot.effects.selectionType || audacityEffectTypes()[0];
		setSelectionType(nextType);
		setSelectionParams(snapshot.effects.selectionParams || audacityEffectDefaults(nextType));
		setControlTrackId(snapshot.effects.controlTrackId || '');
		if (!snapshot.effects.presets?.some((preset) => preset.id === selectedPresetId && preset.effectType === nextType)) {
			setSelectedPresetId('');
			setPresetName('');
		}
	}, [selectedPresetId, snapshot.effects]);

	const run = (work) => {
		setMessage('');
		return Promise.resolve().then(work).catch((cause) => {
			setMessage(cause instanceof Error ? cause.message : String(cause));
		});
	};
	const updateSelectionParams = (changes) => {
		setSelectionParams((current) => ({ ...current, ...changes }));
		controller.actions.effects.setSelectionParams(changes);
	};
	const selectionDefinition = AUDACITY_EFFECT_DEFINITIONS[selectionType];
	const selectionControlTracks = (project?.tracks || []).filter((track) => track.id !== selectedTrack?.id);
	const effectPresets = (snapshot.effects?.presets || []).filter((preset) => preset.effectType === selectionType);
	const applyPreset = (id = selectedPresetId) => run(() => {
		if (!id) return;
		const preset = controller.actions.effects.presets.apply(id);
		setSelectedPresetId(preset.id);
		setSelectionType(preset.effectType);
		setSelectionParams(preset.params);
		setPresetName(preset.name);
	});
	const savePreset = (id = null) => run(async () => {
		const preset = await controller.actions.effects.presets.save({
			...(id ? { id } : {}),
			effectType: selectionType,
			name: presetName,
			params: selectionParams,
		});
		setSelectedPresetId(preset.id);
		setPresetName(preset.name);
	});
	const importPreset = (file) => run(async () => {
		if (!file) return;
		await controller.actions.effects.presets.import(await file.text());
		if (presetFileRef.current) presetFileRef.current.value = '';
	});
	const exportPreset = () => run(async () => {
		const encoded = controller.actions.effects.presets.export(selectedPresetId);
		await (fileService || createFallbackFileService()).saveFile({
			purpose: 'preset',
			suggestedName: `${(presetName || 'audacity-effect-preset').replace(/[^a-z0-9_-]+/gi, '-')}.json`,
			mimeType: 'application/json',
			text: encoded,
		});
	});
	const deletePreset = () => run(async () => {
		await controller.actions.effects.presets.delete(selectedPresetId);
		setSelectedPresetId('');
		setPresetName('');
	});
	const presetChoices = effectPresetChoices(effectPresets, copy.noEffectPreset);
	const selectedPresetChoice = presetChoices.find((choice) => choice.id === selectedPresetId);

	return (
		<AudioEditorDialogShell
			isOpen={isOpen}
			title={copy.selectionEffects || copy.audacityEffectsTitle}
			headerTitle={safeEffectLabel(selectionType, copy)}
			onClose={() => {
				controller.actions.effects.cancelPreview();
				onClose?.();
			}}
			width={selectionType === 'eq' ? 920 : 720}
			className="audio-editor-selection-effects-dialog"
			dataAttributes={{ 'data-selection-effects-dialog': '' }}
			headerSlot={(
				<div className="audio-editor-effect-preset-header" data-effect-presets>
					<AudacityEffectHeader
						copy={copy}
						isDestructive
						presetName={selectedPresetChoice?.label || copy.noEffectPreset}
						presets={[copy.noEffectPreset, ...presetChoices.map((choice) => choice.label)]}
						onPresetChange={(value) => {
							if (blocked) return;
							if (value === copy.noEffectPreset) {
								setSelectedPresetId('');
								setPresetName('');
								return;
							}
							const choice = presetChoices.find((candidate) => candidate.label === value);
							if (choice) applyPreset(choice.id);
						}}
						onSavePreset={() => {
							if (blocked) return;
							if (presetName.trim()) savePreset(selectedPresetId || null);
							else setPresetsExpanded(true);
						}}
						canDelete={Boolean(selectedPresetId) && !blocked}
						onDeletePreset={deletePreset}
						onMoreOptions={() => setPresetsExpanded((current) => !current)}
					/>
					{presetsExpanded && (
						<div className="audio-editor-effect-preset-drawer">
							<label className="audio-editor-field">
								<span>{copy.effectPresetName}</span>
								<TextInput value={presetName} onChange={setPresetName} disabled={blocked} width="100%" />
							</label>
							<div className="audio-editor-panel-actions">
								<Button variant="secondary" disabled={blocked || !selectedPresetId} onClick={() => applyPreset()}>{copy.applyEffectPreset}</Button>
								<Button variant="secondary" disabled={blocked || !selectedPresetId || !presetName.trim()} onClick={() => savePreset(selectedPresetId)}>{copy.saveEffectPreset}</Button>
								<Button variant="secondary" disabled={blocked || !presetName.trim()} onClick={() => savePreset()}>{copy.saveEffectPresetAs}</Button>
								<Button variant="secondary" disabled={blocked || !selectedPresetId} onClick={deletePreset}>{copy.deleteEffectPreset}</Button>
								<Button variant="secondary" disabled={blocked} onClick={() => presetFileRef.current?.click()}>{copy.importEffectPreset}</Button>
								<Button variant="secondary" disabled={blocked || !selectedPresetId} onClick={exportPreset}>{copy.exportEffectPreset}</Button>
								<input ref={presetFileRef} type="file" accept="application/json,.json" hidden onChange={(event) => importPreset(event.currentTarget.files?.[0])} />
							</div>
						</div>
					)}
				</div>
			)}
			footer={(
				<DialogFooter
					className="audio-editor-dialog-footer"
					leftContent={(
						<span data-preview-audacity-effect>
							<Button
								variant="secondary"
								disabled={blocked || !selectedTrack}
								onClick={() => run(() => snapshot.effects?.previewing
									? controller.actions.effects.cancelPreview()
									: controller.actions.effects.previewSelection({
										type: selectionType,
										params: selectionParams,
										controlTrackId: controlTrackId || null,
									}))}
							>{snapshot.effects?.previewing ? copy.stopPreview : copy.previewEffect}</Button>
						</span>
					)}
					rightContent={(
						<>
							<Button variant="secondary" onClick={() => {
								controller.actions.effects.cancelPreview();
								onClose?.();
							}}>{copy.cancel}</Button>
							<span data-apply-audacity-effect>
								<Button
									variant="primary"
									disabled={blocked || !selectedTrack}
									onClick={() => run(async () => {
										await controller.actions.effects.applySelection({
											type: selectionType,
											params: selectionParams,
											controlTrackId: controlTrackId || null,
										});
										onClose?.();
									})}
								>{copy.applyAudacityEffect}</Button>
							</span>
						</>
					)}
				/>
			)}
		>
			<section className="audio-editor-selection-effects" data-audacity-effect-panel>
				<div>
					<h3>{safeEffectLabel(selectionType, copy)}</h3>
					<p className="audio-editor-panel-hint">{copy.audacityEffectsDescription}</p>
				</div>
				<Separator />
				{selectionDefinition?.requiresControlTrack && (
					<LabeledDropdown
						label={copy.controlTrack}
						value={controlTrackId}
						options={selectionControlTracks.map((track) => ({ value: track.id, label: track.name }))}
						onChange={(trackId) => {
							setControlTrackId(trackId);
							controller.actions.effects.setControlTrack(trackId || null);
						}}
						disabled={blocked || selectionControlTracks.length === 0}
						hook="audacity-control-track"
					/>
				)}
				<EffectParameterEditor
					effect={{
						type: selectionType,
						params: selectionParams,
						context: { noiseProfile: Boolean(snapshot.effects?.noiseProfileReady) },
					}}
					copy={copy}
					disabled={blocked}
					sampleRate={project?.sampleRate || AUDIO_EDITOR_SAMPLE_RATE}
					tracks={project?.tracks || []}
					targetTrackId={selectedTrack?.id || null}
					captureNoiseProfile={selectionType === 'audacity-noise-reduction'
						? () => run(controller.actions.effects.captureNoiseProfile)
						: null}
					noiseProfileLabel={snapshot.effects?.noiseProfileReady ? copy.noiseProfileReady : copy.getNoiseProfile}
					hideControlTrack
					readParametricEqSpectrum={selectionType === 'eq'
						? controller.actions.effects.readSelectionParametricEqSpectrum
						: undefined}
					onParametricEqAudition={selectionType === 'eq'
						? controller.actions.effects.auditionSelectionParametricEq
						: undefined}
					onChange={(changes) => changes.params && updateSelectionParams(changes.params)}
				/>
				{selectionType === 'eq' && snapshot.selection?.frequencyRange && (
					<p className="audio-editor-panel-hint" data-parametric-eq-spectral-notice>
						{copy.eqSpectralSelectionNotice || 'The EQ uses the spectral box time span and affects the full spectrum.'}
					</p>
				)}
				<p className="audio-editor-panel-hint" data-audacity-effect-hint>{copy.audacitySelectionHint}</p>
				{message && <p className="audio-editor-field-error" role="alert">{message}</p>}
			</section>
		</AudioEditorDialogShell>
	);
}

export default SelectionEffectsDialog;
