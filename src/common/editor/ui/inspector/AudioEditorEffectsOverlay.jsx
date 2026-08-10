import { useCallback, useEffect, useRef, useState } from 'react';
import { ContextMenu, ContextMenuItem, EffectsPanel } from '@dilsonspickles/components';
import { createEffect } from '../../effects.js';
import { serializeAudacityEffectMacro } from '../../effect-macros.js';
import { AUDIO_EDITOR_SAMPLE_RATE, findTrack } from '../../project.js';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { selectAudioEditorEditBlock } from '../edit-blocking.ts';
import AudacityEffectHeader from './AudacityEffectHeader.jsx';
import EffectParameterEditor from './EffectParameterEditor.jsx';
import EffectPicker from './EffectPicker.jsx';
import { SteppedSlider } from './inspector-controls.jsx';
import {
	effectHasEditableSettings,
	effectPresetChoices,
	resolveSupportedEffectType,
	safeEffectLabel,
} from './effect-helpers.ts';
import { downloadTextFile, formatDb, linearToDb, macroFileName } from './inspector-helpers.ts';

const EMPTY_EFFECTS = Object.freeze([]);
// The master fader spans silence to the +12 dB ceiling the master gain accepts.
const MASTER_GAIN_MIN_DB = -60;
const MASTER_GAIN_MAX_DB = 12;

function masterGainFromDb(db) {
	return db <= MASTER_GAIN_MIN_DB ? 0 : 10 ** (db / 20);
}

