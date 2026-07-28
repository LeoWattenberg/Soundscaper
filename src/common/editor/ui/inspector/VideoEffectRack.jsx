import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@dilsonspickles/components';
import { VIDEO_EFFECT_TYPES, videoEffectDefinition } from '../../video-effects.js';
import { DesignCheckbox, LabeledDropdown } from './inspector-controls.jsx';

export function VideoEffectRack({ clip, controller, copy, disabled, onError }) {
	const effects = clip.videoEffects || [];
	const [effectType, setEffectType] = useState(VIDEO_EFFECT_TYPES[0] || '');
	const actions = controller.actions.video?.effects;
	const mutationDisabled = disabled || !actions;
	const effectOptions = useMemo(() => VIDEO_EFFECT_TYPES.map((type) => {
		const descriptor = videoEffectDefinition(type);
		return { value: type, label: labelFor(descriptor, copy) };
	}), [copy]);

	const run = (work) => {
		if (mutationDisabled) return;
		onError('');
		try {
			Promise.resolve(work()).catch((cause) => onError(errorText(cause)));
		} catch (cause) {
			onError(errorText(cause));
		}
	};

	return (
		<section className="audio-editor-clip-properties__card audio-editor-clip-properties__card--wide audio-editor-video-effects" data-video-effect-rack>
			<div className="audio-editor-video-effects__heading">
				<div><h3>{copy.videoEffects}</h3><p>{copy.videoEffectsHint}</p></div>
				<div className="audio-editor-video-effects__add">
					<LabeledDropdown label={copy.chooseEffect} options={effectOptions} value={effectType} onChange={setEffectType} disabled={mutationDisabled} hook="video-effect-picker" />
					<Button variant="secondary" disabled={mutationDisabled || !effectType} onClick={() => run(() => actions.add(clip.id, effectType))}>{copy.addEffect}</Button>
				</div>
			</div>
			{effects.length === 0 && <p className="audio-editor-panel-hint" data-video-effect-empty>{copy.videoEffectsEmpty}</p>}
			{effects.length > 0 && <ol className="audio-editor-video-effects__list">
				{effects.map((effect, index) => (
					<VideoEffectRow key={effect.id} effect={effect} clipId={clip.id} index={index} count={effects.length} actions={actions} copy={copy} disabled={mutationDisabled} onError={onError} onRun={run} />
				))}
			</ol>}
		</section>
	);
}

function VideoEffectRow({ effect, clipId, index, count, actions, copy, disabled, onError, onRun }) {
	const descriptor = videoEffectDefinition(effect.type);
	const label = labelFor(descriptor, copy);
	return (
		<li className="audio-editor-video-effect" data-video-effect-id={effect.id} data-video-effect-type={effect.type} data-enabled={effect.enabled !== false ? 'true' : 'false'}>
			<header className="audio-editor-video-effect__header">
				<DesignCheckbox label={label} checked={effect.enabled !== false} disabled={disabled} onChange={(checked) => onRun(() => actions.toggle(clipId, effect.id, checked))} />
				<div className="audio-editor-video-effect__actions">
					<button type="button" disabled={disabled || index === 0} aria-label={`${copy.moveEffectUp}: ${label}`} title={copy.moveEffectUp} onClick={() => onRun(() => actions.reorder(clipId, effect.id, index - 1))}>↑</button>
					<button type="button" disabled={disabled || index === count - 1} aria-label={`${copy.moveEffectDown}: ${label}`} title={copy.moveEffectDown} onClick={() => onRun(() => actions.reorder(clipId, effect.id, index + 1))}>↓</button>
					<button type="button" disabled={disabled} aria-label={`${copy.removeEffect}: ${label}`} title={copy.removeEffect} onClick={() => onRun(() => actions.remove(clipId, effect.id))}>×</button>
				</div>
			</header>
			<div className="audio-editor-video-effect__params">
				{Object.entries(descriptor.params).map(([name, parameter]) => (
					<VideoEffectParameter key={name} clipId={clipId} effectId={effect.id} name={name} parameter={parameter} value={effect.params[name]} actions={actions} copy={copy} disabled={disabled || effect.enabled === false} onError={onError} />
				))}
			</div>
		</li>
	);
}

