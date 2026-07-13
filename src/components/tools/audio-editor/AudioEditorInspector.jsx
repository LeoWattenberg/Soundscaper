import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
	Button,
	DialogHeader,
	Dropdown,
	EffectsPanel,
	LabeledCheckbox,
	ProgressBar,
	TextInput,
} from '@dilsonspickles/components';
import {
	AUDIO_EFFECT_DEFINITIONS,
	audioEffectLabel,
	audioEffectParamRange,
	audioEffectTypes,
	createEffect,
} from '../../../lib/tools/audio-editor/effects.js';
import {
	AUDACITY_EFFECT_DEFINITIONS,
	audacityEffectDefaults,
	audacityEffectLabel,
	audacityEffectTypes,
	formatAudacityCurve,
	localized,
	parseAudacityCurve,
} from '../../../lib/tools/audio-editor/audacity-effects/manifest.js';
import {
	AUDIO_EDITOR_SAMPLE_RATE,
	findClip,
	findClipTrack,
	findSource,
	findTrack,
} from '../../../lib/tools/audio-editor/project.js';
import { boundedCanvasDimensions } from '../../../lib/tools/audio-editor/design-system-adapters.js';
import { MEDIA_EXPORT_FORMATS } from '../../../lib/tools/audio-editor/media-export.js';
import { useAudioEditorTelemetry } from './DesignSystemRuntime.jsx';

/**
 * Controlled dialog adapter for editor-owned workflows. The design-system Dialog
 * composite is intentionally not used because v0.9.0 changes supplied titles and
 * imposes a fixed content geometry. DialogHeader keeps the Audacity visual pattern
 * while this shell owns focus, dismissal, and responsive sizing.
 */
function ControlledDialog({
	isOpen,
	title,
	onClose,
	children,
	className = '',
	width = 640,
	closeOnEscape = true,
	closeOnOutside = true,
	dataAttributes = {},
}) {
	const panelRef = useRef(null);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		if (!isOpen) return undefined;
		const previouslyFocused = document.activeElement;
		const panel = panelRef.current;
		const focusableSelector = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
		const focusableElements = () => [...(panel?.querySelectorAll(focusableSelector) || [])]
			.filter((element) => !element.closest('[hidden], [aria-hidden="true"], [inert]'));
		const frame = requestAnimationFrame(() => {
			(focusableElements()[0] || panel)?.focus({ preventScroll: true });
		});
		const handleKeyDown = (event) => {
			if (event.key === 'Escape' && closeOnEscape) {
				event.preventDefault();
				onCloseRef.current?.();
				return;
			}
			if (event.key !== 'Tab' || !panel) return;
			const focusable = focusableElements();
			if (!focusable.length) {
				event.preventDefault();
				panel.focus();
				return;
			}
			const first = focusable[0];
			const last = focusable.at(-1);
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener('keydown', handleKeyDown);
			if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
				previouslyFocused.focus({ preventScroll: true });
			}
		};
	}, [closeOnEscape, isOpen]);

	if (!isOpen) return null;
	return (
		<div
			className="kw-audio-editor-dialog-backdrop audio-editor-controlled-dialog__backdrop"
			onMouseDown={(event) => {
				if (closeOnOutside && event.target === event.currentTarget) onClose?.();
			}}
		>
			<section
				ref={panelRef}
				tabIndex={-1}
				className={`kw-audio-editor-dialog audio-editor-controlled-dialog ${className}`}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				style={{ width: `min(${typeof width === 'number' ? `${width}px` : width}, calc(100vw - 32px))` }}
				{...dataAttributes}
			>
				<DialogHeader title={title} os="windows" onClose={onClose} />
				<div className="kw-audio-editor-dialog__body audio-editor-controlled-dialog__body">
					{children}
				</div>
			</section>
		</div>
	);
}

export function ClipPropertiesDialog({ isOpen, controller, snapshot, copy, onClose }) {
	return (
		<ControlledDialog
			isOpen={isOpen}
			title={copy.clipProperties || copy.clip}
			onClose={onClose}
			width={720}
			className="audio-editor-clip-properties-dialog"
			dataAttributes={{ 'data-clip-properties-dialog': '' }}
		>
			<ClipProperties controller={controller} snapshot={snapshot} copy={copy} />
		</ControlledDialog>
	);
}