export function AudioEditorEffectsOverlay({
	isOpen,
	controller,
	snapshot,
	copy,
	locale,
	fileService,
	trackId,
	scope = 'track',
	onClose,
	position = {},
	layout = 'overlay',
	selectedEffect: controlledSelectedEffect,
	onSelectedEffectChange,
	renderRack = true,
	renderDialogs = true,
}) {
	const project = snapshot.project;
	const selectedTrack = scope === 'track' && project ? findTrack(project, trackId || snapshot.selectedTrackId) : null;
	const selectedBus = scope === 'group'
		? project?.mixer?.groups?.find((bus) => bus.id === trackId) || null
		: scope === 'send'
			? project?.mixer?.sends?.find((bus) => bus.id === trackId) || null
			: null;
	const channel = selectedTrack || selectedBus;
	const channelEffects = channel?.effects || EMPTY_EFFECTS;
	const targetId = scope === 'master' ? null : channel?.id || null;
	const masterEffects = project?.master?.effects || EMPTY_EFFECTS;
	const blocked = !snapshot.ready || !project || selectAudioEditorEditBlock(snapshot).blocked;
	// Snap to the fader's own step so the range input and its readout never
	// disagree after a gain set elsewhere round-trips through the linear value.
	const masterGainDb = project ? Math.round(linearToDb(project.master.gain) * 10) / 10 : 0;
	const masterGainText = masterGainDb <= MASTER_GAIN_MIN_DB ? '−∞ dB' : formatDb(masterGainDb, 'dB');
	const [picker, setPicker] = useState(null);
	const [internalSelectedEffect, setInternalSelectedEffect] = useState(null);
	const selectedEffect = controlledSelectedEffect === undefined
		? internalSelectedEffect
		: controlledSelectedEffect;
	const setSelectedEffect = useCallback((value) => {
		if (onSelectedEffectChange) onSelectedEffectChange(value);
		else setInternalSelectedEffect(value);
	}, [onSelectedEffectChange]);
	const [rackPresetId, setRackPresetId] = useState('');
	const [message, setMessage] = useState('');
	const [stackMenu, setStackMenu] = useState(null);
	const rackRef = useRef(null);
	const stackMenuTriggerRef = useRef(null);

	useEffect(() => {
		if (!selectedEffect) return;
		const rack = selectedEffect.scope === 'master' ? masterEffects : channelEffects;
		if (!rack.some((effect) => effect.id === selectedEffect.id)) setSelectedEffect(null);
	}, [channelEffects, masterEffects, selectedEffect, setSelectedEffect]);

	useEffect(() => {
		setRackPresetId('');
	}, [selectedEffect?.id]);

	useEffect(() => {
		if (!isOpen) {
			setPicker(null);
			setSelectedEffect(null);
			setMessage('');
			setStackMenu(null);
			stackMenuTriggerRef.current = null;
		}
	}, [isOpen, setSelectedEffect]);

	useEffect(() => {
		for (const button of rackRef.current?.querySelectorAll('.effects-stack-header__menu-button') || []) {
			button.setAttribute('aria-label', copy.effectStackOptions);
			button.setAttribute('title', copy.effectStackOptions);
		}
	}, [copy.effectStackOptions, isOpen, channel?.id]);

	const run = (work) => {
		setMessage('');
		return Promise.resolve().then(work).catch((cause) => {
			setMessage(cause instanceof Error ? cause.message : String(cause));
		});
	};

	const openPicker = (scope, replaceId = null, event = null) => {
		if (blocked || (scope !== 'master' && !channel)) return;
		setPicker({ scope, replaceId, flyout: !replaceId, anchor: event?.currentTarget || null });
		setMessage('');
	};

	const replaceFromRegistry = (scope, effect, candidate) => {
		const type = resolveSupportedEffectType(candidate, locale, copy);
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
			const targetTrackId = scope === 'track' ? targetId : null;
			const controlTrack = project?.tracks.find((track) => track.id !== targetTrackId);
			if (!controlTrack) {
				setMessage(copy.autoDuckSecondControlTrack);
				return;
			}
			changes.context = { controlTrackId: controlTrack.id };
		}
		controller.actions.effects.update(scope, scope === 'master' ? null : targetId, effect.id, {
			...changes,
		});
	};

	const section = (scope, effects, owner) => ({
		effects: effects.map((effect) => ({
			id: effect.id,
			name: safeEffectLabel(effect, copy),
			enabled: effect.enabled,
		})),
		allEnabled: owner?.effectsActive !== false,
		onToggleAll: (enabled) => {
			if (blocked) return;
			if (scope === 'master') controller.actions.mixer.updateMaster({ effectsActive: enabled });
			else if (scope === 'track') controller.actions.track.update(targetId, { effectsActive: enabled });
			else controller.actions.mixer.updateBus(scope, targetId, { effectsActive: enabled });
		},
		onEffectToggle: (index, enabled) => {
			const effect = effects[index];
			if (!blocked && effect) controller.actions.effects.update(scope, scope === 'master' ? null : targetId, effect.id, { enabled });
		},
		onEffectChange: (index) => {
			const effect = effects[index];
			if (effect) setSelectedEffect({ scope, id: effect.id });
		},
		onEffectsReorder: (fromIndex, toIndex) => {
			const effect = effects[fromIndex];
			if (!blocked && effect) controller.actions.effects.reorder(scope, scope === 'master' ? null : targetId, effect.id, toIndex);
		},
		onAddEffect: (event) => openPicker(scope, null, event),
		onContextMenu: (scope === 'track' || scope === 'master') ? (event) => {
			const rect = event?.currentTarget?.getBoundingClientRect?.();
			if (event?.currentTarget instanceof HTMLElement) {
				stackMenuTriggerRef.current = event.currentTarget;
			}
			setStackMenu({
				scope,
				x: rect?.right ?? event?.clientX ?? 0,
				y: (rect?.bottom ?? event?.clientY ?? 0) + 4,
			});
		} : undefined,
		onRemoveEffect: (index) => {
			const effect = effects[index];
			if (!blocked && effect) controller.actions.effects.remove(scope, scope === 'master' ? null : targetId, effect.id);
		},
		onReplaceEffect: (index, candidate) => {
			const effect = effects[index];
			if (!blocked && effect) replaceFromRegistry(scope, effect, candidate);
		},
		onChangeEffect: (index) => openPicker(scope, effects[index]?.id || null),
	});

	const effectRack = selectedEffect?.scope === 'master' ? masterEffects : channelEffects;
	const effect = effectRack.find((candidate) => candidate.id === selectedEffect?.id) || null;
	const effectScope = selectedEffect?.scope || scope;
	const effectOwner = effectScope === 'master' ? project?.master : channel;
	const supportsLiveRackGesture = (
		effect?.type === 'delay'
		&& effect.enabled !== false
		&& effectOwner?.effectsActive !== false
		&& Number(effect.params?.mix) > 0
	);
	const rackPresets = effect && effect.type !== 'missing'
		? controller.actions.effects.presets.list(effect.type)
		: [];
	const rackPresetChoices = effectPresetChoices(rackPresets, copy.noEffectPreset);
	const selectedRackPreset = rackPresetChoices.find((choice) => choice.id === rackPresetId);
	const applyRackPreset = (value) => {
		if (!effect || blocked) return;
		if (value === copy.noEffectPreset) {
			setRackPresetId('');
			return;
		}
		const choice = rackPresetChoices.find((candidate) => candidate.label === value);
		if (!choice) return;
		setRackPresetId(choice.id);
		run(() => controller.actions.effects.update(
			effectScope,
			effectScope === 'master' ? null : targetId,
			effect.id,
			{ params: choice.preset.params },
		));
	};
	const menuEffects = stackMenu?.scope === 'master' ? masterEffects : channelEffects;
	const menuTrackId = stackMenu?.scope === 'master' ? null : targetId;
	const closeStackMenu = () => {
		const trigger = stackMenuTriggerRef.current;
		setStackMenu(null);
		requestAnimationFrame(() => {
			const active = document.activeElement;
			if (isOpen && trigger?.isConnected && (!active || active === document.body)) {
				trigger.focus({ preventScroll: true });
			}
		});
	};
	const copyStack = () => {
		controller.actions.effects.copyStack(stackMenu.scope, menuTrackId);
		setMessage(copy.effectsCopied);
		closeStackMenu();
	};
	const pasteStack = () => run(() => {
		controller.actions.effects.pasteStack(stackMenu.scope, menuTrackId);
		setMessage(copy.effectsPasted);
		closeStackMenu();
	});
	const exportStack = () => run(async () => {
		const encoded = serializeAudacityEffectMacro(menuEffects.filter((candidate) => candidate.type !== 'missing'));
		const name = stackMenu.scope === 'master' ? copy.master : channel?.name;
		const saved = await downloadTextFile(encoded, `${macroFileName(name || copy.untitledMacro)}.txt`, fileService, 'macro');
		if (saved?.cancelled) return;
		setMessage(copy.macroExported);
		closeStackMenu();
	});

	return (
		<>
			{renderRack && <div
				className="audio-editor-effects-overlay"
				data-open={isOpen ? 'true' : 'false'}
				data-layout={layout}
			>
				<div ref={rackRef} data-effect-rack>
					<EffectsPanel
						isOpen={isOpen}
						resizable={false}
						mode={layout === 'docked' ? 'sidebar' : 'overlay'}
						{...(layout === 'docked' ? {} : {
							left: position.left,
							top: position.top,
							width: position.width,
							height: position.height,
						})}
						onClose={onClose}
						trackSection={channel ? { trackName: channel.name, ...section(scope, channelEffects, channel) } : undefined}
						masterSection={{ ...section('master', masterEffects, project?.master) }}
					/>
				</div>

				{isOpen && (
					<div className="audio-editor-effects-overlay__adapters">
						{!channel && <p className="audio-editor-panel-hint">{copy.audacitySelectionHint}</p>}
						{channelEffects.length === 0 && masterEffects.length === 0 && (
							<p className="audio-editor-panel-hint" data-effect-empty>{copy.effectRackEmpty}</p>
						)}
						{message && <p className="audio-editor-field-error" role="alert">{message}</p>}
						<div className="audio-editor-master-gain" data-master-gain>
							<span>{copy.masterGain}</span>
							<SteppedSlider
								value={masterGainDb}
								min={MASTER_GAIN_MIN_DB}
								max={MASTER_GAIN_MAX_DB}
								step={0.1}
								ariaLabel={copy.masterGain}
								valueText={masterGainText}
								disabled={blocked || !project}
								onChange={(db) => controller.actions.effects.setMasterGain(masterGainFromDb(db))}
							/>
							<output data-master-gain-value>{masterGainText}</output>
						</div>
					</div>
				)}
				<ContextMenu
					isOpen={Boolean(stackMenu)}
					x={stackMenu?.x || 0}
					y={stackMenu?.y || 0}
					onClose={closeStackMenu}
					className="audio-editor-effect-stack-menu"
				>
					<ContextMenuItem label={copy.copyEffects} onClick={copyStack} />
					<ContextMenuItem label={copy.pasteEffects} disabled={blocked || !snapshot.effects?.hasStackClipboard} onClick={pasteStack} />
					<ContextMenuItem isDivider />
					<ContextMenuItem label={copy.exportAsMacro} disabled={!menuEffects.some((candidate) => candidate.enabled && candidate.type !== 'missing')} onClick={exportStack} />
				</ContextMenu>
			</div>}

			{renderDialogs && effect && (
				<AudioEditorDialogShell
					isOpen
					title={safeEffectLabel(effect, copy)}
					onClose={() => setSelectedEffect(null)}
					width={effect.type === 'eq' ? 920 : 620}
					modal={false}
					draggable
					className="audio-editor-effect-settings-dialog"
					dataAttributes={{ 'data-effect': effect.id }}
					headerSlot={effect.type === 'missing' ? null : (
						<div className="audio-editor-rack-effect-header">
							<AudacityEffectHeader
								copy={copy}
								automationEnabled={effect.enabled}
								onToggleAutomation={(enabled) => {
									if (!blocked) controller.actions.effects.update(effectScope, effectScope === 'master' ? null : targetId, effect.id, { enabled });
								}}
								presetName={selectedRackPreset?.label || copy.noEffectPreset}
								presets={[copy.noEffectPreset, ...rackPresetChoices.map((choice) => choice.label)]}
								onPresetChange={applyRackPreset}
							/>
						</div>
					)}
				>
					<section className="audio-editor-effect-settings">
						<EffectParameterEditor
							effect={effect}
							copy={copy}
							disabled={blocked}
							tracks={project?.tracks || []}
							targetTrackId={effectScope === 'track' ? targetId : null}
							captureNoiseProfile={controller.actions.effects.captureRackNoiseProfile
								? () => run(() => controller.actions.effects.captureRackNoiseProfile(
									effectScope,
									effectScope === 'master' ? null : targetId,
									effect.id,
								))
								: null}
							noiseProfileLabel={effect.context?.noiseProfile ? copy.replaceNoiseProfile : copy.getNoiseProfile}
							sampleRate={project?.sampleRate || AUDIO_EDITOR_SAMPLE_RATE}
							onRackEffectGestureBegin={supportsLiveRackGesture
								? () => controller.actions.effects.beginRackEffectGesture?.(
									effectScope,
									effectScope === 'master' ? null : targetId,
									effect.id,
								)
								: null}
							onRackEffectPreview={supportsLiveRackGesture
								? (params) => controller.actions.effects.previewRackEffect?.(
									effectScope,
									effectScope === 'master' ? null : targetId,
									effect.id,
									params,
								)
								: null}
							onRackEffectCommit={supportsLiveRackGesture
								? (params) => controller.actions.effects.commitRackEffectGesture
									? controller.actions.effects.commitRackEffectGesture(
										effectScope,
										effectScope === 'master' ? null : targetId,
										effect.id,
										params,
									)
									: controller.actions.effects.update(
										effectScope,
										effectScope === 'master' ? null : targetId,
										effect.id,
										{ params },
									)
								: null}
							onRackEffectCancel={supportsLiveRackGesture
								? () => controller.actions.effects.cancelRackEffectGesture?.(
									effectScope,
									effectScope === 'master' ? null : targetId,
									effect.id,
								)
								: null}
							onParametricEqGestureBegin={() => controller.actions.effects.beginParametricEqGesture?.(
								effectScope,
								effectScope === 'master' ? null : targetId,
								effect.id,
							)}
							onParametricEqPreview={(params) => controller.actions.effects.previewParametricEq?.(
								effectScope,
								effectScope === 'master' ? null : targetId,
								effect.id,
								params,
							)}
							onParametricEqCommit={(params) => controller.actions.effects.commitParametricEqGesture
								? controller.actions.effects.commitParametricEqGesture(
									effectScope,
									effectScope === 'master' ? null : targetId,
									effect.id,
									params,
								)
								: controller.actions.effects.update(
									effectScope,
									effectScope === 'master' ? null : targetId,
									effect.id,
									{ params },
								)}
							onParametricEqCancel={() => controller.actions.effects.cancelParametricEqGesture?.(
								effectScope,
								effectScope === 'master' ? null : targetId,
								effect.id,
							)}
							onParametricEqAudition={(bandId) => controller.actions.effects.auditionParametricEq?.(
								effectScope,
								effectScope === 'master' ? null : targetId,
								effect.id,
								bandId,
							)}
							readParametricEqSpectrum={(which, target) => controller.actions.effects.readParametricEqSpectrum?.(
								effectScope,
								effectScope === 'master' ? null : targetId,
								effect.id,
								which,
								target,
							)}
							onChange={(changes) => run(() => controller.actions.effects.update(
								effectScope,
								effectScope === 'master' ? null : targetId,
								effect.id,
								changes,
							))}
						/>
					</section>
				</AudioEditorDialogShell>
			)}

			{renderRack && picker && (
				<EffectPicker
					copy={copy}
					disabled={blocked}
					flyout={picker.flyout}
					anchor={picker.anchor}
					onClose={() => setPicker(null)}
					onChoose={(type) => run(async () => {
						if (picker.replaceId) {
							const rack = picker.scope === 'master' ? masterEffects : channelEffects;
							const current = rack.find((candidate) => candidate.id === picker.replaceId);
							if (current) replaceFromRegistry(picker.scope, current, type);
						} else {
							const id = await controller.actions.effects.add({
								scope: picker.scope,
								trackId: picker.scope === 'master' ? null : targetId,
								busId: picker.scope === 'master' ? null : targetId,
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

export default AudioEditorEffectsOverlay;