function useEffectGesture({ actions, clipId, effectId, disabled, onError }) {
	const active = useRef(false);
	const begin = () => {
		if (disabled || active.current) return;
		try {
			actions.beginGesture(clipId, effectId);
			active.current = true;
			onError('');
		} catch (cause) { onError(errorText(cause)); }
	};
	const preview = (params) => {
		if (disabled) return;
		begin();
		try { actions.preview(clipId, effectId, params); onError(''); }
		catch (cause) { onError(errorText(cause)); }
	};
	const commit = () => {
		if (!active.current) return;
		active.current = false;
		try { actions.commit(clipId, effectId); onError(''); }
		catch (cause) { onError(errorText(cause)); }
	};
	const cancel = () => {
		if (!active.current) return;
		active.current = false;
		try { actions.cancel(clipId, effectId); onError(''); }
		catch (cause) { onError(errorText(cause)); }
	};
	useEffect(() => () => {
		if (!active.current) return;
		try { actions.cancel(clipId, effectId); } catch { /* Effect removal already ends the gesture. */ }
	}, [actions, clipId, effectId]);
	return { begin, preview, commit, cancel };
}

function VideoEffectParameter(props) {
	if (props.parameter.control === 'color') return <VideoEffectColor {...props} />;
	if (props.parameter.control === 'select') return <VideoEffectSelect {...props} />;
	return <VideoEffectSlider {...props} />;
}

function VideoEffectSelect({ clipId, effectId, name, parameter, value, actions, copy, disabled, onError }) {
	const label = parameterLabel(parameter, copy);
	return (
		<div className="audio-editor-video-effect__param" data-video-effect-param={name} role="group" aria-label={label}>
			<span>{label}</span>
			<select
				value={value}
				disabled={disabled}
				aria-label={`${copy.videoEffectExactValue}: ${label}`}
				onChange={(event) => {
					try { actions.update(clipId, effectId, { params: { [name]: Number(event.currentTarget.value) } }); onError(''); }
					catch (cause) { onError(errorText(cause)); }
				}}
			>
				{parameter.options.map((option) => <option key={option.value} value={option.value}>{copy[option.labelKey] || option.label}</option>)}
			</select>
		</div>
	);
}

function VideoEffectColor({ clipId, effectId, name, parameter, value, actions, copy, disabled, onError }) {
	const label = parameterLabel(parameter, copy);
	const canonical = packedColorToHex(value);
	const [draft, setDraft] = useState(canonical);
	const gesture = useEffectGesture({ actions, clipId, effectId, disabled, onError });
	useEffect(() => setDraft(canonical), [canonical]);
	const previewText = (text) => {
		setDraft(text);
		const packed = parsePackedColor(text);
		if (packed != null) gesture.preview({ [name]: packed });
	};
	const cancel = () => { gesture.cancel(); setDraft(canonical); };
	const commit = () => {
		if (parsePackedColor(draft) == null) {
			cancel();
			onError(copy.videoEffectColorInvalid || 'Enter a color as #RRGGBB.');
			return;
		}
		gesture.commit();
	};
	return (
		<div className="audio-editor-video-effect__param" data-video-effect-param={name} role="group" aria-label={label}>
			<span>{label}</span>
			<div className="audio-editor-video-effect__color">
				<input type="color" value={canonical} disabled={disabled} aria-label={label} onFocus={gesture.begin} onChange={(event) => previewText(event.currentTarget.value.toUpperCase())} onBlur={commit} />
				<input type="text" value={draft} disabled={disabled} aria-label={`${copy.videoEffectExactValue}: ${label}`} inputMode="text" maxLength={7} onFocus={gesture.begin} onChange={(event) => previewText(event.currentTarget.value)} onBlur={commit} onKeyDown={(event) => {
					if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
					if (event.key === 'Enter') { event.preventDefault(); commit(); event.currentTarget.blur(); }
				}} />
			</div>
		</div>
	);
}

