import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
	Button,
	ContextMenu,
	ContextMenuItem,
	DialogFooter,
	DialogHeader,
	Dropdown,
	EffectHeader,
	EffectSlot,
	EffectsPanel,
	Icon,
	Knob,
	LabeledCheckbox,
	ProgressBar,
	Separator,
	TextInput,
	useContainerTabGroup,
} from '@dilsonspickles/components';
import { normalizeBcp47Locale } from '../../../i18n/locale.js';
import {
	AUDIO_EFFECT_DEFINITIONS,
	audioEffectLabel,
	audioEffectParamRange,
	audioEffectTypes,
	createEffect,
} from '../../../lib/tools/audio-editor/effects.js';
import {
	parseAudacityEffectMacro,
	serializeAudacityEffectMacro,
} from '../../../lib/tools/audio-editor/effect-macros.js';
import {
	AUDACITY_EFFECT_DEFINITIONS,
	audacityEffectDefaults,
	audacityEffectLabel,
	audacityEffectOptionLabel,
	audacityEffectParameterLabel,
	audacityEffectTypes,
	formatAudacityCurve,
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
import { AudacityEffectLayout } from './AudacityEffectLayout.jsx';
import { useAudioEditorTelemetry } from './DesignSystemRuntime.jsx';

const MAX_MACRO_IMPORT_BYTES = 1024 * 1024;

/**
 * Controlled dialog adapter for editor-owned workflows. The design-system Dialog
 * composite is intentionally not used because v0.9.0 changes supplied titles and
 * imposes a fixed content geometry. DialogHeader keeps the Audacity visual pattern
 * while this shell owns focus, dismissal, and responsive sizing.
 */
function ControlledDialog({
	isOpen,
	title,
	headerTitle = title,
	onClose,
	children,
	className = '',
	width = 640,
	closeOnEscape = true,
	closeOnOutside = true,
	dataAttributes = {},
	headerSlot = null,
	footer = null,
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
				<DialogHeader title={headerTitle} os="windows" onClose={onClose} />
				{headerSlot}
				<div className="kw-audio-editor-dialog__body audio-editor-controlled-dialog__body">
					{children}
				</div>
				{footer}
			</section>
		</div>
	);
}

function AudacityEffectHeader({ copy, automationEnabled, ...props }) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		const root = wrapperRef.current;
		if (!root) return;
		const automation = root.querySelector('.effect-header__left button');
		if (automation && !props.isDestructive) {
			const label = automationEnabled
				? copy.disableEffect
				: copy.enableEffect;
			automation.setAttribute('aria-label', label);
			automation.setAttribute('title', label);
		}
		const preset = root.querySelector('.effect-header__preset .dropdown__trigger');
		preset?.setAttribute('aria-label', copy.effectPreset);
		const actionLabels = [copy.saveEffectPreset, copy.undo, copy.deleteEffectPreset, copy.moreOptions];
		root.querySelectorAll('.effect-header__right .effect-header__icon-button').forEach((button, index) => {
			const label = actionLabels[index];
			if (!label) return;
			button.setAttribute('aria-label', label);
			button.setAttribute('title', label);
		});
	}, [automationEnabled, copy, props.isDestructive]);
	return <div ref={wrapperRef}><EffectHeader automationEnabled={automationEnabled} {...props} /></div>;
}

