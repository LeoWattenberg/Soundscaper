import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, DialogFooter } from '@dilsonspickles/components';
import {
	AUDIO_EDITOR_SAMPLE_RATE,
	findClip,
	findClipTrack,
	findSource,
} from '../../project.js';
import { VIDEO_EFFECT_TYPES, videoEffectDefinition } from '../../video-effects.js';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { selectAudioEditorEditBlock } from '../edit-blocking.ts';
import { ActionHook, CommitField, DesignCheckbox, LabeledDropdown } from './inspector-controls.jsx';
import {
	dbToLinear,
	framesToSecondsText,
	linearToDb,
	nonNegativeFrame,
	secondsInputToFrames,
} from './inspector-helpers.ts';

export function ClipPropertiesDialog({ isOpen, controller, snapshot, copy, onClose }) {
	return (
		<AudioEditorDialogShell
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
		</AudioEditorDialogShell>
	);
}

function ClipProperties({ controller, snapshot, copy }) {
	const project = snapshot.project;
	const clip = project && snapshot.selectedClipId ? findClip(project, snapshot.selectedClipId) : null;
	const source = clip ? findSource(project, clip.sourceId) : null;
	const track = clip ? findClipTrack(project, clip.id) : null;
	const sampleRate = project?.sampleRate || AUDIO_EDITOR_SAMPLE_RATE;
	const blocked = selectAudioEditorEditBlock(snapshot).blocked;
	const disabled = blocked || !clip;
	const isVideoClip = clip?.kind === 'video';
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
				{!isVideoClip && <section className="audio-editor-clip-properties__card">
					<h3>{copy.fading}</h3>
					<div className="audio-editor-clip-properties__stack">
						<CommitField label={`${copy.clipGain} (dB)`} name="gain" value={clip ? linearToDb(clip.gain).toFixed(2) : '0.00'} type="number" disabled={disabled} onCommit={commitField} />
						<CommitField label={`${copy.fadeIn} (s)`} name="fadeIn" value={clip ? framesToSecondsText(clip.fadeInFrames, sampleRate) : '0.000'} type="number" disabled={disabled} onCommit={commitField} />
						<CommitField label={`${copy.fadeOut} (s)`} name="fadeOut" value={clip ? framesToSecondsText(clip.fadeOutFrames, sampleRate) : '0.000'} type="number" disabled={disabled} onCommit={commitField} />
					</div>
				</section>}
				{!isVideoClip && snapshot.capabilities?.audioEffects && <section className="audio-editor-clip-properties__card">
					<h3>{copy.pitchTempo}</h3>
					<div className="audio-editor-clip-properties__stack">
						<CommitField label={copy.clipPitchCents} name="pitchCents" value={clip?.pitchCents ?? 0} type="number" disabled={disabled} onCommit={commitField} />
						<CommitField label={copy.clipSpeedRatio} name="speedRatio" value={clip?.speedRatio ?? 1} type="number" disabled={disabled} onCommit={commitField} />
						<div data-clip-field="preserveFormants"><DesignCheckbox label={copy.preserveFormants} checked={Boolean(clip?.preserveFormants)} disabled={disabled} onChange={(checked) => controller.actions.clip.setTimePitch(clip.id, { preserveFormants: checked })} /></div>
						<div data-clip-field="stretchToTempo"><DesignCheckbox label={copy.stretchToTempo} checked={Boolean(clip?.stretchToTempo)} disabled={disabled} onChange={() => controller.actions.clip.toggleStretchToTempo(clip.id)} /></div>
					</div>
				</section>}
				{isVideoClip && snapshot.capabilities?.videoEffects && <VideoEffectRack
					clip={clip}
					controller={controller}
					copy={copy}
					disabled={disabled}
					onError={setError}
				/>}
			</div>
			{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
			{!isVideoClip && snapshot.capabilities?.audioEffects && <div className="audio-editor-panel-actions">
				<ActionHook hook="reverse"><Button disabled={disabled} onClick={() => run(controller.actions.clip.reverse)}>{copy.reverse}</Button></ActionHook>
				<ActionHook hook="normalize-peak"><Button disabled={disabled} onClick={() => run(controller.actions.clip.normalizePeak)}>{copy.normalizePeak}</Button></ActionHook>
				<ActionHook hook="normalize-lufs"><Button disabled={disabled} onClick={() => run(controller.actions.clip.normalizeLoudness)}>{copy.normalizeLufs}</Button></ActionHook>
				<ActionHook hook="render-pitch-speed"><Button disabled={disabled || !clip || (clip.pitchCents === 0 && clip.speedRatio === 1)} onClick={() => run(controller.actions.clip.renderPitchSpeed)}>{copy.renderPitchSpeed}</Button></ActionHook>
				<ActionHook hook="reset-pitch-speed"><Button variant="secondary" disabled={disabled || !clip || (clip.pitchCents === 0 && clip.speedRatio === 1)} onClick={() => run(controller.actions.clip.resetPitchSpeed)}>{copy.resetPitchSpeed}</Button></ActionHook>
			</div>}
		</div>
	);
}

