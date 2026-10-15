/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef, useState } from 'react';
import { createVideoEffectV2, normalizeVideoEffectV2, videoEffectDefinitionV2 } from '../../video-effects-v2.ts';
import type { VideoEffectLeafV2 } from '../../video-effect-leaf-v2.ts';
import type { PhotoDevelopCopyV1 } from '../../../i18n/lightscaper-develop-copy.ts';
import type { PhotoDevelopEffectsAuthoringPortV1 } from '../../controller/shared/photo-library-develop-workflow-current-v1.ts';
import VideoEffectNumberInput from '../inspector/VideoEffectNumberInput.tsx';
import VideoCurveControl from '../inspector/VideoCurveControl.tsx';
import PhotoDevelopColorWheelsV2 from './PhotoDevelopColorWheelsV2.tsx';
import PhotoDevelopCubeLutV2 from './PhotoDevelopCubeLutV2.tsx';
import type { PhotoLibraryCubeLutPortV1 } from '../../photo-library-cube-lut-port-v1.ts';
import { normalizePointCurvesParamsV1 } from '../../video-curves-v1.ts';

const TYPES = ['white-balance-v1', 'tone-ladder-v1', 'develop-geometry-v1', 'lens-distortion-v1', 'chroma-v1', 'black-white-mix-v1', 'hsl-mixer-v1', 'point-curves-v1', 'parametric-curves-v1', 'color-wheels-v1', 'detail-sharpen-v1', 'post-crop-vignette-v1', 'clarity-v1', 'noise-reduction-v1', 'grain-v1', 'texture-v1', 'dehaze-v1', 'cube-lut-profile-v1'] as const;
export default function PhotoDevelopEffectsV2(props: Readonly<{ effects: readonly VideoEffectLeafV2[]; owner: PhotoDevelopEffectsAuthoringPortV1;
	messages: PhotoDevelopCopyV1; disabled: boolean; isCurrent: () => boolean; importCubeLut?: PhotoLibraryCubeLutPortV1['importFile'];
	onImportPending: (pending: boolean) => void; registerImportRetirement: (retire: () => Promise<void>) => () => void }>) {
	const { messages, owner, effects, disabled } = props, [type, setType] = useState<string>(TYPES[0]), [error, setError] = useState('');
	const label = (effectType: string) => effectType === 'develop-geometry-v1' ? messages.geometry
		: messages.shared[videoEffectDefinitionV2(effectType).labelKey] ?? videoEffectDefinitionV2(effectType).label;
	const current = () => !disabled && props.isCurrent();
	const currentEffect = (_effect: VideoEffectLeafV2) => current() && owner.snapshot().draft?.effects === effects;
	const refusal = useRef<Readonly<{ effect: VideoEffectLeafV2; name: string }> | null>(null);
	const set = (next: readonly VideoEffectLeafV2[]) => { if (current() && owner.snapshot().draft?.effects === effects) owner.setEffects(next); };
	const preview = (effect: VideoEffectLeafV2, name: string, value: number) => {
		const params = { [name]: value };
		if (!currentEffect(effect)) return false;
		try { normalizeVideoEffectV2({ ...effect, params: { ...effect.params, ...params } }); }
		catch { refusal.current = { effect, name }; setError(effect.type === 'parametric-curves-v1' ? messages.shared.videoEffectCurveParametersInvalid!
			: effect.type === 'post-crop-vignette-v1' ? messages.shared.videoEffectPostCropVignetteInvalid! : messages.shared.videoEffectParametersInvalid!); return false; }
		refusal.current = null; setError(''); owner.previewEffect(effect.id, params); return true;
	};
	const settleGesture = (effect: VideoEffectLeafV2, name: string, cancel = false) => {
		if (!currentEffect(effect)) return;
		const previous = refusal.current, matches = previous?.effect === effect && previous.name === name;
		if (cancel) owner.cancelGesture(); else owner.commitGesture();
		if (matches && refusal.current === previous) { refusal.current = null; setError(''); }
	};
	return <section aria-label={messages.adjustments} data-photo-develop-effects>
		<h3>{messages.adjustments}</h3>
		<label>{messages.choose}<select value={type} disabled={disabled} onChange={event => { if (currentEffect(effects[0]!)) setType(event.currentTarget.value); }}>
			{TYPES.map(value => <option key={value} value={value}>{label(value)}</option>)}
		</select></label>
		<button type="button" disabled={disabled || effects.length >= 64} onClick={() => {
			set([...effects, createVideoEffectV2(type)]);
		}}>{messages.add}</button>
		{effects.length === 0 && <p>{messages.empty}</p>}
		<ol>{effects.map((effect, index) => {
			const definition = videoEffectDefinitionV2(effect.type), supported = TYPES.some(value => value === effect.type), title = label(effect.type);
			return <li key={effect.id} data-photo-develop-effect={effect.type}>
				<fieldset disabled={disabled}><legend>{title}</legend>
					<label><input type="checkbox" checked={effect.enabled} onChange={event => {
						set(effects.map(candidate => candidate.id === effect.id ? { ...candidate, enabled: event.currentTarget.checked } : candidate));
					}} />{title}</label>
					<button type="button" disabled={index === 0} aria-label={`${messages.up}: ${title}`} onClick={() => {
						const next = [...effects]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; set(next);
					}}>↑</button>
					<button type="button" disabled={index === effects.length - 1} aria-label={`${messages.down}: ${title}`} onClick={() => {
						const next = [...effects]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; set(next);
					}}>↓</button>
					<button type="button" aria-label={`${messages.remove}: ${title}`} onClick={() => { set(effects.filter(candidate => candidate.id !== effect.id)); }}>×</button>
					{!supported && <p>{messages.unsupported}</p>}
					{effect.type === 'cube-lut-profile-v1' ? <PhotoDevelopCubeLutV2 effect={effect} effects={effects} owner={owner} copy={messages.shared}
						disabled={disabled || !effect.enabled} isCurrent={props.isCurrent} importCubeLut={props.importCubeLut}
						onPending={props.onImportPending} registerRetirement={props.registerImportRetirement} /> : effect.type === 'color-wheels-v1' ? <PhotoDevelopColorWheelsV2 effect={effect} effects={effects} owner={owner} copy={messages.shared}
						disabled={disabled || !effect.enabled} isCurrent={props.isCurrent} /> : supported && Object.entries(definition.params).map(([name, raw]) => {
						const parameter = raw, text = messages.shared[parameter.labelKey] ?? parameter.label;
						const exact = `${messages.shared.videoEffectExactValue}: ${text}`, value = effect.params[name] ?? 0;
						if (parameter.control === 'curve') {
							const points = normalizePointCurvesParamsV1({ master: value }).master;
							return <VideoCurveControl key={name} label={text} points={points} disabled={disabled || !effect.enabled} isCurrent={() => currentEffect(effect)}
								messages={{ addPoint: messages.shared.videoEffectCurveAddPoint!, removePoint: messages.shared.videoEffectCurveRemovePoint!,
									input: messages.shared.videoEffectCurveInput!, output: messages.shared.videoEffectCurveOutput!, invalid: messages.shared.videoEffectCurveInvalid! }}
								onBegin={() => { if (currentEffect(effect)) owner.beginGesture(); }} onPreview={points => { if (currentEffect(effect)) owner.previewEffect(effect.id, { [name]: points }); }}
								onCommit={() => { if (currentEffect(effect)) owner.commitGesture(); }} onCancel={() => { if (currentEffect(effect)) owner.cancelGesture(); }}
								onChange={points => { if (!currentEffect(effect)) return; owner.commitGesture();
									set(effects.map(candidate => candidate === effect ? { ...effect, params: { ...effect.params, [name]: points } } : candidate)); }} />;
						}
						if (typeof value !== 'number') throw new TypeError('Numeric adjustment controls require numeric parameters.');
						if (typeof parameter.min !== 'number' || typeof parameter.max !== 'number' || typeof parameter.step !== 'number') throw new TypeError('Numeric adjustment controls require bounded numeric definitions.');
						return <label key={name}>{text}{parameter.control === 'select'
							? <select aria-label={exact} value={value} disabled={disabled || !effect.enabled} onChange={event => {
								if (preview(effect, name, Number(event.currentTarget.value))) owner.commitGesture();
							}}>{parameter.options?.map(option => <option key={option.value} value={option.value}>{messages.shared[option.labelKey] ?? option.label}</option>)}</select>
							: <VideoEffectNumberInput label={exact} value={value} minimum={parameter.min} maximum={parameter.max} step={parameter.step}
								disabled={disabled || !effect.enabled} onBegin={() => { if (currentEffect(effect)) owner.beginGesture(); }}
								onPreview={next => { preview(effect, name, next); }} onCommit={() => { settleGesture(effect, name); }}
								onCancel={() => { settleGesture(effect, name, true); }} />}</label>;
					})}
				</fieldset>
			</li>;
		})}</ol>
		{error && <p role="alert">{error}</p>}
	</section>;
}