function effectPresetChoices(presets, emptyLabel) {
	const labels = new Set([emptyLabel]);
	return (presets || []).map((preset) => {
		let label = preset.name;
		let suffix = 2;
		while (labels.has(label)) {
			label = `${preset.name} (${suffix})`;
			suffix += 1;
		}
		labels.add(label);
		return { id: preset.id, label, preset };
	});
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
			footer={(
				<DialogFooter
					className="audio-editor-dialog-footer"
					rightContent={<Button variant="primary" onClick={onClose}>{copy.done}</Button>}
				/>
			)}
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
			<div className="audio-editor-clip-properties" data-clip-fields aria-disabled={disabled}>
				<section className="audio-editor-clip-properties__card audio-editor-clip-properties__card--wide">
					<h3>{copy.clip}</h3>
					<CommitField label={copy.clipName} name="name" value={source?.name || copy.clip} disabled readOnly onCommit={commitField} />
				</section>
				<section className="audio-editor-clip-properties__card audio-editor-clip-properties__card--wide">
					<h3>{copy.clipStart} / {copy.clipDuration}</h3>
					<div className="audio-editor-clip-properties__time-grid">
						<CommitField label={`${copy.clipStart} (s)`} name="start" value={clip ? framesToSecondsText(clip.timelineStartFrame, sampleRate) : '0.000'} disabled={disabled} onCommit={commitField} />
						<CommitField label={`${copy.clipStart} (${copy.frames})`} name="startFrame" value={clip?.timelineStartFrame ?? 0} type="number" disabled={disabled} onCommit={commitField} />
						<CommitField label={`${copy.clipIn} (s)`} name="sourceIn" value={clip ? framesToSecondsText(clip.sourceStartFrame, sampleRate) : '0.000'} disabled={disabled} onCommit={commitField} />
						<CommitField label={`${copy.clipIn} (${copy.frames})`} name="sourceInFrame" value={clip?.sourceStartFrame ?? 0} type="number" disabled={disabled} onCommit={commitField} />
						<CommitField label={`${copy.clipDuration} (s)`} name="duration" value={clip ? framesToSecondsText(clip.durationFrames, sampleRate) : '0.000'} disabled={disabled} onCommit={commitField} />
						<CommitField label={`${copy.clipDuration} (${copy.frames})`} name="durationFrame" value={clip?.durationFrames ?? 1} type="number" disabled={disabled} onCommit={commitField} />
					</div>
				</section>
				<section className="audio-editor-clip-properties__card">
					<h3>{copy.fading}</h3>
					<div className="audio-editor-clip-properties__stack">
						<CommitField label={`${copy.clipGain} (dB)`} name="gain" value={clip ? linearToDb(clip.gain).toFixed(2) : '0.00'} type="number" disabled={disabled} onCommit={commitField} />
						<CommitField label={`${copy.fadeIn} (s)`} name="fadeIn" value={clip ? framesToSecondsText(clip.fadeInFrames, sampleRate) : '0.000'} type="number" disabled={disabled} onCommit={commitField} />
						<CommitField label={`${copy.fadeOut} (s)`} name="fadeOut" value={clip ? framesToSecondsText(clip.fadeOutFrames, sampleRate) : '0.000'} type="number" disabled={disabled} onCommit={commitField} />
					</div>
				</section>
				<section className="audio-editor-clip-properties__card">
					<h3>{copy.pitchTempo}</h3>
					<div className="audio-editor-clip-properties__stack">
						<CommitField label={copy.clipPitchCents} name="pitchCents" value={clip?.pitchCents ?? 0} type="number" disabled={disabled} onCommit={commitField} />
						<CommitField label={copy.clipSpeedRatio} name="speedRatio" value={clip?.speedRatio ?? 1} type="number" disabled={disabled} onCommit={commitField} />
						<div data-clip-field="preserveFormants"><DesignCheckbox label={copy.preserveFormants} checked={Boolean(clip?.preserveFormants)} disabled={disabled} onChange={(checked) => controller.actions.clip.setTimePitch(clip.id, { preserveFormants: checked })} /></div>
						<div data-clip-field="stretchToTempo"><DesignCheckbox label={copy.stretchToTempo} checked={Boolean(clip?.stretchToTempo)} disabled={disabled} onChange={() => controller.actions.clip.toggleStretchToTempo(clip.id)} /></div>
					</div>
				</section>
			</div>
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
	trackId,
	scope = 'track',
	onClose,
	position = {},
}) {
	const project = snapshot.project;
	const selectedTrack = scope === 'track' && project ? findTrack(project, trackId || snapshot.selectedTrackId) : null;
	const selectedBus = scope === 'group'
		? project?.mixer?.groups?.find((bus) => bus.id === trackId) || null
		: scope === 'send'
			? project?.mixer?.sends?.find((bus) => bus.id === trackId) || null
			: null;
	const channel = selectedTrack || selectedBus;
	const channelEffects = channel?.effects || [];
	const targetId = scope === 'master' ? null : channel?.id || null;
	const masterEffects = project?.master?.effects || [];
	const blocked = !snapshot.ready || !project || editingBlocked(snapshot);
	const [picker, setPicker] = useState(null);
	const [selectedEffect, setSelectedEffect] = useState(null);
	const [rackPresetId, setRackPresetId] = useState('');
	const [message, setMessage] = useState('');
	const [stackMenu, setStackMenu] = useState(null);
	const rackRef = useRef(null);
	const stackMenuTriggerRef = useRef(null);

	useEffect(() => {
		if (!selectedEffect) return;
		const rack = selectedEffect.scope === 'master' ? masterEffects : channelEffects;
		if (!rack.some((effect) => effect.id === selectedEffect.id)) setSelectedEffect(null);
	}, [channelEffects, masterEffects, selectedEffect]);

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
	}, [isOpen]);

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

	const openPicker = (scope, replaceId = null) => {
		if (blocked || (scope !== 'master' && !channel)) return;
		setPicker({ scope, replaceId });
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

	const section = (scope, effects) => ({
		effects: effects.map((effect) => ({
			id: effect.id,
			name: safeEffectLabel(effect.type, copy),
			enabled: effect.enabled,
		})),
		allEnabled: effects.length > 0 && effects.every((effect) => effect.enabled),
		onToggleAll: (enabled) => {
			if (blocked) return;
			for (const effect of effects) controller.actions.effects.update(scope, scope === 'master' ? null : targetId, effect.id, { enabled });
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
		onAddEffect: () => openPicker(scope),
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
	const rackPresets = effect ? controller.actions.effects.presets.list(effect.type) : [];
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
	const exportStack = () => run(() => {
		const encoded = serializeAudacityEffectMacro(menuEffects);
		const name = stackMenu.scope === 'master' ? copy.master : channel?.name;
		downloadTextFile(encoded, `${macroFileName(name || copy.untitledMacro)}.txt`);
		setMessage(copy.macroExported);
		closeStackMenu();
	});

	return (
		<>
			<div className="audio-editor-effects-overlay" data-open={isOpen ? 'true' : 'false'}>
				<div ref={rackRef} data-effect-rack>
					<EffectsPanel
						isOpen={isOpen}
						resizable={false}
						mode="overlay"
						left={position.left}
						top={position.top}
						width={position.width}
						height={position.height}
						onClose={onClose}
						trackSection={channel ? { trackName: channel.name, ...section(scope, channelEffects) } : undefined}
						masterSection={{ ...section('master', masterEffects) }}
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
					<ContextMenuItem label={copy.exportAsMacro} disabled={!menuEffects.some((candidate) => candidate.enabled)} onClick={exportStack} />
				</ContextMenu>
			</div>

			{effect && (
				<ControlledDialog
					isOpen
					title={safeEffectLabel(effect.type, copy)}
					onClose={() => setSelectedEffect(null)}
					width={620}
					className="audio-editor-effect-settings-dialog"
					dataAttributes={{ 'data-effect': effect.id }}
					headerSlot={(
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
							locale={locale}
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
							onChange={(changes) => run(() => controller.actions.effects.update(
								effectScope,
								effectScope === 'master' ? null : targetId,
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

export function AudioEditorMacroManagerDialog({
	isOpen,
	controller,
	snapshot,
	copy,
	locale,
	draft,
	onDraftChange,
	onClose,
}) {
	const project = snapshot.project;
	const effects = draft?.effects || [];
	const blocked = editingBlocked(snapshot);
	const hasRunTarget = Boolean(snapshot.selection || snapshot.selectedClipId);
	const [picker, setPicker] = useState(null);
	const [selectedEffectId, setSelectedEffectId] = useState(null);
	const [draggedIndex, setDraggedIndex] = useState(null);
	const [message, setMessage] = useState('');
	const [messageState, setMessageState] = useState('info');
	const [isRunning, setIsRunning] = useState(false);
	const fileInputRef = useRef(null);
	const macroStackRef = useRef(null);
	const runningRef = useRef(false);
	const selectedEffect = effects.find((effect) => effect.id === selectedEffectId) || null;
	const macroTabGroup = useContainerTabGroup({
		containerRef: macroStackRef,
		groupId: 'effects-panel',
		selector: '.effect-slot',
		ariaLabel: copy.macroManager,
		startTabIndex: 0,
	});

	useEffect(() => {
		if (selectedEffectId && !selectedEffect) setSelectedEffectId(null);
	}, [selectedEffect, selectedEffectId]);

	useEffect(() => {
		if (!isOpen) {
			setPicker(null);
			setSelectedEffectId(null);
			setMessage('');
		}
	}, [isOpen]);

	useEffect(() => {
		if (isOpen && !selectedEffect && !picker) macroTabGroup.initTabIndices();
	}, [effects, isOpen, macroTabGroup.initTabIndices, picker, selectedEffect]);

	const setDraft = (updater) => onDraftChange?.((current) => {
		const base = current || { name: copy.untitledMacro, effects: [] };
		return typeof updater === 'function' ? updater(base) : updater;
	});
	const setEffects = (nextEffects) => setDraft((current) => ({
		...current,
		effects: typeof nextEffects === 'function' ? nextEffects(current.effects || []) : nextEffects,
	}));
	const showMessage = (value, state = 'info') => {
		setMessage(value);
		setMessageState(state);
	};
	const updateEffect = (effectId, changes) => setEffects((current) => current.map((effect) => {
		if (effect.id !== effectId) return effect;
		const type = changes.type || effect.type;
		const preservedMetadata = changes.type ? {} : {
			...(effect.context !== undefined ? { context: effect.context } : {}),
			...(effect.state !== undefined ? { state: effect.state } : {}),
		};
		return createEffect(type, {
			id: effect.id,
			enabled: true,
			...preservedMetadata,
			params: changes.type
				? changes.params
				: { ...effect.params, ...(changes.params || {}) },
		});
	}));
	const removeEffect = (effectId) => setEffects((current) => current.filter((effect) => effect.id !== effectId));
	const reorderEffect = (fromIndex, toIndex) => {
		if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || toIndex >= effects.length) return;
		setEffects((current) => {
			const next = [...current];
			const [effect] = next.splice(fromIndex, 1);
			next.splice(toIndex, 0, effect);
			return next;
		});
	};
	const replaceFromRegistry = (effect, candidate) => {
		const type = resolveSupportedEffectType(candidate, locale, copy);
		if (!type) {
			showMessage(copy.effectEngineUnsupported, 'error');
			return;
		}
		const replacement = createEffect(type, { id: effect.id });
		updateEffect(effect.id, { type, params: replacement.params });
	};
	const importMacro = async (file) => {
		if (!file) return;
		try {
			if (file.size > MAX_MACRO_IMPORT_BYTES) {
				throw new RangeError('File exceeds the 1 MiB macro import limit.');
			}
			const parsed = parseAudacityEffectMacro(await file.text());
			setDraft((current) => ({
				...current,
				name: file.name.replace(/\.txt$/i, '') || copy.untitledMacro,
				effects: [...parsed.effects],
			}));
			const warning = parsed.ignoredCommands.length
				? ` ${copy.macroUnsupportedCommands.replace('{commands}', parsed.ignoredCommands.join(', '))}`
				: '';
			showMessage(`${copy.macroImported}${warning}`, parsed.ignoredCommands.length ? 'warning' : 'success');
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : String(cause);
			showMessage(/no supported effects/i.test(detail)
				? copy.macroImportEmpty
				: copy.macroImportFailed.replace('{message}', detail), 'error');
		} finally {
			if (fileInputRef.current) fileInputRef.current.value = '';
		}
	};
	const exportMacro = () => {
		try {
			const encoded = serializeAudacityEffectMacro(effects);
			downloadTextFile(encoded, `${macroFileName(draft?.name || copy.untitledMacro)}.txt`);
			showMessage(copy.macroExported, 'success');
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : String(cause);
			showMessage(copy.macroExportFailed.replace('{message}', detail), 'error');
		}
	};
	const runMacro = async () => {
		if (runningRef.current) return;
		runningRef.current = true;
		setIsRunning(true);
		showMessage(copy.macroProcessing);
		try {
			const applied = await controller.actions.macros.run({
				name: draft?.name || copy.untitledMacro,
				effects,
			});
			if (applied) showMessage(copy.macroApplied, 'success');
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : String(cause);
			showMessage(copy.macroRunFailed.replace('{message}', detail), 'error');
		} finally {
			runningRef.current = false;
			setIsRunning(false);
		}
	};

	return (
		<>
			<ControlledDialog
				isOpen={isOpen && !selectedEffect && !picker}
				title={copy.macroManager}
				onClose={onClose}
				width={680}
				className="audio-editor-macro-manager"
				dataAttributes={{ 'data-macro-manager': '' }}
				footer={(
					<DialogFooter
						className="audio-editor-dialog-footer audio-editor-macro-manager__footer"
						leftContent={(
							<Button
								variant="secondary"
								icon={<Icon name="plus" size={14} />}
								onClick={() => setPicker({ replaceId: null })}
							>{copy.effects}</Button>
						)}
						rightContent={(
							<div className="audio-editor-macro-manager__footer-actions">
								<div className="audio-editor-macro-manager__file-actions" role="group" aria-label={`${copy.importMacro} / ${copy.exportMacro}`}>
									<button className="audio-editor-macro-manager__icon-button audio-editor-macro-manager__icon-button--import" type="button" aria-label={copy.importMacro} title={copy.importMacro} onClick={() => fileInputRef.current?.click()}>
										<Icon name="export" size={16} />
									</button>
									<button className="audio-editor-macro-manager__icon-button" type="button" aria-label={copy.exportMacro} title={copy.exportMacro} disabled={!effects.length} onClick={exportMacro}>
										<Icon name="export" size={16} />
									</button>
								</div>
								<Button variant="primary" icon={<Icon name="play" size={14} />} disabled={blocked || isRunning || !hasRunTarget || !effects.length} onClick={runMacro}>{copy.runMacro}</Button>
							</div>
						)}
					/>
				)}
			>
				<section className="audio-editor-macro-manager__content">
					<label className="audio-editor-field audio-editor-macro-manager__name">
						<span>{copy.macroName}</span>
						<TextInput value={draft?.name || ''} onChange={(name) => setDraft((current) => ({ ...current, name }))} width="100%" />
					</label>
					<div
						ref={macroStackRef}
						className="audio-editor-macro-manager__stack"
						{...macroTabGroup.containerProps}
						aria-label={copy.macroManager}
						onKeyDown={macroTabGroup.onKeyDown}
						onBlur={macroTabGroup.onBlur}
						onFocus={macroTabGroup.onFocus}
						onClickCapture={macroTabGroup.onClickCapture}
						data-macro-effect-stack
					>
						{effects.map((effect, index) => (
							<EffectSlot
								key={effect.id}
								className="audio-editor-macro-manager__effect"
								effectName={safeEffectLabel(effect.type, copy)}
								enabled
								isDragging={draggedIndex === index}
								onSelectEffect={() => setSelectedEffectId(effect.id)}
								onRemoveEffect={() => removeEffect(effect.id)}
								onReplaceEffect={(candidate) => replaceFromRegistry(effect, candidate)}
								onChangeEffect={() => setPicker({ replaceId: effect.id })}
								onDragStart={(event) => {
									setDraggedIndex(index);
									event.dataTransfer.effectAllowed = 'move';
								}}
								onDragOver={(event) => {
									event.preventDefault();
									if (draggedIndex === null || draggedIndex === index) return;
									reorderEffect(draggedIndex, index);
									setDraggedIndex(index);
								}}
								onDragEnd={() => setDraggedIndex(null)}
								onReorder={(direction) => reorderEffect(index, index + direction)}
							/>
						))}
						{!effects.length && <p className="audio-editor-panel-hint" data-macro-empty>{copy.macroEmptyHint}</p>}
					</div>
					{!hasRunTarget && <p className="audio-editor-panel-hint">{copy.macroSelectionHint}</p>}
					{message && <p className={`audio-editor-macro-manager__message audio-editor-macro-manager__message--${messageState}`} role={messageState === 'error' ? 'alert' : 'status'}>{message}</p>}
					<input ref={fileInputRef} type="file" accept="text/plain,.txt" hidden onChange={(event) => importMacro(event.currentTarget.files?.[0])} />
				</section>
			</ControlledDialog>

			{selectedEffect && (
				<ControlledDialog
					isOpen
					title={safeEffectLabel(selectedEffect.type, copy)}
					onClose={() => setSelectedEffectId(null)}
					width={620}
					className="audio-editor-effect-settings-dialog audio-editor-macro-effect-settings-dialog"
					dataAttributes={{ 'data-macro-effect': selectedEffect.id }}
				>
					<section className="audio-editor-effect-settings">
						<EffectParameterEditor
							effect={selectedEffect}
							locale={locale}
							copy={copy}
							disabled={false}
							tracks={project?.tracks || []}
							targetTrackId={snapshot.selectedTrackId}
							hideControlTrack
							onChange={(changes) => updateEffect(selectedEffect.id, changes)}
						/>
					</section>
				</ControlledDialog>
			)}

			{picker && (
				<EffectPicker
					copy={copy}
					locale={locale}
					disabled={false}
					onClose={() => setPicker(null)}
					onChoose={(type) => {
						if (picker.replaceId) {
							const effect = effects.find((candidate) => candidate.id === picker.replaceId);
							if (effect) {
								const replacement = createEffect(type, { id: effect.id });
								updateEffect(effect.id, { type, params: replacement.params });
							}
						} else setEffects((current) => [...current, createEffect(type)]);
						setPicker(null);
					}}
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
	}, [snapshot.effects]);

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
	const deletePreset = () => run(async () => {
		await controller.actions.effects.presets.delete(selectedPresetId);
		setSelectedPresetId('');
		setPresetName('');
	});
	const presetChoices = effectPresetChoices(effectPresets, copy.noEffectPreset);
	const selectedPresetChoice = presetChoices.find((choice) => choice.id === selectedPresetId);

	return (
		<ControlledDialog
			isOpen={isOpen}
			title={copy.selectionEffects || copy.audacityEffectsTitle}
			headerTitle={audacityEffectLabel(selectionType, copy)}
			onClose={() => {
				controller.actions.effects.cancelPreview();
				onClose?.();
			}}
			width={720}
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
					<h3>{audacityEffectLabel(selectionType, copy)}</h3>
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
					locale={locale}
					copy={copy}
					disabled={blocked}
					tracks={project?.tracks || []}
					targetTrackId={selectedTrack?.id || null}
					captureNoiseProfile={selectionType === 'audacity-noise-reduction'
						? () => run(controller.actions.effects.captureNoiseProfile)
						: null}
					noiseProfileLabel={snapshot.effects?.noiseProfileReady ? copy.noiseProfileReady : copy.getNoiseProfile}
					hideControlTrack
					onChange={(changes) => changes.params && updateSelectionParams(changes.params)}
				/>
				<p className="audio-editor-panel-hint" data-audacity-effect-hint>{copy.audacitySelectionHint}</p>
				{message && <p className="audio-editor-field-error" role="alert">{message}</p>}
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
					options={types.map((value) => ({ value, label: safeEffectLabel(value, copy) }))}
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
	hideControlTrack = false,
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
		const ranges = AUDIO_EFFECT_DEFINITIONS[effect.type]?.ranges || {};
		const parameterNames = effect.type === 'eq'
			? ['bands']
			: Object.entries(effect.params || {}).filter(([, value]) => typeof value === 'number').map(([name]) => name);
		const nativeDefinition = { params: Object.fromEntries(parameterNames.map((name) => [name, {}])) };
		const renderNativeParameter = (name) => {
			if (name === 'bands') {
				return (
					<div className="audio-editor-native-eq-bands" data-effect-param="bands">
						{(effect.params.bands || []).map((band, index) => (
							<section className="audio-editor-native-eq-band" key={index}>
								<h4>{copy.bandNumber.replace('{number}', String(index + 1))}</h4>
								<ParameterNumber label="Hz" value={band.frequency} range={[10, 24_000]} step={1} presentation="number" copy={copy} disabled={disabled} hook={`bands.${index}.frequency`} onCommit={(value) => updateEqBand(effect, index, 'frequency', value, update)} />
								<ParameterNumber label="dB" value={band.gain} range={[-24, 24]} step={0.1} presentation="slider" copy={copy} disabled={disabled} hook={`bands.${index}.gain`} onCommit={(value) => updateEqBand(effect, index, 'gain', value, update)} />
								<ParameterNumber label="Q" value={band.q} range={[0.1, 30]} step={0.1} presentation="number" copy={copy} disabled={disabled} hook={`bands.${index}.q`} onCommit={(value) => updateEqBand(effect, index, 'q', value, update)} />
							</section>
						))}
					</div>
				);
			}
			return (
				<ParameterNumber
					label={effectParameterLabel(name, copy)}
					value={effect.params?.[name]}
					range={ranges[name]}
					copy={copy}
					disabled={disabled}
					hook={name}
					onCommit={(next) => updateParam(name, next)}
				/>
			);
		};
		return (
			<div className="audio-editor-effect-parameters" data-effect-parameters>
				<AudacityEffectLayout
					effectType={effect.type}
					definition={nativeDefinition}
					parameters={effect.params}
					copy={copy}
					renderParameter={renderNativeParameter}
					after={error && <p className="audio-editor-field-error" role="alert">{error}</p>}
				/>
			</div>
		);
	}

	const candidates = tracks.filter((track) => track.id !== targetTrackId);
	const renderParameter = (name) => (
		audacityParameterVisible(effect, name) ? (
			<AudacityParameter
				name={name}
				effectType={effect.type}
				descriptor={definition.params[name]}
				value={effect.params?.[name]}
				effectParams={effect.params}
				copy={copy}
				disabled={disabled}
				onCommit={(value) => updateParam(name, value)}
			/>
		) : null
	);
	const contextControls = (
		<>
			{definition.requiresControlTrack && !hideControlTrack && (
				<section className="audio-editor-audacity-layout__context-card">
					<h3>{copy.controlTrack}</h3>
					<LabeledDropdown
						label={copy.controlTrack}
						value={effect.context?.controlTrackId || ''}
						options={candidates.map((track) => ({ value: track.id, label: track.name }))}
						onChange={(controlTrackId) => update({ context: { controlTrackId: controlTrackId || null } })}
						disabled={disabled || candidates.length === 0}
						hook="effect-context-controlTrackId"
					/>
				</section>
			)}
			{definition.requiresNoiseProfile && (
				<section className="audio-editor-audacity-layout__context-card audio-editor-audacity-layout__context-card--profile">
					<div>
						<h3>{copy.noiseProfileStep}</h3>
						{!effect.context?.noiseProfile && <p className="audio-editor-panel-hint">{copy.rackNoiseProfileMissing}</p>}
					</div>
					{captureNoiseProfile && (
						<span data-effect-noise-profile data-audacity-noise-profile>
							<Button disabled={disabled} onClick={captureNoiseProfile}>{noiseProfileLabel}</Button>
						</span>
					)}
				</section>
			)}
		</>
	);
	return (
		<div className="audio-editor-effect-parameters" data-effect-parameters>
			<AudacityEffectLayout
				effectType={effect.type}
				definition={definition}
				parameters={effect.params}
				copy={copy}
				renderParameter={renderParameter}
				before={contextControls}
				after={(
					<>
						{Object.keys(definition.params).length === 0 && (
							<p className="audio-editor-audacity-layout__empty">{copy.noAdjustableSettings}</p>
						)}
						{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
					</>
				)}
			/>
		</div>
	);
}

function AudacityParameter({ name, effectType, descriptor, value, effectParams, copy, disabled, onCommit }) {
	const label = audacityEffectParameterLabel(effectType, name, copy);
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
				options={descriptor.options.map((option) => ({
					value: String(option.value),
					label: audacityEffectOptionLabel(effectType, name, option.value, copy),
				}))}
				onChange={onCommit}
				disabled={disabled}
				hook={`effect-param-${name}`}
			/>
		);
	}
	if (descriptor.kind === 'curve') {
		return (
			<div className="audio-editor-filter-curve" data-effect-param={name}>
				<svg viewBox="0 0 640 220" preserveAspectRatio="none" role="img" aria-label={label}>
					<g className="audio-editor-filter-curve__grid">
						<path d="M16 16 H624 M16 63 H624 M16 110 H624 M16 157 H624 M16 204 H624" />
						<path d="M16 16 V204 M117 16 V204 M218 16 V204 M320 16 V204 M421 16 V204 M522 16 V204 M624 16 V204" />
					</g>
					<polyline className="audio-editor-filter-curve__line" points={audacityCurvePolyline(value, Boolean(effectParams?.linearFrequencyScale))} />
				</svg>
				<details>
					<summary>{label}</summary>
					<CommitField
						label={label}
						name={name}
						value={formatAudacityCurve(value)}
						disabled={disabled}
						multiline
						hookName="effect-param"
						onCommit={(_field, next) => onCommit(parseAudacityCurve(next))}
					/>
				</details>
				<div className="audio-editor-panel-actions audio-editor-filter-curve__actions">
					<Button variant="secondary" disabled={disabled} onClick={() => onCommit([{ frequency: 20, gain: 0 }, { frequency: 20_000, gain: 0 }])}>{copy.reset}</Button>
					<Button variant="secondary" disabled={disabled} onClick={() => onCommit((value || []).map((point) => ({ ...point, gain: -point.gain })))}>{copy.invert}</Button>
				</div>
			</div>
		);
	}
	if (descriptor.kind === 'bands') {
		return (
			<fieldset className="audio-editor-graphic-eq">
				<legend>{label}</legend>
				<div className="audio-editor-graphic-eq__faders">
					{descriptor.frequencies.map((frequency, index) => {
						const gain = value?.[index] ?? 0;
						return (
							<div className="audio-editor-graphic-eq__fader" data-effect-param={`${name}.${index}`} key={frequency}>
								<output>{Number(gain).toFixed(1)}</output>
								<div className="audio-editor-graphic-eq__slider">
									<SteppedSlider
										value={gain}
										min={descriptor.minimum}
										max={descriptor.maximum}
										step={descriptor.step}
										ariaLabel={`${frequency} Hz`}
										disabled={disabled}
										onChange={(next) => {
											const values = Array.isArray(value) ? [...value] : [...descriptor.default];
											values[index] = Math.round(next / descriptor.step) * descriptor.step;
											onCommit(values);
										}}
									/>
								</div>
								<span>{frequency >= 1_000 ? `${frequency / 1_000}k` : frequency}</span>
							</div>
						);
					})}
				</div>
				<div className="audio-editor-panel-actions audio-editor-graphic-eq__actions">
					<Button variant="secondary" disabled={disabled} onClick={() => onCommit(descriptor.frequencies.map(() => 0))}>{copy.reset}</Button>
					<Button variant="secondary" disabled={disabled} onClick={() => onCommit((value || descriptor.default).map((gain) => -gain))}>{copy.invert}</Button>
				</div>
			</fieldset>
		);
	}
	const range = audioEffectParamRange(effectType, name) || audioEffectParamRangeFromDescriptor(descriptor);
	return (
		<ParameterNumber
			label={`${label}${descriptor.unit ? ` (${descriptor.unit})` : ''}`}
			value={value}
			range={range}
			step={descriptor.step}
			presentation={audacityParameterPresentation(effectType, name)}
			copy={copy}
			disabled={disabled}
			hook={name}
			onCommit={onCommit}
		/>
	);
}

function ParameterNumber({ label, value, range, step, presentation = 'knob', copy, disabled, hook, onCommit }) {
	const knobRange = Array.isArray(range) && range.length === 2 && range.every(Number.isFinite) ? range : null;
	const knobStep = Number.isFinite(step) && step > 0
		? step
		: Number.isInteger(value) && knobRange?.every(Number.isInteger) ? 1 : 0.01;
	const commit = (raw) => {
		const next = Number(raw);
		if (!Number.isFinite(next) || (range && (next < range[0] || next > range[1]))) {
			throw new RangeError(copy.parameterRangeError
				.replace('{label}', label)
				.replace('{minimum}', String(range?.[0] ?? '−∞'))
				.replace('{maximum}', String(range?.[1] ?? '∞')));
		}
		onCommit(next);
	};
	const commitSlider = (next) => {
		const snapped = knobStep > 0
			? Math.round((next - knobRange[0]) / knobStep) * knobStep + knobRange[0]
			: next;
		onCommit(Number(snapped.toFixed(8)));
	};
	return (
		<div className={`audio-editor-effect-number audio-editor-effect-number--${presentation}`} data-effect-param={hook} role="group" aria-label={label}>
			<span>{label}</span>
			{knobRange && presentation === 'knob' && <Knob
				value={Number(value) || 0}
				min={knobRange[0]}
				max={knobRange[1]}
				step={knobStep}
				label={label}
				mode={knobRange[0] < 0 && knobRange[1] > 0 ? 'bipolar' : 'unipolar'}
				disabled={disabled}
				onChange={onCommit}
			/>}
			{knobRange && presentation === 'slider' && <SteppedSlider
				value={Number(value) || 0}
				min={knobRange[0]}
				max={knobRange[1]}
				step={knobStep}
				ariaLabel={label}
				disabled={disabled}
				onChange={commitSlider}
			/>}
			<CommitField
				label={label}
				name={hook}
				value={String(value ?? '')}
				type="number"
				disabled={disabled}
				hookName="effect-number-input"
				visuallyHiddenLabel
				onCommit={(_name, raw) => commit(raw)}
			/>
		</div>
	);
}

// v0.9.0's Slider parses values as integers and does not expose a step prop.
// Preserve its DOM/CSS contract while keeping Audacity's fractional parameters.
function SteppedSlider({ value, min, max, step, ariaLabel, disabled, onChange }) {
	const clampedValue = Math.max(min, Math.min(max, Number(value) || 0));
	const percentage = max === min ? 0 : (clampedValue - min) / (max - min) * 100;
	return (
		<div
			className={`slider audio-editor-stepped-slider${disabled ? ' slider--disabled' : ''}`}
			style={{
				'--slider-track-bg': 'var(--kw-editor-line)',
				'--slider-fill-bg': 'var(--kw-editor-accent)',
				'--slider-handle-bg': 'var(--kw-editor-panel)',
				'--slider-handle-border': 'var(--kw-editor-accent-strong)',
			}}
		>
			<input
				type="range"
				className="slider__input"
				value={clampedValue}
				min={min}
				max={max}
				step={step}
				aria-label={ariaLabel}
				disabled={disabled}
				onChange={(event) => onChange(Number(event.currentTarget.value))}
			/>
			<div className="slider__track"><div className="slider__fill" style={{ width: `${percentage}%` }} /></div>
			<div className="slider__handle" style={{ left: `calc(${percentage}% - ${percentage / 100 * 16}px)` }} />
		</div>
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
	const [metadataOpen, setMetadataOpen] = useState(false);
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
		if (!isOpen) setMetadataOpen(false);
	}, [isOpen]);

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
		if (metadataOpen) {
			setMetadataOpen(false);
			return;
		}
		if (!exporting) onClose?.();
	};
	const metadataFields = [
		['metadataTitle', copy.metadataTitle],
		['metadataArtist', copy.metadataArtist],
		['metadataAlbum', copy.metadataAlbum],
		['metadataTrack', copy.metadataTrack],
		['metadataYear', copy.metadataYear],
		['metadataGenre', copy.metadataGenre],
		['metadataComments', copy.metadataComments],
		['metadataCopyright', copy.metadataCopyright],
	];

	if (metadataOpen) {
		return (
			<ControlledDialog
				isOpen={isOpen}
				title={copy.metadata}
				onClose={() => setMetadataOpen(false)}
				width={760}
				className="audio-editor-metadata-dialog"
				dataAttributes={{ 'data-export-metadata-dialog': '' }}
				footer={(
					<DialogFooter
						className="audio-editor-dialog-footer"
						rightContent={<Button variant="primary" onClick={() => setMetadataOpen(false)}>{copy.done}</Button>}
					/>
				)}
			>
				<section className="audio-editor-metadata-editor">
					<p className="audio-editor-panel-hint">{copy.metadataFormatHint}</p>
					<div className="audio-editor-metadata-table" role="table" aria-label={copy.metadata}>
						<div className="audio-editor-metadata-table__header" role="row">
							<span role="columnheader">{copy.metadataTagColumn}</span>
							<span role="columnheader">{copy.metadataValueColumn}</span>
						</div>
						{metadataFields.map(([name, label]) => (
							<label className="audio-editor-metadata-table__row" role="row" key={name}>
								<span role="cell">{label}</span>
								<span role="cell"><TextInput multiline={name === 'metadataComments'} value={settings[name]} onChange={(value) => set(name, value)} width="100%" /></span>
							</label>
						))}
					</div>
					<details className="audio-editor-export-details">
						<summary>{copy.customMetadata}</summary>
						<label className="audio-editor-field">
							<span>{copy.customMetadata}</span>
							<TextInput multiline value={settings.metadataCustom} onChange={(value) => set('metadataCustom', value)} width="100%" />
						</label>
					</details>
				</section>
			</ControlledDialog>
		);
	}

	return (
		<ControlledDialog
			isOpen={isOpen}
			title={copy.exportDialog || copy.export}
			onClose={requestClose}
			closeOnEscape={!exporting}
			closeOnOutside={!exporting}
			width={640}
			className="audio-editor-export-dialog"
			dataAttributes={{ 'data-export-dialog': '' }}
			footer={(
				<DialogFooter
					className="audio-editor-dialog-footer"
					leftContent={<Button variant="secondary" disabled={exporting} onClick={() => setMetadataOpen(true)}>{copy.metadata}</Button>}
					rightContent={exporting ? (
						<span data-export-action="cancel"><Button disabled={!exporting} onClick={() => controller.actions.export.cancel()}>{copy.cancelExport}</Button></span>
					) : (
						<>
							<Button variant="secondary" onClick={requestClose}>{copy.cancel}</Button>
							<span data-export-action="start"><Button variant="primary" disabled={blocked} onClick={start}>{copy.startExport}</Button></span>
						</>
					)}
				/>
			)}
		>
			<div className="audio-editor-export-dialog__body">
				<section className="audio-editor-export-section">
					<h3>{copy.exportSection}</h3>
					<LabeledDropdown label={copy.exportMode} hook="mode" value={settings.mode} onChange={(value) => set('mode', value)} disabled={exporting} options={[{ value: 'mix', label: copy.mix }, { value: 'stems', label: copy.stems }]} />
					<LabeledDropdown label={copy.exportRange} hook="range" value={settings.range} onChange={(value) => set('range', value)} disabled={exporting} options={[{ value: 'project', label: copy.entireProject }, { value: 'selection', label: copy.currentSelection, disabled: !hasSelection }, { value: 'loop', label: copy.loopRegion, disabled: !hasLoop }]} />
				</section>
				<Separator />
				<section className="audio-editor-export-section">
					<h3>{copy.audioOptionsSection}</h3>
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
					{settings.channelMapping === 'custom' && <label className="audio-editor-field"><span>{copy.customChannelMapping}</span><span><TextInput multiline value={settings.channelMatrix} disabled={exporting} onChange={(value) => set('channelMatrix', value)} width="100%" /><small>{copy.customChannelMappingHint}</small></span></label>}
				</section>
				<Separator />
				<section className="audio-editor-export-section">
					<h3>{copy.renderingSection}</h3>
					<div className="audio-editor-export-check" data-export-field="tails">
						<span aria-hidden="true" />
						<DesignCheckbox label={copy.includeTails} checked={settings.includeTail} disabled={exporting} onChange={(checked) => set('includeTail', checked)} />
					</div>
				</section>
				{settings.format === 'custom-ffmpeg' && (
					<>
						<Separator />
						<details className="audio-editor-export-details" open>
							<summary>{copy.advancedOptions}</summary>
							<div className="audio-editor-export-section">
								<label className="audio-editor-field"><span>{copy.customExtension}</span><TextInput value={settings.customExtension} disabled={exporting} onChange={(value) => set('customExtension', value)} width="100%" /></label>
								<label className="audio-editor-field"><span>{copy.customMimeType}</span><TextInput value={settings.customMimeType} disabled={exporting} onChange={(value) => set('customMimeType', value)} width="100%" /></label>
								<label className="audio-editor-field"><span>{copy.customArguments}</span><TextInput multiline value={settings.customArguments} disabled={exporting} onChange={(value) => set('customArguments', value)} width="100%" /></label>
							</div>
						</details>
					</>
				)}
				<p className="audio-editor-panel-hint">{copy.exportHint}</p>
				<div className="audio-editor-export-progress" data-export-progress aria-live="polite" hidden={!exporting}>
					<ProgressBar value={progress} width="100%" />
					<output>{progress}%</output>
				</div>
				{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
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

function CommitField({ label, name, value, type = 'text', disabled, readOnly, multiline, hookName = 'clip-field', visuallyHiddenLabel = false, onCommit }) {
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
			<span className={visuallyHiddenLabel ? 'kw-audio-editor-sr-only' : undefined}>{label}</span>
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

function resolveSupportedEffectType(candidate, locale, copy) {
	const normalizedLocale = normalizeBcp47Locale(locale);
	const normalized = String(candidate || '').trim().toLocaleLowerCase(normalizedLocale);
	return audioEffectTypes().find((type) => {
		const labels = [type, safeEffectLabel(type, copy), safeEffectLabel(type, 'en'), safeEffectLabel(type, 'de')];
		return labels.some((label) => String(label).trim().toLocaleLowerCase(normalizedLocale) === normalized);
	}) || null;
}

function macroFileName(value) {
	return String(value || 'macro')
		.trim()
		.replace(/[^a-z0-9_-]+/gi, '-')
		.replace(/^-+|-+$/g, '')
		|| 'macro';
}

function downloadTextFile(text, name) {
	const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = name;
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeEffectLabel(type, copyOrLocale) {
	try {
		return audioEffectLabel(type, copyOrLocale);
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

function audacityCurvePolyline(points, linearFrequencyScale = false) {
	const values = Array.isArray(points) && points.length
		? points
		: [{ frequency: 20, gain: 0 }, { frequency: 20_000, gain: 0 }];
	return values.map((point) => {
		const frequency = Math.max(20, Math.min(20_000, Number(point.frequency) || 20));
		const gain = Math.max(-30, Math.min(30, Number(point.gain) || 0));
		const x = linearFrequencyScale
			? 16 + (frequency - 20) / (20_000 - 20) * 608
			: 16 + Math.log10(frequency / 20) / 3 * 608;
		const y = 110 - gain / 30 * 94;
		return `${x.toFixed(2)},${y.toFixed(2)}`;
	}).join(' ');
}

function audacityParameterVisible(effect, name) {
	if (effect.type === 'audacity-loudness-normalization') {
		if (name === 'targetLufs') return effect.params?.mode === 'lufs';
		if (name === 'targetRmsDb') return effect.params?.mode === 'rms';
	}
	if (effect.type === 'audacity-normalize' && name === 'peakDb') return Boolean(effect.params?.applyGain);
	if (effect.type === 'audacity-truncate-silence') {
		if (name === 'truncateTo') return effect.params?.action === 'truncate';
		if (name === 'compressPercent') return effect.params?.action === 'compress';
	}
	if (effect.type === 'audacity-classic-filters') {
		if (name === 'passbandRippleDb') return effect.params?.family === 'chebyshev-i';
		if (name === 'stopbandAttenuationDb') return effect.params?.family === 'chebyshev-ii';
	}
	return true;
}

function audacityParameterPresentation(effectType, name) {
	const sliderParameters = {
		'audacity-amplify': ['gainDb'],
		'audacity-click-removal': ['threshold', 'maximumWidth'],
		'audacity-change-pitch': ['semitones'],
		'audacity-change-tempo': ['tempoPercent'],
		'audacity-change-speed-pitch': ['speedPercent'],
		'audacity-sliding-stretch': ['startTempoPercent', 'endTempoPercent', 'startPitchSemitones', 'endPitchSemitones'],
		'audacity-noise-reduction': ['reductionDb', 'sensitivity', 'frequencySmoothingBands'],
		'audacity-normalize': ['peakDb'],
	};
	if (sliderParameters[effectType]?.includes(name)) return 'slider';
	if ([
		'audacity-bass-treble',
		'audacity-compressor',
		'audacity-legacy-compressor',
		'audacity-distortion',
		'audacity-limiter',
		'audacity-phaser',
		'audacity-reverb',
		'audacity-wahwah',
	].includes(effectType)) return 'knob';
	return 'number';
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
