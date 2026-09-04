import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { audacityEffectTypes } from '../../audacity-effects/manifest.js';
import {
	audioSelectionEffectDefinition,
	audioSelectionEffectDefaults,
} from '../../effects.js';
import { AUDIO_EDITOR_SAMPLE_RATE, findTrack } from '../../project.js';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { selectAudioEditorEditBlock } from '../edit-blocking.ts';
import EffectPresetBar from './EffectPresetBar.jsx';
import EffectParameterEditor from './EffectParameterEditor.jsx';
import { LabeledDropdown } from './inspector-controls.jsx';
import { effectPresetChoices, safeEffectLabel, samePresetParams } from './effect-helpers.ts';
import { createFallbackFileService } from './inspector-helpers.ts';

export function SelectionEffectsDialog({ isOpen, controller, snapshot, copy, fileService, onClose }) {
	const project = snapshot.project;
	const selectedTrack = project ? findTrack(project, snapshot.selectedTrackId) : null;
	const blocked = !snapshot.ready || !project || selectAudioEditorEditBlock(snapshot).blocked;
	const initialType = snapshot.effects?.selectionType || audacityEffectTypes()[0];
	const [selectionType, setSelectionType] = useState(initialType);
	const [selectionParams, setSelectionParams] = useState(() => (
		snapshot.effects?.selectionParams || audioSelectionEffectDefaults(initialType)
	));
	const [controlTrackId, setControlTrackId] = useState(snapshot.effects?.controlTrackId || '');
	const [message, setMessage] = useState('');
	const [selectedPresetId, setSelectedPresetId] = useState('');
	const [presetName, setPresetName] = useState('');
	const projectIdentity = project?.id ?? null;
	const currentProjectIdentity = useRef(projectIdentity);
	const stateProjectIdentity = useRef(projectIdentity);
	const activeOperation = useRef(null);
	if (currentProjectIdentity.current !== projectIdentity) {
		currentProjectIdentity.current = projectIdentity;
		activeOperation.current = null;
	}

	useEffect(() => {
		const projectChanged = stateProjectIdentity.current !== projectIdentity;
		if (projectChanged) {
			stateProjectIdentity.current = projectIdentity;
			activeOperation.current = null;
			setMessage('');
			setSelectedPresetId('');
			setPresetName('');
		}
		if (!snapshot.effects) {
			if (projectChanged) {
				const nextType = audacityEffectTypes()[0];
				setSelectionType(nextType);
				setSelectionParams(audioSelectionEffectDefaults(nextType));
				setControlTrackId('');
			}
			return;
		}
		const nextType = snapshot.effects.selectionType || audacityEffectTypes()[0];
		setSelectionType(nextType);
		setSelectionParams(snapshot.effects.selectionParams || audioSelectionEffectDefaults(nextType));
		setControlTrackId(snapshot.effects.controlTrackId || '');
		if (!projectChanged && selectedPresetId
			&& !snapshot.effects.presets?.some((preset) => preset.id === selectedPresetId && preset.effectType === nextType)) {
			setSelectedPresetId('');
			setPresetName('');
		}
	}, [projectIdentity, selectedPresetId, snapshot.effects]);
	useEffect(() => () => { activeOperation.current = null; }, []);

	const liveProjectIdentity = () => ('project' in controller
		? controller.project?.id ?? null
		: currentProjectIdentity.current);
	const run = (work, onSuccess) => {
		if (stateProjectIdentity.current !== projectIdentity
			|| liveProjectIdentity() !== projectIdentity) return Promise.resolve();
		const operation = { projectIdentity };
		activeOperation.current = operation;
		const ownsOperation = () => activeOperation.current === operation
			&& currentProjectIdentity.current === operation.projectIdentity
			&& stateProjectIdentity.current === operation.projectIdentity
			&& liveProjectIdentity() === operation.projectIdentity;
		setMessage('');
		return Promise.resolve()
			.then(() => ownsOperation() ? work(ownsOperation) : undefined)
			.then((result) => {
				if (!ownsOperation()) return;
				onSuccess?.(result);
				if (activeOperation.current === operation) activeOperation.current = null;
			})
			.catch((cause) => {
				if (!ownsOperation()) return;
				activeOperation.current = null;
				setMessage(cause instanceof Error ? cause.message : String(cause));
			});
	};
	const updateSelectionParams = (changes) => {
		setSelectionParams((current) => ({ ...current, ...changes }));
		controller.actions.effects.setSelectionParams(changes);
	};
	const selectionDefinition = audioSelectionEffectDefinition(selectionType);
	const selectionControlTracks = (project?.tracks || []).filter((track) => track.id !== selectedTrack?.id);
	const effectPresets = (snapshot.effects?.presets || []).filter((preset) => preset.effectType === selectionType);
	const applyPreset = (id = selectedPresetId) => run(() => (
		id ? controller.actions.effects.presets.apply(id) : null
	), (preset) => {
		if (!preset) return;
		setSelectedPresetId(preset.id);
		setSelectionType(preset.effectType);
		setSelectionParams(preset.params);
		// Saving a factory preset on means saving it under a name, and the name
		// it starts from is the one it is stored and exported under.
		setPresetName(preset.name);
	});
	const savePreset = (id = null, name = presetName) => run(() => controller.actions.effects.presets.save({
		...(id ? { id } : {}),
		effectType: selectionType,
		name,
		params: selectionParams,
	}), (preset) => {
		setSelectedPresetId(preset.id);
		setPresetName(preset.name);
	});
	const importPreset = (file) => run(async (ownsOperation) => {
		if (!file) return;
		const encoded = await file.text();
		if (ownsOperation()) await controller.actions.effects.presets.import(encoded);
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
	const deletePreset = () => run(
		() => controller.actions.effects.presets.delete(selectedPresetId),
		() => {
			setSelectedPresetId('');
			setPresetName('');
		},
	);
	const presetChoices = effectPresetChoices(effectPresets, copy.noEffectPreset, copy);
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
				<EffectPresetBar
					copy={copy}
					disabled={blocked}
					resetKey={projectIdentity}
					presets={presetChoices.map(({ id, label, custom }) => ({ id, label, custom }))}
					selectedId={selectedPresetId}
					unsaved={Boolean(selectedPresetChoice)
						&& !samePresetParams(selectionParams, selectedPresetChoice.preset.params)}
					onSelect={(id) => {
						if (blocked) return;
						if (!id) {
							setSelectedPresetId('');
							setPresetName('');
							return;
						}
						applyPreset(id);
					}}
					onSave={() => savePreset(selectedPresetId)}
					onSaveAs={(name) => {
						setPresetName(name);
						savePreset(null, name);
					}}
					onReset={() => applyPreset()}
					onDelete={deletePreset}
					onImport={(file) => { void importPreset(file); }}
					onExport={exportPreset}
				/>
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
									onClick={() => run(() => controller.actions.effects.applySelection({
										type: selectionType,
										params: selectionParams,
										controlTrackId: controlTrackId || null,
									}), () => onClose?.())}
								>{copy.applyAudacityEffect}</Button>
							</span>
						</>
					)}
				/>
			)}
		>
			<section className="audio-editor-selection-effects" data-audacity-effect-panel>
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
						? () => run(() => controller.actions.effects.captureNoiseProfile(selectionParams))
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
				{message && <p className="audio-editor-field-error" role="alert">{message}</p>}
			</section>
		</AudioEditorDialogShell>
	);
}

export default SelectionEffectsDialog;