function ClipProperties({ controller, snapshot, copy }) {
	const project = snapshot.project;
	const clip = project && snapshot.selectedClipId ? findClip(project, snapshot.selectedClipId) : null;
	const source = clip ? findSource(project, clip.sourceId) : null;
	const track = clip ? findClipTrack(project, clip.id) : null;
	const sampleRate = project?.sampleRate || AUDIO_EDITOR_SAMPLE_RATE;
	const blocked = editingBlocked(snapshot);
	const disabled = blocked || !clip;
	const [error, setError] = useState('');

	useEffect(() => setError(''), [clip?.id]);

	const commitField = (name, rawValue) => {
		if (!clip || !track || disabled || name === 'name') return;
		try {
			if (name === 'start' || name === 'startFrame') {
				const timelineStartFrame = name === 'start'
					? secondsInputToFrames(rawValue, copy, sampleRate)
					: nonNegativeFrame(rawValue, copy);
				controller.actions.clip.move(clip.id, track.id, timelineStartFrame);
			} else if (name === 'sourceIn' || name === 'sourceInFrame') {
				const sourceStartFrame = name === 'sourceIn'
					? secondsInputToFrames(rawValue, copy, sampleRate)
					: nonNegativeFrame(rawValue, copy);
				controller.actions.clip.trim(clip.id, { sourceStartFrame });
			} else if (name === 'duration' || name === 'durationFrame') {
				const durationFrames = Math.max(1, name === 'duration'
					? secondsInputToFrames(rawValue, copy, sampleRate)
					: nonNegativeFrame(rawValue, copy));
				const sourceStartFrame = clip.reversed
					? clip.sourceStartFrame + clip.durationFrames - durationFrames
					: clip.sourceStartFrame;
				controller.actions.clip.trim(clip.id, { sourceStartFrame, durationFrames });
			} else if (name === 'gain') {
				controller.actions.clip.update(clip.id, { gain: dbToLinear(rawValue, 16, copy) });
			} else if (name === 'fadeIn' || name === 'fadeOut') {
				const frames = Math.min(clip.durationFrames, secondsInputToFrames(rawValue, copy, sampleRate));
				controller.actions.clip.update(clip.id, { [`${name}Frames`]: frames });
			} else if (name === 'pitchCents') {
				controller.actions.clip.setTimePitch(clip.id, { pitchCents: Number(rawValue) });
			} else if (name === 'speedRatio') {
				controller.actions.clip.setTimePitch(clip.id, { speedRatio: Number(rawValue) });
			}
			setError('');
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const run = (action) => {
		if (!clip || disabled) return;
		setError('');
		Promise.resolve(action(clip.id)).catch((cause) => {
			setError(cause instanceof Error ? cause.message : String(cause));
		});
	};

	return (
		<div className="audio-editor-clip-inspector">
			{!clip && <p className="audio-editor-panel-hint" data-no-clip>{copy.noClipSelected}</p>}
			<div className="audio-editor-field-grid" data-clip-fields aria-disabled={disabled}>
				<CommitField label={copy.clipName} name="name" value={source?.name || copy.clip} disabled readOnly onCommit={commitField} />
				<CommitField label={copy.clipStart} name="start" value={clip ? framesToSecondsText(clip.timelineStartFrame, sampleRate) : '0.000'} disabled={disabled} onCommit={commitField} />
				<CommitField label={copy.clipIn} name="sourceIn" value={clip ? framesToSecondsText(clip.sourceStartFrame, sampleRate) : '0.000'} disabled={disabled} onCommit={commitField} />
				<CommitField label={copy.clipDuration} name="duration" value={clip ? framesToSecondsText(clip.durationFrames, sampleRate) : '0.000'} disabled={disabled} onCommit={commitField} />
				<CommitField label={`${copy.clipStart} (${copy.frames})`} name="startFrame" value={clip?.timelineStartFrame ?? 0} type="number" disabled={disabled} onCommit={commitField} />
				<CommitField label={`${copy.clipIn} (${copy.frames})`} name="sourceInFrame" value={clip?.sourceStartFrame ?? 0} type="number" disabled={disabled} onCommit={commitField} />
				<CommitField label={`${copy.clipDuration} (${copy.frames})`} name="durationFrame" value={clip?.durationFrames ?? 1} type="number" disabled={disabled} onCommit={commitField} />
				<CommitField label={`${copy.clipGain} (dB)`} name="gain" value={clip ? linearToDb(clip.gain).toFixed(2) : '0.00'} type="number" disabled={disabled} onCommit={commitField} />
				<CommitField label={`${copy.fadeIn} (s)`} name="fadeIn" value={clip ? framesToSecondsText(clip.fadeInFrames, sampleRate) : '0.000'} type="number" disabled={disabled} onCommit={commitField} />
				<CommitField label={`${copy.fadeOut} (s)`} name="fadeOut" value={clip ? framesToSecondsText(clip.fadeOutFrames, sampleRate) : '0.000'} type="number" disabled={disabled} onCommit={commitField} />
				<CommitField label={copy.clipPitchCents} name="pitchCents" value={clip?.pitchCents ?? 0} type="number" disabled={disabled} onCommit={commitField} />
				<CommitField label={copy.clipSpeedRatio} name="speedRatio" value={clip?.speedRatio ?? 1} type="number" disabled={disabled} onCommit={commitField} />
			</div>
			<label className="audio-editor-field" data-clip-field="preserveFormants">
				<span><input
					type="checkbox"
					checked={Boolean(clip?.preserveFormants)}
					disabled={disabled}
					onChange={(event) => controller.actions.clip.setTimePitch(clip.id, { preserveFormants: event.currentTarget.checked })}
				/> {copy.preserveFormants}</span>
			</label>
			<label className="audio-editor-field" data-clip-field="stretchToTempo">
				<span><input
					type="checkbox"
					checked={Boolean(clip?.stretchToTempo)}
					disabled={disabled}
					onChange={() => controller.actions.clip.toggleStretchToTempo(clip.id)}
				/> {copy.stretchToTempo}</span>
			</label>
			{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
			<div className="audio-editor-panel-actions">
				<ActionHook hook="reverse"><Button disabled={disabled} onClick={() => run(controller.actions.clip.reverse)}>{copy.reverse}</Button></ActionHook>
				<ActionHook hook="normalize-peak"><Button disabled={disabled} onClick={() => run(controller.actions.clip.normalizePeak)}>{copy.normalizePeak}</Button></ActionHook>
				<ActionHook hook="normalize-lufs"><Button disabled={disabled} onClick={() => run(controller.actions.clip.normalizeLoudness)}>{copy.normalizeLufs}</Button></ActionHook>
				<ActionHook hook="render-pitch-speed"><Button disabled={disabled || !clip || (clip.pitchCents === 0 && clip.speedRatio === 1)} onClick={() => run(controller.actions.clip.renderPitchSpeed)}>{copy.renderPitchSpeed}</Button></ActionHook>
				<ActionHook hook="reset-pitch-speed"><Button variant="secondary" disabled={disabled || !clip || (clip.pitchCents === 0 && clip.speedRatio === 1)} onClick={() => run(controller.actions.clip.resetPitchSpeed)}>{copy.resetPitchSpeed}</Button></ActionHook>
			</div>
		</div>
	);
}

export function AudioEditorEffectsOverlay({
	isOpen,
	controller,
	snapshot,
	copy,
	locale,
	onClose,
	position = {},
}) {
	const project = snapshot.project;
	const selectedTrack = project ? findTrack(project, snapshot.selectedTrackId) : null;
	const trackEffects = selectedTrack?.effects || [];
	const masterEffects = project?.master?.effects || [];
	const blocked = !snapshot.ready || !project || editingBlocked(snapshot);
	const [picker, setPicker] = useState(null);
	const [selectedEffect, setSelectedEffect] = useState(null);
	const [message, setMessage] = useState('');

	useEffect(() => {
		if (!selectedEffect) return;
		const rack = selectedEffect.scope === 'master' ? masterEffects : trackEffects;
		if (!rack.some((effect) => effect.id === selectedEffect.id)) setSelectedEffect(null);
	}, [masterEffects, selectedEffect, trackEffects]);

	useEffect(() => {
		if (!isOpen) {
			setPicker(null);
			setSelectedEffect(null);
			setMessage('');
		}
	}, [isOpen]);

	const run = (work) => {
		setMessage('');
		return Promise.resolve().then(work).catch((cause) => {
			setMessage(cause instanceof Error ? cause.message : String(cause));
		});
	};

	const openPicker = (scope, replaceId = null) => {
		if (blocked || (scope === 'track' && !selectedTrack)) return;
		setPicker({ scope, replaceId });
		setMessage('');
	};

	const replaceFromRegistry = (scope, effect, candidate) => {
		const type = resolveSupportedEffectType(candidate, locale);
		if (!type) {
			setMessage(copy.effectEngineUnsupported);
			return;
		}
		const fresh = createEffect(type);
		const changes = {
			type,
			params: fresh.params,
			context: fresh.context ?? null,
			state: fresh.state ?? null,
		};
		if (type === 'audacity-noise-reduction') changes.enabled = false;
		if (type === 'audacity-auto-duck') {
			const targetTrackId = scope === 'track' ? selectedTrack?.id : null;
			const controlTrack = project?.tracks.find((track) => track.id !== targetTrackId);
			if (!controlTrack) {
				setMessage(copy.autoDuckSecondControlTrack);
				return;
			}
			changes.context = { controlTrackId: controlTrack.id };
		}
		controller.actions.effects.update(scope, selectedTrack?.id || null, effect.id, {
			...changes,
		});
	};

	const section = (scope, effects) => ({
		effects: effects.map((effect) => ({
			id: effect.id,
			name: safeEffectLabel(effect.type, locale),
			enabled: effect.enabled,
		})),
		allEnabled: effects.length > 0 && effects.every((effect) => effect.enabled),
		onToggleAll: (enabled) => {
			if (blocked) return;
			for (const effect of effects) controller.actions.effects.update(scope, selectedTrack?.id || null, effect.id, { enabled });
		},
		onEffectToggle: (index, enabled) => {
			const effect = effects[index];
			if (!blocked && effect) controller.actions.effects.update(scope, selectedTrack?.id || null, effect.id, { enabled });
		},
		onEffectChange: (index) => {
			const effect = effects[index];
			if (effect) setSelectedEffect({ scope, id: effect.id });
		},
		onEffectsReorder: (fromIndex, toIndex) => {
			const effect = effects[fromIndex];
			if (!blocked && effect) controller.actions.effects.reorder(scope, selectedTrack?.id || null, effect.id, toIndex);
		},
		onAddEffect: () => openPicker(scope),
		onRemoveEffect: (index) => {
			const effect = effects[index];
			if (!blocked && effect) controller.actions.effects.remove(scope, selectedTrack?.id || null, effect.id);
		},
		onReplaceEffect: (index, candidate) => {
			const effect = effects[index];
			if (!blocked && effect) replaceFromRegistry(scope, effect, candidate);
		},
		onChangeEffect: (index) => openPicker(scope, effects[index]?.id || null),
	});

	const effectRack = selectedEffect?.scope === 'master' ? masterEffects : trackEffects;
	const effect = effectRack.find((candidate) => candidate.id === selectedEffect?.id) || null;
	const effectScope = selectedEffect?.scope || 'track';

	return (
		<>
			<div className="audio-editor-effects-overlay" data-open={isOpen ? 'true' : 'false'}>
				<div data-effect-rack>
					<EffectsPanel
						isOpen={isOpen}
						resizable={false}
						mode="overlay"
						left={position.left}
						top={position.top}
						width={position.width}
						height={position.height}
						onClose={onClose}
						trackSection={selectedTrack ? { trackName: selectedTrack.name, ...section('track', trackEffects) } : undefined}
						masterSection={{ ...section('master', masterEffects) }}
					/>
				</div>

				{isOpen && (
					<div className="audio-editor-effects-overlay__adapters">
						{!selectedTrack && <p className="audio-editor-panel-hint">{copy.audacitySelectionHint}</p>}
						{trackEffects.length === 0 && masterEffects.length === 0 && (
							<p className="audio-editor-panel-hint" data-effect-empty>{copy.effectRackEmpty}</p>
						)}
						{message && <p className="audio-editor-field-error" role="alert">{message}</p>}
						<div className="audio-editor-master-gain" data-master-gain>
							<CommitField
								label={`${copy.masterGain} (dB)`}
								name="masterGain"
								type="number"
								value={project ? linearToDb(project.master.gain).toFixed(2) : '0.00'}
								disabled={blocked || !project}
								onCommit={(_name, value) => controller.actions.effects.setMasterGain(dbToLinear(value, 4, copy))}
							/>
						</div>
					</div>
				)}
			</div>

			{effect && (
				<ControlledDialog
					isOpen
					title={safeEffectLabel(effect.type, locale)}
					onClose={() => setSelectedEffect(null)}
					width={620}
					className="audio-editor-effect-settings-dialog"
					dataAttributes={{ 'data-effect': effect.id }}
				>
					<section className="audio-editor-effect-settings">
						<EffectParameterEditor
							effect={effect}
							locale={locale}
							copy={copy}
							disabled={blocked}
							tracks={project?.tracks || []}
							targetTrackId={effectScope === 'track' ? selectedTrack?.id : null}
							captureNoiseProfile={controller.actions.effects.captureRackNoiseProfile
								? () => run(() => controller.actions.effects.captureRackNoiseProfile(
									effectScope,
									selectedTrack?.id || null,
									effect.id,
								))
								: null}
							noiseProfileLabel={effect.context?.noiseProfile ? copy.replaceNoiseProfile : copy.getNoiseProfile}
							onChange={(changes) => run(() => controller.actions.effects.update(
								effectScope,
								selectedTrack?.id || null,
								effect.id,
								changes,
							))}
						/>
					</section>
				</ControlledDialog>
			)}

			{picker && (
				<EffectPicker
					copy={copy}
					locale={locale}
					disabled={blocked}
					onClose={() => setPicker(null)}
					onChoose={(type) => run(async () => {
						if (picker.replaceId) {
							const rack = picker.scope === 'master' ? masterEffects : trackEffects;
							const current = rack.find((candidate) => candidate.id === picker.replaceId);
							if (current) replaceFromRegistry(picker.scope, current, type);
						} else {
						const id = await controller.actions.effects.add({
							scope: picker.scope,
							trackId: selectedTrack?.id || null,
							type,
						});
						if (id && effectHasEditableSettings(type)) {
							setSelectedEffect({ scope: picker.scope, id });
						}
						}
						setPicker(null);
					})}
				/>
			)}
		</>
	);
}

export function SelectionEffectsDialog({ isOpen, controller, snapshot, copy, locale, onClose }) {
	const project = snapshot.project;
	const selectedTrack = project ? findTrack(project, snapshot.selectedTrackId) : null;
	const blocked = !snapshot.ready || !project || editingBlocked(snapshot);
	const initialType = snapshot.effects?.selectionType || audacityEffectTypes()[0];
	const [selectionType, setSelectionType] = useState(initialType);
	const [selectionParams, setSelectionParams] = useState(() => (
		snapshot.effects?.selectionParams || audacityEffectDefaults(initialType)
	));
	const [controlTrackId, setControlTrackId] = useState(snapshot.effects?.controlTrackId || '');
	const [message, setMessage] = useState('');
	const [selectedPresetId, setSelectedPresetId] = useState('');
	const [presetName, setPresetName] = useState('');
	const presetFileRef = useRef(null);

	useEffect(() => {
		if (!snapshot.effects) return;
		const nextType = snapshot.effects.selectionType || audacityEffectTypes()[0];
		setSelectionType(nextType);
		setSelectionParams(snapshot.effects.selectionParams || audacityEffectDefaults(nextType));
		setControlTrackId(snapshot.effects.controlTrackId || '');
		if (!snapshot.effects.presets?.some((preset) => preset.id === selectedPresetId)) setSelectedPresetId('');
	}, [snapshot.effects]);

	const run = (work) => {
		setMessage('');
		return Promise.resolve().then(work).catch((cause) => {
			setMessage(cause instanceof Error ? cause.message : String(cause));
		});
	};
	const chooseSelectionType = (type) => {
		if (!AUDACITY_EFFECT_DEFINITIONS[type]) return;
		const params = audacityEffectDefaults(type);
		setSelectionType(type);
		setSelectionParams(params);
		controller.actions.effects.setSelectionType(type);
		controller.actions.effects.setSelectionParams(params, { replace: true });
	};
	const updateSelectionParams = (changes) => {
		setSelectionParams((current) => ({ ...current, ...changes }));
		controller.actions.effects.setSelectionParams(changes);
	};
	const selectionDefinition = AUDACITY_EFFECT_DEFINITIONS[selectionType];
	const selectionControlTracks = (project?.tracks || []).filter((track) => track.id !== selectedTrack?.id);
	const effectPresets = snapshot.effects?.presets || [];
	const applyPreset = () => run(() => {
		const preset = controller.actions.effects.presets.apply(selectedPresetId);
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
	const exportPreset = () => run(() => {
		const encoded = controller.actions.effects.presets.export(selectedPresetId);
		const blob = new Blob([encoded], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `${(presetName || 'audacity-effect-preset').replace(/[^a-z0-9_-]+/gi, '-')}.json`;
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	});

	return (
		<ControlledDialog
			isOpen={isOpen}
			title={copy.selectionEffects || copy.audacityEffectsTitle}
			onClose={() => {
				controller.actions.effects.cancelPreview();
				onClose?.();
			}}
			width={720}
			className="audio-editor-selection-effects-dialog"
			dataAttributes={{ 'data-selection-effects-dialog': '' }}
		>
			<section className="audio-editor-selection-effects" data-audacity-effect-panel>
				<h3>{copy.audacityEffectsTitle}</h3>
				<p className="audio-editor-panel-hint">{copy.audacityEffectsDescription}</p>
				<LabeledDropdown
					label={copy.chooseAudacityEffect}
					value={selectionType}
					options={audacityEffectTypes().map((type) => ({ value: type, label: audacityEffectLabel(type, locale) }))}
					onChange={chooseSelectionType}
					disabled={blocked}
					hook="audacity-effect-type"
				/>
				<fieldset className="audio-editor-effect-presets" data-effect-presets>
					<legend>{copy.effectPresets}</legend>
					<label>
						<span>{copy.chooseEffectPreset}</span>
						<select value={selectedPresetId} onChange={(event) => {
							const id = event.currentTarget.value;
							setSelectedPresetId(id);
							setPresetName(effectPresets.find((preset) => preset.id === id)?.name || '');
						}} disabled={blocked || !effectPresets.length}>
							<option value="">{copy.noEffectPreset}</option>
							{effectPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
						</select>
					</label>
					<label>
						<span>{copy.effectPresetName}</span>
						<input value={presetName} onChange={(event) => setPresetName(event.currentTarget.value)} disabled={blocked} />
					</label>
					<div className="audio-editor-panel-actions">
						<Button variant="secondary" disabled={blocked || !selectedPresetId} onClick={applyPreset}>{copy.applyEffectPreset}</Button>
						<Button variant="secondary" disabled={blocked || !selectedPresetId || !presetName.trim()} onClick={() => savePreset(selectedPresetId)}>{copy.saveEffectPreset}</Button>
						<Button variant="secondary" disabled={blocked || !presetName.trim()} onClick={() => savePreset()}>{copy.saveEffectPresetAs}</Button>
						<Button variant="secondary" disabled={blocked || !selectedPresetId} onClick={() => run(async () => {
							await controller.actions.effects.presets.delete(selectedPresetId);
							setSelectedPresetId('');
							setPresetName('');
						})}>{copy.deleteEffectPreset}</Button>
						<Button variant="secondary" disabled={blocked} onClick={() => presetFileRef.current?.click()}>{copy.importEffectPreset}</Button>
						<Button variant="secondary" disabled={blocked || !selectedPresetId} onClick={exportPreset}>{copy.exportEffectPreset}</Button>
						<input ref={presetFileRef} type="file" accept="application/json,.json" hidden onChange={(event) => importPreset(event.currentTarget.files?.[0])} />
					</div>
				</fieldset>
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
					effect={{ type: selectionType, params: selectionParams, context: null }}
					locale={locale}
					copy={copy}
					disabled={blocked}
					tracks={project?.tracks || []}
					targetTrackId={selectedTrack?.id || null}
					onChange={(changes) => changes.params && updateSelectionParams(changes.params)}
				/>
				<p className="audio-editor-panel-hint" data-audacity-effect-hint>{copy.audacitySelectionHint}</p>
				{message && <p className="audio-editor-field-error" role="alert">{message}</p>}
				<div className="audio-editor-panel-actions">
					{selectionType === 'audacity-noise-reduction' && (
						<span data-audacity-noise-profile>
							<Button disabled={blocked} onClick={() => run(controller.actions.effects.captureNoiseProfile)}>
								{snapshot.effects?.noiseProfileReady ? copy.noiseProfileReady : copy.getNoiseProfile}
							</Button>
						</span>
					)}
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
				</div>
			</section>
		</ControlledDialog>
	);
}

function EffectPicker({ copy, locale, disabled, onClose, onChoose }) {
	const types = useMemo(() => audioEffectTypes(), []);
	const [type, setType] = useState(types[0] || '');
	return (
		<ControlledDialog
			isOpen
			title={copy.chooseEffect}
			onClose={onClose}
			width={440}
			className="audio-editor-effect-picker-dialog"
			dataAttributes={{ 'data-effect-picker': '' }}
		>
			<div className="audio-editor-local-dialog__body">
				<LabeledDropdown
					label={copy.chooseEffect}
					options={types.map((value) => ({ value, label: safeEffectLabel(value, locale) }))}
					value={type}
					onChange={setType}
					disabled={disabled}
					hook="effect-type"
				/>
				<div className="audio-editor-panel-actions">
					<Button variant="primary" disabled={disabled || !type} onClick={() => onChoose(type)}>{copy.addEffect}</Button>
					<Button onClick={onClose}>{copy.cancel}</Button>
				</div>
			</div>
		</ControlledDialog>
	);
}

function EffectParameterEditor({
	effect,
	locale,
	copy,
	disabled,
	tracks,
	targetTrackId,
	captureNoiseProfile,
	noiseProfileLabel,
	onChange,
}) {
	const [error, setError] = useState('');
	const definition = isAudacityDefinition(effect.type) ? AUDACITY_EFFECT_DEFINITIONS[effect.type] : null;
	const update = (changes) => {
		setError('');
		Promise.resolve().then(() => onChange(changes)).catch((cause) => {
			setError(cause instanceof Error ? cause.message : String(cause));
		});
	};
	const updateParam = (name, value) => update({ params: { [name]: value } });

	if (!definition) {
		if (effect.type === 'eq') {
			return (
				<div className="audio-editor-effect-parameters" data-effect-parameters>
					{(effect.params.bands || []).flatMap((band, index) => [
						<ParameterNumber key={`${index}-frequency`} label={`B${index + 1} Hz`} value={band.frequency} range={[10, 24_000]} copy={copy} disabled={disabled} hook={`bands.${index}.frequency`} onCommit={(value) => updateEqBand(effect, index, 'frequency', value, update)} />,
						<ParameterNumber key={`${index}-gain`} label={`B${index + 1} dB`} value={band.gain} range={[-24, 24]} copy={copy} disabled={disabled} hook={`bands.${index}.gain`} onCommit={(value) => updateEqBand(effect, index, 'gain', value, update)} />,
						<ParameterNumber key={`${index}-q`} label={`B${index + 1} Q`} value={band.q} range={[0.1, 30]} copy={copy} disabled={disabled} hook={`bands.${index}.q`} onCommit={(value) => updateEqBand(effect, index, 'q', value, update)} />,
					])}
					{error && <p role="alert">{error}</p>}
				</div>
			);
		}
		const ranges = AUDIO_EFFECT_DEFINITIONS[effect.type]?.ranges || {};
		return (
			<div className="audio-editor-effect-parameters" data-effect-parameters>
				{Object.entries(effect.params || {}).filter(([, value]) => typeof value === 'number').map(([name, value]) => (
					<ParameterNumber key={name} label={effectParameterLabel(name, copy)} value={value} range={ranges[name]} copy={copy} disabled={disabled} hook={name} onCommit={(next) => updateParam(name, next)} />
				))}
				{error && <p role="alert">{error}</p>}
			</div>
		);
	}

	const candidates = tracks.filter((track) => track.id !== targetTrackId);
	return (
		<div className="audio-editor-effect-parameters" data-effect-parameters>
			{definition.requiresControlTrack && (
				<LabeledDropdown
					label={copy.controlTrack}
					value={effect.context?.controlTrackId || ''}
					options={candidates.map((track) => ({ value: track.id, label: track.name }))}
					onChange={(controlTrackId) => update({ context: { controlTrackId: controlTrackId || null } })}
					disabled={disabled || candidates.length === 0}
					hook="effect-context-controlTrackId"
				/>
			)}
			{Object.entries(definition.params).map(([name, descriptor]) => (
				<AudacityParameter
					key={name}
						name={name}
						effectType={effect.type}
						descriptor={descriptor}
					value={effect.params?.[name]}
					locale={locale}
					copy={copy}
					disabled={disabled}
					onCommit={(value) => updateParam(name, value)}
				/>
			))}
			{definition.requiresNoiseProfile && !effect.context?.noiseProfile && (
				<p className="audio-editor-panel-hint">{copy.rackNoiseProfileMissing}</p>
			)}
			{definition.requiresNoiseProfile && captureNoiseProfile && (
				<span data-effect-noise-profile>
					<Button disabled={disabled} onClick={captureNoiseProfile}>{noiseProfileLabel}</Button>
				</span>
			)}
			{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
		</div>
	);
}

function AudacityParameter({ name, effectType, descriptor, value, locale, copy, disabled, onCommit }) {
	const label = localized(descriptor.label, locale);
	if (descriptor.kind === 'boolean') {
		return (
			<div data-effect-param={name}>
				<DesignCheckbox label={label} checked={Boolean(value)} disabled={disabled} onChange={onCommit} />
			</div>
		);
	}
	if (descriptor.kind === 'enum') {
		return (
			<LabeledDropdown
				label={label}
				value={String(value)}
				options={descriptor.options.map((option) => ({ value: String(option.value), label: localized(option.label, locale) }))}
				onChange={onCommit}
				disabled={disabled}
				hook={`effect-param-${name}`}
			/>
		);
	}
	if (descriptor.kind === 'curve') {
		return (
			<CommitField
				label={label}
				name={name}
				value={formatAudacityCurve(value)}
				disabled={disabled}
				multiline
				hookName="effect-param"
				onCommit={(_field, next) => onCommit(parseAudacityCurve(next))}
			/>
		);
	}
	if (descriptor.kind === 'bands') {
		return (
			<fieldset className="audio-editor-effect-bands">
				<legend>{label}</legend>
				{descriptor.frequencies.map((frequency, index) => (
					<ParameterNumber
						key={frequency}
						label={`${frequency} Hz`}
						value={value?.[index] ?? 0}
						range={[descriptor.minimum, descriptor.maximum]}
						copy={copy}
						disabled={disabled}
						hook={`${name}.${index}`}
						onCommit={(next) => {
							const values = [...value];
							values[index] = next;
							onCommit(values);
						}}
					/>
				))}
			</fieldset>
		);
	}
	const range = audioEffectParamRange(effectType, name) || audioEffectParamRangeFromDescriptor(descriptor);
	return (
		<ParameterNumber
			label={`${label}${descriptor.unit ? ` (${descriptor.unit})` : ''}`}
			value={value}
			range={range}
			copy={copy}
			disabled={disabled}
			hook={name}
			onCommit={onCommit}
		/>
	);
}

function ParameterNumber({ label, value, range, copy, disabled, hook, onCommit }) {
	return (
		<CommitField
			label={label}
			name={hook}
			value={String(value ?? '')}
			type="number"
			disabled={disabled}
			hookName="effect-param"
			onCommit={(_name, raw) => {
				const next = Number(raw);
				if (!Number.isFinite(next) || (range && (next < range[0] || next > range[1]))) {
					throw new RangeError(copy.parameterRangeError
						.replace('{label}', label)
						.replace('{minimum}', String(range?.[0] ?? '−∞'))
						.replace('{maximum}', String(range?.[1] ?? '∞')));
				}
				onCommit(next);
			}}
		/>
	);
}

export function AnalysisDialog({ isOpen, mode = 'levels', controller, snapshot, copy, locale, onClose }) {
	return (
		<ControlledDialog
			isOpen={isOpen}
			title={copy.analysisDialog || copy.analysis}
			onClose={onClose}
			width={780}
			className="audio-editor-analysis-dialog"
			dataAttributes={{ 'data-analysis-dialog': '' }}
		>
			<AnalysisContent mode={mode} controller={controller} snapshot={snapshot} copy={copy} locale={locale} />
		</ControlledDialog>
	);
}

function AnalysisContent({ mode, controller, snapshot, copy, locale }) {
	const result = snapshot.analysis;
	const report = snapshot.analysisReport;
	const blocked = !snapshot.ready || !snapshot.project?.clips?.length || snapshot.importing || snapshot.recording || snapshot.exporting || snapshot.analysisProcessing || snapshot.missingSourceIds?.length > 0;
	const [error, setError] = useState('');
	const run = (scope) => {
		setError('');
		const action = mode === 'spectrum'
			? controller.actions.analysis.plotSpectrum(scope)
			: mode === 'clipping'
				? controller.actions.analysis.findClipping(scope)
				: controller.actions.analysis.run(scope);
		Promise.resolve(action).catch((cause) => {
			setError(cause instanceof Error ? cause.message : String(cause));
		});
	};
	const captureContrast = (role) => {
		setError('');
		const scope = snapshot.selectedTrackId ? 'track' : 'master';
		Promise.resolve(controller.actions.analysis.contrast(role, scope)).catch((cause) => {
			setError(cause instanceof Error ? cause.message : String(cause));
		});
	};
	const values = [
		['peak', copy.peak, formatDb(result?.peakDbfs, 'dBFS')],
		['truePeak', copy.truePeak, formatDb(result?.truePeakDbtp, 'dBTP')],
		['rms', copy.rms, formatDb(result?.rmsDbfs, 'dBFS')],
		['momentary', copy.lufsMomentary, formatLoudness(result?.momentaryLufs, 'LUFS')],
		['shortTerm', copy.lufsShort, formatLoudness(result?.shortTermLufs, 'LUFS')],
		['integrated', copy.lufsIntegrated, formatLoudness(result?.integratedLufs, 'LUFS')],
		['lra', copy.lra, formatLoudness(result?.loudnessRangeLufs, 'LU')],
		['correlation', copy.correlation, Number.isFinite(result?.stereoCorrelation) ? result.stereoCorrelation.toFixed(3) : '—'],
		['clipping', copy.clipping, String(result?.clippedSamples ?? 0)],
	];
	return (
		<div className="audio-editor-analysis-inspector">
			<h3>{copy.metering}</h3>
			<div className="audio-editor-analysis-grid" data-analysis-values>
				{values.map(([key, label, value]) => (
					<div key={key}><span>{label}</span><strong data-analysis-value={key}>{value}</strong></div>
				))}
			</div>
			{snapshot.analysisVisuals && (
				<AnalysisVisuals visuals={snapshot.analysisVisuals} copy={copy} />
			)}
			<AnalysisReport report={report} mode={mode} copy={copy} locale={locale} sampleRate={snapshot.project?.sampleRate || 48_000} />
			{result && (
				<p className="audio-editor-panel-hint">
					{copy.analysisSummary
						.replace('{channelCount}', String(result.channelCount))
						.replace('{duration}', (result.durationSeconds || 0).toFixed(2))
						.replace('{sampleRate}', String(result.sampleRate))}
				</p>
			)}
			<p className="audio-editor-panel-hint">{copy.analyzeHint}</p>
			{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
			<div className="audio-editor-panel-actions">
				{mode === 'contrast' ? (
					<>
						<span data-analyze="contrast-foreground"><Button disabled={blocked || !snapshot.selection} onClick={() => captureContrast('foreground')}>{copy.captureContrastForeground}</Button></span>
						<span data-analyze="contrast-background"><Button disabled={blocked || !snapshot.selection} onClick={() => captureContrast('background')}>{copy.captureContrastBackground}</Button></span>
					</>
				) : (
					<>
						<span data-analyze="track"><Button disabled={blocked || !snapshot.selectedTrackId} onClick={() => run('track')}>{copy.analyzeTrack}</Button></span>
						<span data-analyze="master"><Button disabled={blocked} onClick={() => run('master')}>{copy.analyzeMaster}</Button></span>
					</>
				)}
			</div>
		</div>
	);
}

function AnalysisReport({ report, mode, copy, locale, sampleRate }) {
	if (!report || (mode !== 'levels' && report.type !== mode)) return null;
	if (report.type === 'spectrum') {
		return (
			<section className="audio-editor-analysis-report" data-analysis-report="spectrum">
				<h4>{copy.plotSpectrum}</h4>
				<p>{copy.spectrumPeak}: <strong>{Number(report.peak?.frequency || 0).toFixed(1)} Hz · {formatDb(report.peak?.db, 'dB')}</strong></p>
				<p>{report.size} FFT · {report.sampleRate} Hz</p>
			</section>
		);
	}
	if (report.type === 'clipping') {
		return (
			<section className="audio-editor-analysis-report" data-analysis-report="clipping">
				<h4>{copy.findClipping}</h4>
				<p>{report.regionCount ? copy.clippingRegions.replace('{count}', String(report.regionCount)) : copy.noClippingRegions}</p>
				{report.regions?.length > 0 && (
					<ol>
						{report.regions.slice(0, 20).map((region) => (
							<li key={`${region.startFrame}-${region.endFrame}`}>
								{(region.startFrame / sampleRate).toFixed(3)}–{(region.endFrame / sampleRate).toFixed(3)} s · {formatDb(20 * Math.log10(region.peakAmplitude), 'dBFS')}
							</li>
						))}
					</ol>
				)}
			</section>
		);
	}
	if (report.type === 'contrast') {
		const difference = Number.isFinite(report.differenceDb) ? `${report.differenceDb.toFixed(2)} dB` : '—';
		return (
			<section className="audio-editor-analysis-report" data-analysis-report="contrast">
				<h4>{copy.contrast}</h4>
				<p>{copy.contrastForeground}: <strong>{formatDb(report.foreground?.rmsDb, 'dBFS')}</strong></p>
				<p>{copy.contrastBackground}: <strong>{formatDb(report.background?.rmsDb, 'dBFS')}</strong></p>
				<p>{copy.contrastDifference}: <strong>{difference}</strong></p>
				{report.passes != null && <p role="status">{report.passes ? copy.contrastPass : copy.contrastFail}</p>}
			</section>
		);
	}
	return null;
}

function AnalysisVisuals({ visuals, copy }) {
	const spectrumRef = useRef(null);
	const spectrogramRef = useRef(null);
	useBoundedAnalysisCanvas(spectrumRef, visuals.spectrum?.samples, drawSpectrum);
	useBoundedAnalysisCanvas(spectrogramRef, visuals.spectrum?.samples, drawSpectrogram);
	return (
		<div className="audio-editor-analysis-visuals">
			<figure>
				<figcaption>{copy.spectrum}</figcaption>
				<canvas ref={spectrumRef} data-analysis-spectrum aria-label={copy.spectrum} role="img" />
			</figure>
			<figure>
				<figcaption>{copy.spectrogram}</figcaption>
				<canvas ref={spectrogramRef} data-analysis-spectrogram aria-label={copy.spectrogram} role="img" />
			</figure>
		</div>
	);
}

function useBoundedAnalysisCanvas(canvasRef, samples, draw) {
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !samples?.length) return undefined;
		const render = () => {
			const cssWidth = Math.max(160, Math.round(canvas.clientWidth || 320));
			const cssHeight = 112;
			const dimensions = boundedCanvasDimensions(cssWidth, cssHeight, {
				devicePixelRatio: window.devicePixelRatio || 1,
				maximumBackingWidth: 1_024,
				maximumBackingHeight: 256,
				maximumBackingPixels: 262_144,
			});
			canvas.width = dimensions.backingWidth;
			canvas.height = dimensions.backingHeight;
			canvas.style.height = `${dimensions.cssHeight}px`;
			const context = canvas.getContext('2d');
			if (!context) return;
			context.setTransform(dimensions.pixelRatioX, 0, 0, dimensions.pixelRatioY, 0, 0);
			draw(context, samples, dimensions.cssWidth, dimensions.cssHeight);
		};
		render();
		const observer = new ResizeObserver(render);
		observer.observe(canvas);
		return () => observer.disconnect();
	}, [canvasRef, draw, samples]);
}

function drawSpectrum(context, samples, width, height) {
	context.clearRect(0, 0, width, height);
	context.fillStyle = '#11141a';
	context.fillRect(0, 0, width, height);
	const windowSize = Math.min(4_096, highestPowerOfTwo(samples.length));
	if (windowSize < 2) return;
	const start = Math.max(0, Math.floor((samples.length - windowSize) / 2));
	const bins = Math.min(128, Math.max(32, Math.floor(width / 2)));
	context.beginPath();
	for (let bin = 0; bin < bins; bin += 1) {
		const frequencyBin = Math.max(1, Math.round((windowSize / 2 - 1) ** (bin / Math.max(1, bins - 1))));
		let real = 0;
		let imaginary = 0;
		for (let index = 0; index < windowSize; index += 1) {
			const sample = Number(samples[start + index] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * index / (windowSize - 1)));
			const phase = 2 * Math.PI * frequencyBin * index / windowSize;
			real += sample * Math.cos(phase);
			imaginary -= sample * Math.sin(phase);
		}
		const magnitude = Math.sqrt(real * real + imaginary * imaginary) / windowSize;
		const db = Math.max(-90, 20 * Math.log10(Math.max(1e-8, magnitude)));
		const x = bin / Math.max(1, bins - 1) * width;
		const y = height - (db + 90) / 90 * height;
		if (bin === 0) context.moveTo(x, y);
		else context.lineTo(x, y);
	}
	context.strokeStyle = '#66d3c5';
	context.lineWidth = 1.5;
	context.stroke();
}

function drawSpectrogram(context, samples, width, height) {
	context.clearRect(0, 0, width, height);
	context.fillStyle = '#090b10';
	context.fillRect(0, 0, width, height);
	const windowSize = Math.min(256, highestPowerOfTwo(samples.length));
	if (windowSize < 2) return;
	const columns = Math.min(96, Math.max(24, Math.floor(width / 3)));
	const rows = 48;
	for (let column = 0; column < columns; column += 1) {
		const start = Math.min(
			Math.max(0, samples.length - windowSize),
			Math.round(column / Math.max(1, columns - 1) * Math.max(0, samples.length - windowSize)),
		);
		for (let row = 0; row < rows; row += 1) {
			const bin = Math.max(1, Math.round((windowSize / 2 - 1) ** ((rows - row) / rows)));
			let real = 0;
			let imaginary = 0;
			for (let index = 0; index < windowSize; index += 1) {
				const sample = Number(samples[start + index] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * index / (windowSize - 1)));
				const phase = 2 * Math.PI * bin * index / windowSize;
				real += sample * Math.cos(phase);
				imaginary -= sample * Math.sin(phase);
			}
			const magnitude = Math.sqrt(real * real + imaginary * imaginary) / windowSize;
			const intensity = Math.max(0, Math.min(1, (20 * Math.log10(Math.max(1e-8, magnitude)) + 90) / 90));
			const hue = 255 - intensity * 205;
			context.fillStyle = `hsl(${hue} 85% ${8 + intensity * 54}%)`;
			context.fillRect(column / columns * width, row / rows * height, Math.ceil(width / columns) + 1, Math.ceil(height / rows) + 1);
		}
	}
}

function highestPowerOfTwo(value) {
	if (!Number.isFinite(value) || value < 1) return 0;
	return 2 ** Math.floor(Math.log2(value));
}

function effectHasEditableSettings(type) {
	if (AUDIO_EFFECT_DEFINITIONS[type]) return Object.keys(AUDIO_EFFECT_DEFINITIONS[type].defaults || {}).length > 0;
	const definition = AUDACITY_EFFECT_DEFINITIONS[type];
	return Boolean(definition && (
		Object.keys(definition.params || {}).length
		|| definition.requiresControlTrack
		|| definition.requiresNoiseProfile
	));
}

export function ExportDialog({ isOpen, controller, snapshot, copy, locale, onClose }) {
	const telemetry = useAudioEditorTelemetry(controller);
	const [settings, setSettings] = useState({
		mode: 'mix',
		range: 'project',
		format: 'wav',
		sampleFormat: 'int24',
		bitRate: '192',
		compressionLevel: '5',
		sampleRate: String(snapshot.project?.sampleRate || 48_000),
		channelMapping: 'preserve',
		channelMatrix: '',
		dither: 'triangular',
		quality: '5',
		metadataTitle: snapshot.project?.metadata?.title || snapshot.project?.title || '',
		metadataArtist: snapshot.project?.metadata?.artist || '',
		metadataAlbum: snapshot.project?.metadata?.album || '',
		metadataTrack: snapshot.project?.metadata?.trackNumber || '',
		metadataYear: snapshot.project?.metadata?.year || '',
		metadataGenre: snapshot.project?.metadata?.genre || '',
		metadataComments: snapshot.project?.metadata?.comments || '',
		metadataCopyright: snapshot.project?.metadata?.copyright || '',
		metadataCustom: JSON.stringify(snapshot.project?.metadata?.tags || {}, null, 2),
		customExtension: '',
		customMimeType: 'application/octet-stream',
		customArguments: '',
		includeTail: true,
	});
	const [error, setError] = useState('');
	const hasSelection = Boolean(snapshot.selection);
	const hasLoop = Boolean(snapshot.project?.loop?.enabled);
	const exporting = Boolean(snapshot.exporting);
	const progress = Math.round(Math.max(0, Math.min(1, telemetry?.exportProgress ?? snapshot.export?.progress ?? 0)) * 100);
	const output = snapshot.export?.output;
	const blocked = !snapshot.ready || snapshot.importing || snapshot.recording || snapshot.processingEffect || snapshot.missingSourceIds?.length > 0 || !snapshot.project?.clips?.length;

	useEffect(() => {
		if (!hasSelection && settings.range === 'selection') setSettings((current) => ({ ...current, range: 'project' }));
	}, [hasSelection, settings.range]);

	useEffect(() => {
		const descriptor = MEDIA_EXPORT_FORMATS[settings.format];
		if (descriptor?.sampleFormats?.length && !descriptor.sampleFormats.includes(settings.sampleFormat)) {
			setSettings((current) => ({ ...current, sampleFormat: descriptor.defaults.sampleFormat }));
		} else if (settings.sampleFormat === 'float32' && settings.dither !== 'none') {
			setSettings((current) => ({ ...current, dither: 'none' }));
		}
	}, [settings.dither, settings.format, settings.sampleFormat]);

	const set = (name, value) => setSettings((current) => ({ ...current, [name]: value }));
	const setFormat = (format) => setSettings((current) => ({
		...current,
		format,
		sampleFormat: MEDIA_EXPORT_FORMATS[format]?.defaults?.sampleFormat || current.sampleFormat,
		bitRate: format === 'opus' ? '160' : format === 'mp2' ? '256' : ['mp3', 'aac-m4a'].includes(format) ? '192' : current.bitRate,
		compressionLevel: format === 'flac' ? '5' : format === 'wavpack' ? '2' : current.compressionLevel,
	}));
	const start = () => {
		try {
			setError('');
			const customMetadata = parseJsonObject(settings.metadataCustom, copy.customMetadata, copy);
			const metadata = compactFields({
				...customMetadata,
				title: settings.metadataTitle,
				artist: settings.metadataArtist,
				album: settings.metadataAlbum,
				trackNumber: settings.metadataTrack,
				year: settings.metadataYear,
				genre: settings.metadataGenre,
				comments: settings.metadataComments,
				copyright: settings.metadataCopyright,
			});
			const request = {
				mode: settings.mode,
				range: settings.range,
				format: settings.format,
				sampleFormat: settings.sampleFormat,
				bitDepth: Number(settings.sampleFormat.replace(/\D/g, '')) || undefined,
				floatingPoint: settings.sampleFormat === 'float32',
				bitRate: ['mp3', 'opus', 'mp2', 'aac-m4a'].includes(settings.format) ? Number(settings.bitRate) : undefined,
				quality: settings.format === 'ogg-vorbis' ? Number(settings.quality) : undefined,
				compressionLevel: ['flac', 'wavpack'].includes(settings.format) ? Number(settings.compressionLevel) : undefined,
				sampleRate: Number(settings.sampleRate),
				channelMapping: settings.channelMapping === 'custom'
					? parseJsonChannelMapping(settings.channelMatrix, copy.customChannelMapping, copy)
					: settings.channelMapping,
				dither: settings.sampleFormat === 'float32' ? 'none' : settings.dither,
				metadata,
				extension: settings.customExtension,
				mimeType: settings.customMimeType,
				customArguments: settings.customArguments.split(/\r?\n/).map((argument) => argument.trim()).filter(Boolean),
				includeTail: settings.includeTail,
			};
			Promise.resolve(controller.actions.export.start(request)).catch((cause) => {
				setError(cause instanceof Error ? cause.message : String(cause));
			});
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const formatQualityOptions = ({
		mp3: [128, 192, 256, 320],
		opus: [64, 96, 128, 160, 192, 256, 320],
		mp2: [128, 160, 192, 224, 256, 320, 384],
		'aac-m4a': [96, 128, 160, 192, 256, 320],
	}[settings.format] || []).map(bitrateOption);
	const formatDescriptor = MEDIA_EXPORT_FORMATS[settings.format];
	const pcmFormat = Boolean(formatDescriptor?.sampleFormats?.length);
	const bitrateFormat = ['mp3', 'opus', 'mp2', 'aac-m4a'].includes(settings.format);
	const requestClose = () => {
		if (!exporting) onClose?.();
	};

	return (
		<ControlledDialog
			isOpen={isOpen}
			title={copy.exportDialog || copy.export}
			onClose={requestClose}
			closeOnEscape={!exporting}
			closeOnOutside={!exporting}
			width={760}
			className="audio-editor-export-dialog"
			dataAttributes={{ 'data-export-dialog': '' }}
		>
			<div className="audio-editor-export-dialog__body">
				<div className="audio-editor-export-grid">
					<LabeledDropdown label={copy.exportMode} hook="mode" value={settings.mode} onChange={(value) => set('mode', value)} disabled={exporting} options={[{ value: 'mix', label: copy.mix }, { value: 'stems', label: copy.stems }]} />
					<LabeledDropdown label={copy.exportRange} hook="range" value={settings.range} onChange={(value) => set('range', value)} disabled={exporting} options={[{ value: 'project', label: copy.entireProject }, { value: 'selection', label: copy.currentSelection, disabled: !hasSelection }, { value: 'loop', label: copy.loopRegion, disabled: !hasLoop }]} />
					<LabeledDropdown label={copy.format} hook="format" value={settings.format} onChange={setFormat} disabled={exporting} options={Object.values(MEDIA_EXPORT_FORMATS).map((descriptor) => ({
						value: descriptor.id,
						label: descriptor.id === 'custom-ffmpeg' ? copy.customFfmpeg : descriptor.label,
					}))} />
					{pcmFormat ? (
						<LabeledDropdown label={copy.sampleFormat || copy.bitDepth} hook="bitDepth" value={settings.sampleFormat} onChange={(value) => set('sampleFormat', value)} disabled={exporting} options={formatDescriptor.sampleFormats.map((sampleFormat) => ({
							value: sampleFormat,
							label: sampleFormat === 'float32'
								? copy.sampleFormatFloat32
								: copy.sampleFormatPcm.replace('{bits}', sampleFormat.slice(3)),
						}))} />
					) : bitrateFormat ? (
						<LabeledDropdown label={copy.quality} hook="quality" value={settings.bitRate} onChange={(value) => set('bitRate', value)} disabled={exporting} options={formatQualityOptions} />
					) : settings.format === 'ogg-vorbis' ? (
						<LabeledDropdown label={copy.quality} hook="quality" value={settings.quality} onChange={(value) => set('quality', value)} disabled={exporting} options={Array.from({ length: 12 }, (_, index) => ({ value: String(index - 1), label: String(index - 1) }))} />
					) : null}
					{['flac', 'wavpack'].includes(settings.format) && (
						<LabeledDropdown label={copy.quality} hook="quality" value={settings.compressionLevel} onChange={(value) => set('compressionLevel', value)} disabled={exporting} options={Array.from({ length: settings.format === 'flac' ? 9 : 6 }, (_, level) => ({ value: String(level), label: `${copy.level} ${level}` }))} />
					)}
					<label className="audio-editor-field" data-export-field="sampleRate"><span>{copy.sampleRate}</span><input type="number" min="8000" max="384000" step="1" list="audio-editor-export-rates" value={settings.sampleRate} disabled={exporting} onChange={(event) => set('sampleRate', event.currentTarget.value)} /><datalist id="audio-editor-export-rates">{[8_000, 16_000, 22_050, 32_000, 44_100, 48_000, 88_200, 96_000, 192_000, 384_000, snapshot.project?.sampleRate].filter((value, index, values) => value && values.indexOf(value) === index).map((value) => <option key={value} value={value} />)}</datalist></label>
					<LabeledDropdown label={copy.channelMapping} hook="channelMapping" value={settings.channelMapping} onChange={(value) => set('channelMapping', value)} disabled={exporting} options={[{ value: 'preserve', label: copy.preserveChannels }, { value: 'mono', label: copy.mono }, { value: 'stereo', label: copy.stereo }, { value: 'custom', label: copy.customChannelMapping }]} />
					{pcmFormat && settings.sampleFormat !== 'float32' && <LabeledDropdown label={copy.dither} hook="dither" value={settings.dither} onChange={(value) => set('dither', value)} disabled={exporting} options={[{ value: 'none', label: copy.none }, { value: 'triangular', label: copy.triangularDither }, { value: 'triangular-highpass', label: copy.highpassDither }]} />}
				</div>
				<div className="audio-editor-export-grid">
					{settings.channelMapping === 'custom' && <label className="audio-editor-field"><span>{copy.customChannelMapping}</span><TextInput multiline value={settings.channelMatrix} disabled={exporting} onChange={(value) => set('channelMatrix', value)} /><small>{copy.customChannelMappingHint}</small></label>}
					<label className="audio-editor-field"><span>{copy.metadataTitle}</span><TextInput value={settings.metadataTitle} disabled={exporting} onChange={(value) => set('metadataTitle', value)} /></label>
					<label className="audio-editor-field"><span>{copy.metadataArtist}</span><TextInput value={settings.metadataArtist} disabled={exporting} onChange={(value) => set('metadataArtist', value)} /></label>
					<label className="audio-editor-field"><span>{copy.metadataAlbum}</span><TextInput value={settings.metadataAlbum} disabled={exporting} onChange={(value) => set('metadataAlbum', value)} /></label>
					<label className="audio-editor-field"><span>{copy.metadataTrack}</span><TextInput value={settings.metadataTrack} disabled={exporting} onChange={(value) => set('metadataTrack', value)} /></label>
					<label className="audio-editor-field"><span>{copy.metadataYear}</span><TextInput value={settings.metadataYear} disabled={exporting} onChange={(value) => set('metadataYear', value)} /></label>
					<label className="audio-editor-field"><span>{copy.metadataGenre}</span><TextInput value={settings.metadataGenre} disabled={exporting} onChange={(value) => set('metadataGenre', value)} /></label>
					<label className="audio-editor-field"><span>{copy.metadataComments}</span><TextInput multiline value={settings.metadataComments} disabled={exporting} onChange={(value) => set('metadataComments', value)} /></label>
					<label className="audio-editor-field"><span>{copy.metadataCopyright}</span><TextInput value={settings.metadataCopyright} disabled={exporting} onChange={(value) => set('metadataCopyright', value)} /></label>
					<label className="audio-editor-field"><span>{copy.customMetadata}</span><TextInput multiline value={settings.metadataCustom} disabled={exporting} onChange={(value) => set('metadataCustom', value)} /></label>
					{settings.format === 'custom-ffmpeg' && <>
						<label className="audio-editor-field"><span>{copy.customExtension}</span><TextInput value={settings.customExtension} disabled={exporting} onChange={(value) => set('customExtension', value)} /></label>
						<label className="audio-editor-field"><span>{copy.customMimeType}</span><TextInput value={settings.customMimeType} disabled={exporting} onChange={(value) => set('customMimeType', value)} /></label>
						<label className="audio-editor-field"><span>{copy.customArguments}</span><TextInput multiline value={settings.customArguments} disabled={exporting} onChange={(value) => set('customArguments', value)} /></label>
					</>}
				</div>
				<div data-export-field="tails">
					<DesignCheckbox label={copy.includeTails} checked={settings.includeTail} disabled={exporting} onChange={(checked) => set('includeTail', checked)} />
				</div>
				<p className="audio-editor-panel-hint">{copy.exportHint}</p>
				<div className="audio-editor-export-progress" data-export-progress aria-live="polite" hidden={!exporting}>
					<ProgressBar value={progress} width="100%" />
					<output>{progress}%</output>
				</div>
				{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
				<div className="audio-editor-panel-actions">
					<span data-export-action="start" hidden={exporting}><Button variant="primary" disabled={blocked || exporting} onClick={start}>{copy.startExport}</Button></span>
					<span data-export-action="cancel" hidden={!exporting}><Button disabled={!exporting} onClick={() => controller.actions.export.cancel()}>{copy.cancelExport}</Button></span>
				</div>
				<a
					className="audio-editor-export-download"
					data-export-download
					href={output?.url || '#'}
					download={output?.fileName || ''}
					hidden={!output?.url}
				>{output?.fileName || copy.done}</a>
			</div>
		</ControlledDialog>
	);
}

function CommitField({ label, name, value, type = 'text', disabled, readOnly, multiline, hookName = 'clip-field', onCommit }) {
	const [draft, setDraft] = useState(String(value ?? ''));
	const [error, setError] = useState(false);
	useEffect(() => {
		setDraft(String(value ?? ''));
		setError(false);
	}, [name, value]);
	const commit = () => {
		if (disabled || readOnly) return;
		try {
			onCommit(name, draft);
			setError(false);
		} catch {
			setError(true);
		}
	};
	const hook = { [`data-${hookName}`]: name };
	return (
		<label className="audio-editor-field" {...hook}>
			<span>{label}</span>
			<TextInput
				value={draft}
				type={type}
				multiline={multiline}
				disabled={disabled || readOnly}
				error={error}
				onChange={setDraft}
				onBlur={commit}
				width="100%"
			/>
		</label>
	);
}

function LabeledDropdown({ label, options, value, onChange, disabled, hook }) {
	const wrapperRef = useRef(null);
	const availableOptions = options.filter((option) => !option.disabled);
	const dataHook = dropdownDataHook(hook);
	const handleChange = (next) => {
		if (!availableOptions.some((option) => option.value === next)) return;
		onChange(next);
	};
	useEffect(() => {
		wrapperRef.current?.querySelector('.dropdown__trigger')?.setAttribute('aria-label', label);
	}, [label]);
	return (
		<div ref={wrapperRef} className="audio-editor-field" role="group" aria-label={label} {...dataHook}>
			<span>{label}</span>
			<Dropdown options={availableOptions} value={value} onChange={handleChange} disabled={disabled} width="100%" />
		</div>
	);
}

// v0.9.0's labeled wrapper and its inner checkbox both receive the same click.
// Coalesce that single gesture so it produces exactly one controller command.
function DesignCheckbox({ label, checked, disabled, onChange }) {
	const pendingValue = useRef(null);
	const handleChange = (next) => {
		if (pendingValue.current === next) return;
		pendingValue.current = next;
		queueMicrotask(() => { pendingValue.current = null; });
		onChange(next);
	};
	return <LabeledCheckbox label={label} checked={checked} disabled={disabled} onChange={handleChange} />;
}

function ActionHook({ hook, children }) {
	return <span data-clip-action={hook}>{children}</span>;
}

function updateEqBand(effect, index, key, value, update) {
	const bands = effect.params.bands.map((band, candidate) => candidate === index ? { ...band, [key]: value } : band);
	return update({ params: { bands } });
}

function parseJsonObject(value, label, copy) {
	const text = String(value || '').trim();
	if (!text) return {};
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new RangeError(copy.mustBeValidJson.replace('{label}', label));
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new RangeError(copy.mustBeJsonObject.replace('{label}', label));
	}
	return parsed;
}

function parseJsonChannelMapping(value, label, copy) {
	const text = String(value || '').trim();
	if (!text) throw new RangeError(copy.channelMatrixRequired.replace('{label}', label));
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new RangeError(copy.mustBeValidJson.replace('{label}', label));
	}
	if (!Array.isArray(parsed) && (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.channels))) {
		throw new RangeError(copy.channelMatrixShape.replace('{label}', label));
	}
	return parsed;
}

function compactFields(value) {
	return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && String(item) !== ''));
}

function resolveSupportedEffectType(candidate, locale) {
	const normalized = String(candidate || '').trim().toLocaleLowerCase(locale === 'de' ? 'de-DE' : 'en-US');
	return audioEffectTypes().find((type) => {
		const labels = [type, safeEffectLabel(type, locale), safeEffectLabel(type, 'en'), safeEffectLabel(type, 'de')];
		return labels.some((label) => String(label).trim().toLocaleLowerCase(locale === 'de' ? 'de-DE' : 'en-US') === normalized);
	}) || null;
}

function safeEffectLabel(type, locale) {
	try {
		return audioEffectLabel(type, locale);
	} catch {
		return String(type || '');
	}
}

function isAudacityDefinition(type) {
	return Boolean(AUDACITY_EFFECT_DEFINITIONS[type]);
}

function dropdownDataHook(hook) {
	if (['mode', 'range', 'format', 'bitDepth', 'quality', 'sampleRate', 'channelMapping', 'dither'].includes(hook)) {
		return { 'data-export-field': hook };
	}
	if (hook === 'effect-type') return { 'data-effect-type': '' };
	if (hook === 'audacity-effect-type') return { 'data-audacity-effect-type': '' };
	if (hook === 'audacity-control-track') return { 'data-audacity-control-track': '' };
	if (hook?.startsWith('effect-param-')) return { 'data-effect-param': hook.slice('effect-param-'.length) };
	if (hook === 'effect-context-controlTrackId') return { 'data-effect-context': 'controlTrackId' };
	return hook ? { 'data-effect-field': hook } : {};
}

function audioEffectParamRangeFromDescriptor(descriptor) {
	return Number.isFinite(descriptor.minimum) && Number.isFinite(descriptor.maximum)
		? [descriptor.minimum, descriptor.maximum]
		: null;
}

function secondsInputToFrames(value, copy, sampleRate = AUDIO_EDITOR_SAMPLE_RATE) {
	const parts = String(value).trim().split(':').map(Number);
	if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) throw new RangeError(copy.invalidTimeValue);
	const seconds = parts.reduce((total, part) => total * 60 + part, 0);
	return Math.round(seconds * sampleRate);
}

function nonNegativeFrame(value, copy) {
	const frame = Number(value);
	if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError(copy.invalidFrameValue);
	return frame;
}

function framesToSecondsText(frames, sampleRate = AUDIO_EDITOR_SAMPLE_RATE) {
	return (Number(frames || 0) / sampleRate).toFixed(3);
}

function linearToDb(value) {
	return Number(value) > 0 ? 20 * Math.log10(Number(value)) : -60;
}

function dbToLinear(value, maximum, copy) {
	const db = Number(value);
	if (!Number.isFinite(db) || db < -60 || db > (maximum === 4 ? 12 : 24)) throw new RangeError(copy.invalidGainValue);
	return Math.max(0, Math.min(maximum, 10 ** (db / 20)));
}

function editingBlocked(snapshot) {
	return Boolean(
		snapshot.readOnly
		|| snapshot.importing
		|| snapshot.recordingStarting
		|| snapshot.recording
		|| snapshot.processingEffect
		|| snapshot.exporting,
	);
}

function formatDb(value, unit) {
	return Number.isFinite(value) ? `${value.toFixed(1)} ${unit}` : `−∞ ${unit}`;
}

function formatLoudness(value, unit) {
	return Number.isFinite(value) ? `${value.toFixed(1)} ${unit}` : '—';
}

function effectParameterLabel(value, copy) {
	const labels = {
		frequency: copy.effectParamFrequency,
		threshold: copy.effectParamThreshold,
		knee: copy.effectParamKnee,
		ratio: copy.effectParamRatio,
		attack: copy.effectParamAttack,
		release: copy.effectParamRelease,
		makeupGain: copy.effectParamMakeupGain,
		ceiling: copy.effectParamCeiling,
		lookahead: copy.effectParamLookahead,
		hold: copy.effectParamHold,
		rangeDb: copy.effectParamRange,
		mix: copy.effectParamMix,
		decay: copy.effectParamDecay,
		preDelay: copy.effectParamPreDelay,
		time: copy.effectParamTime,
		feedback: copy.effectParamFeedback,
	};
	if (labels[value]) return labels[value];
	return String(value).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (character) => character.toUpperCase());
}

function bitrateOption(value) {
	return { value: String(value), label: `${value} kbps` };
}