function VideoEffectRack({ clip, controller, copy, disabled, onError }) {
	const effects = clip.videoEffects || [];
	const [effectType, setEffectType] = useState(VIDEO_EFFECT_TYPES[0] || '');
	const effectActions = controller.actions.video?.effects;
	const mutationDisabled = disabled || !effectActions;
	const effectOptions = useMemo(() => VIDEO_EFFECT_TYPES.map((type) => {
		const descriptor = videoEffectDefinition(type);
		return { value: type, label: videoEffectLabel(descriptor, copy) };
	}), [copy]);

	useEffect(() => {
		if (!VIDEO_EFFECT_TYPES.includes(effectType)) setEffectType(VIDEO_EFFECT_TYPES[0] || '');
	}, [effectType]);

	const runEffectAction = (work) => {
		if (mutationDisabled) return;
		onError('');
		try {
			Promise.resolve(work()).catch((cause) => {
				onError(cause instanceof Error ? cause.message : String(cause));
			});
		} catch (cause) {
			onError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	return (
		<section
			className="audio-editor-clip-properties__card audio-editor-clip-properties__card--wide audio-editor-video-effects"
			data-video-effect-rack
		>
			<div className="audio-editor-video-effects__heading">
				<div>
					<h3>{copy.videoEffects}</h3>
					<p>{copy.videoEffectsHint}</p>
				</div>
				<div className="audio-editor-video-effects__add">
					<LabeledDropdown
						label={copy.chooseEffect}
						options={effectOptions}
						value={effectType}
						onChange={setEffectType}
						disabled={mutationDisabled}
						hook="video-effect-picker"
					/>
					<Button
						variant="secondary"
						disabled={mutationDisabled || !effectType}
						onClick={() => runEffectAction(() => effectActions.add(clip.id, effectType))}
					>{copy.addEffect}</Button>
				</div>
			</div>
			{effects.length === 0 && (
				<p className="audio-editor-panel-hint" data-video-effect-empty>{copy.videoEffectsEmpty}</p>
			)}
			{effects.length > 0 && (
				<ol className="audio-editor-video-effects__list">
					{effects.map((effect, index) => (
						<VideoEffectRow
							key={effect.id}
							effect={effect}
							clipId={clip.id}
							index={index}
							count={effects.length}
							actions={effectActions}
							copy={copy}
							disabled={mutationDisabled}
							onError={onError}
							onRun={runEffectAction}
						/>
					))}
				</ol>
			)}
		</section>
	);
}

function VideoEffectRow({ effect, clipId, index, count, actions, copy, disabled, onError, onRun }) {
	const descriptor = videoEffectDefinition(effect.type);
	const label = videoEffectLabel(descriptor, copy);
	return (
		<li
			className="audio-editor-video-effect"
			data-video-effect-id={effect.id}
			data-video-effect-type={effect.type}
			data-enabled={effect.enabled !== false ? 'true' : 'false'}
		>
			<header className="audio-editor-video-effect__header">
				<DesignCheckbox
					label={label}
					checked={effect.enabled !== false}
					disabled={disabled}
					onChange={(checked) => onRun(() => actions.toggle(clipId, effect.id, checked))}
				/>
				<div className="audio-editor-video-effect__actions">
					<button
						type="button"
						disabled={disabled || index === 0}
						aria-label={`${copy.moveEffectUp}: ${label}`}
						title={copy.moveEffectUp}
						onClick={() => onRun(() => actions.reorder(clipId, effect.id, index - 1))}
					>↑</button>
					<button
						type="button"
						disabled={disabled || index === count - 1}
						aria-label={`${copy.moveEffectDown}: ${label}`}
						title={copy.moveEffectDown}
						onClick={() => onRun(() => actions.reorder(clipId, effect.id, index + 1))}
					>↓</button>
					<button
						type="button"
						disabled={disabled}
						aria-label={`${copy.removeEffect}: ${label}`}
						title={copy.removeEffect}
						onClick={() => onRun(() => actions.remove(clipId, effect.id))}
					>×</button>
				</div>
			</header>
			<div className="audio-editor-video-effect__params">
				{Object.entries(descriptor.params).map(([name, parameter]) => (
					<VideoEffectSlider
						key={name}
						clipId={clipId}
						effectId={effect.id}
						name={name}
						parameter={parameter}
						value={effect.params[name]}
						actions={actions}
						copy={copy}
						disabled={disabled || effect.enabled === false}
						onError={onError}
					/>
				))}
			</div>
		</li>
	);
}

function VideoEffectSlider({ clipId, effectId, name, parameter, value, actions, copy, disabled, onError }) {
	const gestureActiveRef = useRef(false);
	const label = videoEffectParameterLabel(parameter, copy);
	const displayValue = videoEffectParameterValue(value, parameter, copy);
	const begin = () => {
		if (disabled || gestureActiveRef.current) return;
		try {
			actions.beginGesture(clipId, effectId);
			gestureActiveRef.current = true;
			onError('');
		} catch (cause) {
			onError(cause instanceof Error ? cause.message : String(cause));
		}
	};
	const preview = (nextValue) => {
		if (disabled) return;
		begin();
		try {
			actions.preview(clipId, effectId, { [name]: nextValue });
			onError('');
		} catch (cause) {
			onError(cause instanceof Error ? cause.message : String(cause));
		}
	};
	const commit = () => {
		if (!gestureActiveRef.current) return;
		gestureActiveRef.current = false;
		try {
			actions.commit(clipId, effectId);
			onError('');
		} catch (cause) {
			onError(cause instanceof Error ? cause.message : String(cause));
		}
	};
	const cancel = () => {
		if (!gestureActiveRef.current) return;
		gestureActiveRef.current = false;
		try {
			actions.cancel(clipId, effectId);
			onError('');
		} catch (cause) {
			onError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	useEffect(() => () => {
		if (!gestureActiveRef.current) return;
		try {
			actions.cancel(clipId, effectId);
		} catch {
			// Removing an effect while its control unmounts already ends the gesture.
		}
	}, [actions, clipId, effectId]);

	const numericValue = Number(value);
	const percentage = parameter.max === parameter.min
		? 0
		: (numericValue - parameter.min) / (parameter.max - parameter.min) * 100;
	const beginPointerGesture = (event) => {
		event.currentTarget.setPointerCapture?.(event.pointerId);
		begin();
	};
	const handleKeyDown = (event) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			cancel();
		} else if (event.key === 'Enter') commit();
	};
	return (
		<div
			className="audio-editor-video-effect__param"
			data-video-effect-param={name}
			role="group"
			aria-label={label}
		>
			<span>{label}</span>
			<div className="audio-editor-video-effect__value">
				<input
					type="number"
					value={numericValue}
					min={parameter.min}
					max={parameter.max}
					step={parameter.step}
					aria-label={`${copy.videoEffectExactValue}: ${label}`}
					disabled={disabled}
					onFocus={begin}
					onPointerDown={beginPointerGesture}
					onChange={(event) => {
						const nextValue = event.currentTarget.valueAsNumber;
						if (Number.isFinite(nextValue)) preview(nextValue);
					}}
					onPointerUp={commit}
					onPointerCancel={cancel}
					onBlur={commit}
					onKeyDown={handleKeyDown}
				/>
				<output>{videoEffectParameterUnit(parameter, copy)}</output>
			</div>
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
					value={numericValue}
					min={parameter.min}
					max={parameter.max}
					step={parameter.step}
					aria-label={label}
					aria-valuetext={displayValue}
					disabled={disabled}
					onFocus={begin}
					onPointerDown={beginPointerGesture}
					onChange={(event) => preview(Number(event.currentTarget.value))}
					onPointerUp={commit}
					onPointerCancel={cancel}
					onBlur={commit}
					onKeyDown={handleKeyDown}
				/>
				<div className="slider__track"><div className="slider__fill" style={{ width: `${percentage}%` }} /></div>
				<div className="slider__handle" style={{ left: `calc(${percentage}% - ${percentage / 100 * 16}px)` }} />
			</div>
		</div>
	);
}

function videoEffectLabel(descriptor, copy) {
	return copy[descriptor.labelKey] || descriptor.label;
}

function videoEffectParameterLabel(parameter, copy) {
	return copy[parameter.labelKey] || parameter.label;
}

function videoEffectParameterValue(value, parameter, copy) {
	const decimals = parameter.integer
		? 0
		: Math.max(0, String(parameter.step).split('.')[1]?.length || 0);
	const formatted = Number(value).toFixed(Math.min(3, decimals));
	const unit = videoEffectParameterUnit(parameter, copy);
	if (unit) return `${formatted} ${unit}`;
	return formatted;
}

function videoEffectParameterUnit(parameter, copy) {
	if (parameter.unit === 'degrees') return '°';
	if (parameter.unit === 'pixels') return copy.videoEffectUnitPixels;
	return '';
}

export default ClipPropertiesDialog;