function VideoEffectSlider({ clipId, effectId, name, parameter, value, actions, copy, disabled, onError }) {
	const gesture = useEffectGesture({ actions, clipId, effectId, disabled, onError });
	const label = parameterLabel(parameter, copy);
	const numericValue = Number(value);
	const percentage = parameter.max === parameter.min ? 0 : (numericValue - parameter.min) / (parameter.max - parameter.min) * 100;
	const keyDown = (event) => {
		if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); gesture.cancel(); }
		else if (event.key === 'Enter') gesture.commit();
	};
	const pointerDown = (event) => { event.currentTarget.setPointerCapture?.(event.pointerId); gesture.begin(); };
	return (
		<div className="audio-editor-video-effect__param" data-video-effect-param={name} role="group" aria-label={label}>
			<span>{label}</span>
			<div className="audio-editor-video-effect__value">
				<input type="number" value={numericValue} min={parameter.min} max={parameter.max} step={parameter.step} aria-label={`${copy.videoEffectExactValue}: ${label}`} disabled={disabled} onFocus={gesture.begin} onPointerDown={pointerDown} onChange={(event) => { if (Number.isFinite(event.currentTarget.valueAsNumber)) gesture.preview({ [name]: event.currentTarget.valueAsNumber }); }} onPointerUp={gesture.commit} onPointerCancel={gesture.cancel} onBlur={gesture.commit} onKeyDown={keyDown} />
				<output>{parameterUnit(parameter, copy)}</output>
			</div>
			<div className={`slider audio-editor-stepped-slider${disabled ? ' slider--disabled' : ''}`} style={{ '--slider-track-bg': 'var(--kw-editor-line)', '--slider-fill-bg': 'var(--kw-editor-accent)', '--slider-handle-bg': 'var(--kw-editor-panel)', '--slider-handle-border': 'var(--kw-editor-accent-strong)' }}>
				<input type="range" className="slider__input" value={numericValue} min={parameter.min} max={parameter.max} step={parameter.step} aria-label={label} aria-valuetext={parameterValue(value, parameter, copy)} disabled={disabled} onFocus={gesture.begin} onPointerDown={pointerDown} onChange={(event) => gesture.preview({ [name]: Number(event.currentTarget.value) })} onPointerUp={gesture.commit} onPointerCancel={gesture.cancel} onBlur={gesture.commit} onKeyDown={keyDown} />
				<div className="slider__track"><div className="slider__fill" style={{ width: `${percentage}%` }} /></div>
				<div className="slider__handle" style={{ left: `calc(${percentage}% - ${percentage / 100 * 16}px)` }} />
			</div>
		</div>
	);
}

export function packedColorToHex(value) {
	return `#${Number(value).toString(16).padStart(6, '0').slice(-6).toUpperCase()}`;
}

export function parsePackedColor(value) {
	return /^#[0-9A-F]{6}$/iu.test(String(value)) ? Number.parseInt(String(value).slice(1), 16) : null;
}

function labelFor(descriptor, copy) { return copy[descriptor.labelKey] || descriptor.label; }
function parameterLabel(parameter, copy) { return copy[parameter.labelKey] || parameter.label; }
function parameterUnit(parameter, copy) {
	if (parameter.unit === 'degrees') return '°';
	if (parameter.unit === 'pixels') return copy.videoEffectUnitPixels;
	return '';
}
function parameterValue(value, parameter, copy) {
	const decimals = parameter.integer ? 0 : Math.max(0, String(parameter.step).split('.')[1]?.length || 0);
	const formatted = Number(value).toFixed(Math.min(3, decimals));
	const unit = parameterUnit(parameter, copy);
	return unit ? `${formatted} ${unit}` : formatted;
}
function errorText(cause) { return cause instanceof Error ? cause.message : String(cause); }

export default VideoEffectRack;
