/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useState } from 'react';

import {
	framescaperSelectedVisualAuthoringRuntimeFor,
	type FramescaperSelectedAuthoringController,
} from '../../../../framescaper/editor-selected-finishing-authoring-controller.ts';
import {
	createFramescaperSelectedVisualAuthoringModel,
	type FramescaperSelectedVisualAuthoringSurface,
} from '../../../../framescaper/editor-selected-finishing-visual-authoring-model.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import AudioEditorTimeCodeInput, {
	audioEditorProjectFrameRate,
} from '../AudioEditorTimeCodeInput.tsx';
import { runAwaitedAudioEditorOperation } from '../workspace/audio-editor-workspace-runner.ts';

import { SELECTED_VISUAL_AUTHORING_COPY } from '../../../i18n/editor-selected-visual-authoring-copy.ts';
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts';
import { publishedCopyFor } from '../../controller/shared/presentation-localization.ts';
import { useAvailableAuthoringPreset } from './useAvailableAuthoringPreset.ts';

interface Props {
	readonly copy?: Readonly<Record<string, string>>;
	readonly surface: FramescaperSelectedVisualAuthoringSurface;
	readonly controller: FramescaperSelectedAuthoringController;
	readonly project: unknown;
	readonly selectedClipId?: unknown;
	readonly playheadSample: unknown;
	readonly editingBlocked: boolean;
	readonly readOnly: boolean;
	readonly run: (operation: () => unknown) => unknown;
	readonly onClose: () => void;
}

export default function FramescaperSelectedVisualAuthoringDialog(props: Props) {
	const text = resolveEditorCopyScope('selectedVisualAuthoring', SELECTED_VISUAL_AUTHORING_COPY, props.copy);
	const model = useMemo(() => createFramescaperSelectedVisualAuthoringModel({
		surface: props.surface, project: props.project, copy: props.copy,
		selectedClipId: props.selectedClipId, playheadSample: props.playheadSample,
	}), [props.copy, props.playheadSample, props.project, props.selectedClipId, props.surface]);
	const frameRate = audioEditorProjectFrameRate(props.project);
	const [pairId, setPairId] = useState(model.selectedPairId ?? '');
	const [durationFrames, setDurationFrames] = useState(() => selectedPair(model, pairId)?.durationFrames ?? 12);
	const [brightness, setBrightness] = useState(String(model.adjustmentBrightness));
	const [adjustmentLayerId, setAdjustmentLayerId] = useState(model.adjustmentLayerId);
	const [maskId, setMaskId] = useState(model.selectedMaskId ?? '');
	const savedMask = model.maskDrafts.find(({ id }) => id === maskId);
	const [shape, setShape] = useState<Values['shape']>(savedMask?.shape ?? 'rectangle');
	const legacyMask = savedMask?.shape === 'rectangle' || savedMask?.shape === 'ellipse' ? savedMask : null;
	const gradientMask = savedMask?.shape === 'linear-gradient' ? savedMask : null;
	const radialMask = savedMask?.shape === 'radial-gradient' ? savedMask : null;
	const rangeMask = savedMask?.shape === 'luminance-range' ? savedMask : null;
	const colorMask = savedMask?.shape === 'color-range' ? savedMask : null;
	const [maskWidth, setMaskWidth] = useState(String(legacyMask?.width ?? 0.75));
	const [maskHeight, setMaskHeight] = useState(String(legacyMask?.height ?? 0.75));
	const [startX, setStartX] = useState(String(gradientMask?.startX ?? 0)), [startY, setStartY] = useState(String(gradientMask?.startY ?? 0));
	const [endX, setEndX] = useState(String(gradientMask?.endX ?? 1)), [endY, setEndY] = useState(String(gradientMask?.endY ?? 0));
	const [centerX, setCenterX] = useState(String(radialMask?.centerX ?? 0.5)), [centerY, setCenterY] = useState(String(radialMask?.centerY ?? 0.5));
	const [radiusX, setRadiusX] = useState(String(radialMask?.radiusX ?? 0.5)), [radiusY, setRadiusY] = useState(String(radialMask?.radiusY ?? 0.5));
	const [innerFraction, setInnerFraction] = useState(String(radialMask?.innerFraction ?? 0));
	const [lower, setLower] = useState(String(rangeMask?.lower ?? 0)), [upper, setUpper] = useState(String(rangeMask?.upper ?? 1));
	const [falloff, setFalloff] = useState(String(rangeMask?.falloff ?? 0));
	const [red, setRed] = useState(String(colorMask?.red ?? 1)), [green, setGreen] = useState(String(colorMask?.green ?? 0));
	const [blue, setBlue] = useState(String(colorMask?.blue ?? 0)), [radius, setRadius] = useState(String(colorMask?.radius ?? 0.1));
	const [colorFalloff, setColorFalloff] = useState(String(colorMask?.falloff ?? 0.1));
	const [visualPresetId, setVisualPresetId] = useAvailableAuthoringPreset(model.visualPresets);
	const [finishingPresetId, setFinishingPresetId] = useAvailableAuthoringPreset(model.finishingPresets);
	const [presetName, setPresetName] = useState(() => publishedCopyFor(props.copy ?? {})['ui.selectedVisualAuthoring.presetDefaultName'] || SELECTED_VISUAL_AUTHORING_COPY.presetDefaultName);
	const [freezeDuration, setFreezeDuration] = useState(24);
	const [pending, setPending] = useState(false);
	const [status, setStatus] = useState('');
	const [error, setError] = useState('');
	useEffect(() => {
		setShape(savedMask?.shape ?? 'rectangle');
		setMaskWidth(String(legacyMask?.width ?? 0.75));
		setMaskHeight(String(legacyMask?.height ?? 0.75));
		setStartX(String(gradientMask?.startX ?? 0)); setStartY(String(gradientMask?.startY ?? 0));
		setEndX(String(gradientMask?.endX ?? 1)); setEndY(String(gradientMask?.endY ?? 0));
		setCenterX(String(radialMask?.centerX ?? 0.5)); setCenterY(String(radialMask?.centerY ?? 0.5));
		setRadiusX(String(radialMask?.radiusX ?? 0.5)); setRadiusY(String(radialMask?.radiusY ?? 0.5)); setInnerFraction(String(radialMask?.innerFraction ?? 0));
		setLower(String(rangeMask?.lower ?? 0)); setUpper(String(rangeMask?.upper ?? 1)); setFalloff(String(rangeMask?.falloff ?? 0));
		setRed(String(colorMask?.red ?? 1)); setGreen(String(colorMask?.green ?? 0)); setBlue(String(colorMask?.blue ?? 0));
		setRadius(String(colorMask?.radius ?? 0.1)); setColorFalloff(String(colorMask?.falloff ?? 0.1));
	}, [maskId, savedMask?.shape, legacyMask?.width, legacyMask?.height, gradientMask?.startX, gradientMask?.startY, gradientMask?.endX, gradientMask?.endY,
		radialMask?.centerX, radialMask?.centerY, radialMask?.radiusX, radialMask?.radiusY, radialMask?.innerFraction, rangeMask?.lower, rangeMask?.upper, rangeMask?.falloff,
		colorMask?.red, colorMask?.green, colorMask?.blue, colorMask?.radius, colorMask?.falloff]);
	useEffect(() => {
		setPairId(model.selectedPairId ?? '');
		setDurationFrames(model.transitionPairs.find(({ id }) => id === model.selectedPairId)?.durationFrames ?? 12);
		setBrightness(String(model.adjustmentBrightness));
		setAdjustmentLayerId(model.adjustmentLayerId);
		setMaskId(model.selectedMaskId ?? '');
		// Keyed on what is actually reseeded, not on the model object: the model is
		// rebuilt whenever the playhead moves, and only the freeze surface reads the
		// playhead, so keying on the object discarded whatever the operator had
		// typed on the dissolve, adjustment and mask surfaces.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		model.surface, model.selectedClipId, model.selectedPairId,
		model.adjustmentBrightness, model.adjustmentLayerId, model.selectedMaskId,
	]);
	const runtime = framescaperSelectedVisualAuthoringRuntimeFor(props.controller as object);
	const blocked = pending || props.editingBlocked || props.readOnly || runtime === null;
	const perform = (operation: string): void => {
		if (blocked || !runtime) return;
		const request = requestFor(operation, model, {
			pairId, durationFrames, brightness, adjustmentLayerId,
			maskId, shape, maskWidth, maskHeight, startX, startY, endX, endY, centerX, centerY, radiusX, radiusY, innerFraction, lower, upper, falloff,
			red, green, blue, radius, colorFalloff,
			visualPresetId, finishingPresetId, presetName, freezeDuration,
		});
		setPending(true);
		setStatus('');
		setError('');
		void runAwaitedAudioEditorOperation(props.run, () => runtime.run(props.surface, request))
			.then(() => { setStatus(operation); })
			.catch((cause: unknown) => {
				setError(cause instanceof Error ? cause.message : String(cause));
			})
			.finally(() => { setPending(false); });
	};
	return <AudioEditorDialogShell
		title={model.title}
		onClose={props.onClose}
		width={660}
		initialFocus={initialFocus(props.surface)}
		dataAttributes={{ 'data-framescaper-selected-authoring': props.surface }}
	>
		<div className="audio-editor-clip-inspector">
			<p>{model.description}</p>
			<AuthoringFields
				text={text}
				surface={props.surface}
				model={model}
				frameRate={frameRate}
				blocked={blocked}
				values={{ pairId, durationFrames, brightness, adjustmentLayerId,
					maskId, shape, maskWidth, maskHeight, startX, startY, endX, endY, centerX, centerY, radiusX, radiusY, innerFraction, lower, upper, falloff, visualPresetId,
					red, green, blue, radius, colorFalloff,
					finishingPresetId, presetName, freezeDuration }}
				setters={{ setPairId, setDurationFrames, setBrightness,
					setMaskId, setShape, setMaskWidth, setMaskHeight, setStartX, setStartY, setEndX, setEndY,
					setCenterX, setCenterY, setRadiusX, setRadiusY, setInnerFraction,
					setLower, setUpper, setFalloff,
					setRed, setGreen, setBlue, setRadius, setColorFalloff,
					setVisualPresetId, setFinishingPresetId, setPresetName,
					setFreezeDuration }}
				onPerform={perform}
			/>
			<div role="status" aria-live="polite" aria-atomic="true">{error || (status ? successText(status, text) : '')}</div>
		</div>
	</AudioEditorDialogShell>;
}

type Model = ReturnType<typeof createFramescaperSelectedVisualAuthoringModel>;
interface Values {
	readonly pairId: string; readonly durationFrames: number; readonly brightness: string;
	readonly adjustmentLayerId: string | null; readonly maskId: string;
	readonly shape: 'rectangle' | 'ellipse' | 'line' | 'linear-gradient' | 'radial-gradient' | 'luminance-range' | 'color-range'; readonly maskWidth: string;
	readonly startX: string; readonly startY: string; readonly endX: string; readonly endY: string;
	readonly centerX: string; readonly centerY: string; readonly radiusX: string; readonly radiusY: string; readonly innerFraction: string;
	readonly lower: string; readonly upper: string; readonly falloff: string;
	readonly red: string; readonly green: string; readonly blue: string; readonly radius: string; readonly colorFalloff: string;
	readonly maskHeight: string; readonly visualPresetId: string;
	readonly finishingPresetId: string; readonly presetName: string; readonly freezeDuration: number;
}
interface Setters {
	readonly setPairId: (value: string) => void;
	readonly setDurationFrames: (value: number) => void;
	readonly setBrightness: (value: string) => void;
	readonly setMaskId: (value: string) => void;
	readonly setShape: (value: Values['shape']) => void;
	readonly setStartX: (value: string) => void; readonly setStartY: (value: string) => void;
	readonly setEndX: (value: string) => void; readonly setEndY: (value: string) => void;
	readonly setCenterX: (value: string) => void; readonly setCenterY: (value: string) => void;
	readonly setRadiusX: (value: string) => void; readonly setRadiusY: (value: string) => void; readonly setInnerFraction: (value: string) => void;
	readonly setLower: (value: string) => void; readonly setUpper: (value: string) => void; readonly setFalloff: (value: string) => void;
	readonly setRed: (value: string) => void; readonly setGreen: (value: string) => void; readonly setBlue: (value: string) => void;
	readonly setRadius: (value: string) => void; readonly setColorFalloff: (value: string) => void;
	readonly setMaskWidth: (value: string) => void;
	readonly setMaskHeight: (value: string) => void;
	readonly setVisualPresetId: (value: string) => void;
	readonly setFinishingPresetId: (value: string) => void;
	readonly setPresetName: (value: string) => void;
	readonly setFreezeDuration: (value: number) => void;
}

function AuthoringFields(props: Readonly<{
	readonly text: Readonly<{ [Key in keyof typeof SELECTED_VISUAL_AUTHORING_COPY]: string }>;
	readonly surface: FramescaperSelectedVisualAuthoringSurface;
	readonly model: Model; readonly blocked: boolean; readonly values: Values;
	readonly frameRate: number;
	readonly setters: Setters; readonly onPerform: (operation: string) => void;
}>) {
	if (props.surface === 'video-transition' || props.surface === 'video-transition-dissolve') {
		return <DissolveFields {...props} />;
	}
	if (props.surface === 'video-adjustment-layer') return <AdjustmentFields {...props} />;
	if (props.surface === 'video-mask-matte') return <MaskFields {...props} />;
	if (props.surface === 'video-visual-preset') return <PresetFields {...props} />;
	return <FreezeFields {...props} />;
}

function DissolveFields({ text, model, frameRate, blocked, values, setters, onPerform }: Parameters<typeof AuthoringFields>[0]) {
	const pair = selectedPair(model, values.pairId);
	return model.transitionPairs.length === 0 ? <p role="alert">
		{text.selectAdjacent}
	</p> : <fieldset disabled={blocked}>
		<legend>{text.exactPair}</legend>
		<label><span>{text.outgoingIncoming}</span>
			<select data-framescaper-authoring-pair value={values.pairId} onChange={(event) => {
				const pairId = event.currentTarget.value;
				setters.setPairId(pairId);
				setters.setDurationFrames(selectedPair(model, pairId)?.durationFrames ?? 1);
			}}>{model.transitionPairs.map((candidate) => <option key={candidate.id} value={candidate.id}>
				{candidate.label}{candidate.linkedAudio ? ` (${text.linkedAv})` : ''}
			</option>)}</select>
		</label>
		<label><span>{text.duration}</span><span data-framescaper-authoring-duration>
			<AudioEditorTimeCodeInput label={text.duration} value={values.durationFrames}
				unit="frames" rate={frameRate} minimum={1}
				maximum={pair?.maximumDurationFrames ?? 1} onChange={setters.setDurationFrames} />
		</span>
		</label>
		<div><button data-framescaper-authoring-apply type="button" onClick={() => onPerform('apply')}>{text.applyDissolve}</button>
			<button data-framescaper-authoring-remove type="button" disabled={!pair?.transitionId}
				onClick={() => onPerform('remove')}>{text.removeDissolve}</button></div>
	</fieldset>;
}

function AdjustmentFields({ text, model, blocked, values, setters, onPerform }: Parameters<typeof AuthoringFields>[0]) {
	if (model.selectedClipKind !== 'video') return <p role="alert">{text.selectVideo}</p>;
	return <fieldset disabled={blocked}>
		<legend>{text.selectedVideo}</legend>
		<label><span>{text.brightness}</span><input data-framescaper-authoring-brightness type="number"
			min="-1" max="1" step="0.05" value={values.brightness}
			onChange={(event) => setters.setBrightness(event.currentTarget.value)} /></label>
		<div><button data-framescaper-authoring-apply type="button" onClick={() => onPerform('apply')}>
			{values.adjustmentLayerId ? text.updateAdjustment : text.applyAdjustment}</button>
		<button data-framescaper-authoring-remove type="button" disabled={!values.adjustmentLayerId}
			onClick={() => onPerform('remove')}>{text.removeAdjustment}</button></div>
	</fieldset>;
}

function MaskFields({ text, model, blocked, values, setters, onPerform }: Parameters<typeof AuthoringFields>[0]) {
	if (!['video', 'still', 'generator'].includes(model.selectedClipKind ?? '')) {
		return <p role="alert">{text.selectVisual}</p>;
	}
	return <fieldset disabled={blocked}>
		<legend>{text.selectedAttachment}</legend>
		<label><span>{text.attachedMask}</span><select data-framescaper-authoring-mask value={values.maskId}
			onChange={(event) => setters.setMaskId(event.currentTarget.value)}>
			<option value="">{text.newMask}</option>
			{model.attachedMaskIds.map((id) => <option key={id} value={id}>{id}</option>)}
		</select></label>
		<label><span>{text.shape}</span><select data-framescaper-authoring-mask-shape value={values.shape}
			onChange={(event) => setters.setShape(event.currentTarget.value as Values['shape'])}>
			<option value="rectangle">{text.rectangle}</option><option value="ellipse">{text.ellipse}</option><option value="linear-gradient">{text.linearGradient}</option>
			<option value="radial-gradient">{text.radialGradient}</option>
			<option value="luminance-range">{text.luminanceRange}</option>
			<option value="color-range">{text.colorRange}</option>
		</select></label>
		{values.shape === 'color-range' ? <>
			<label><span>{text.red}</span><input data-framescaper-authoring-mask-red type="number" min={0} max={1} step="any" value={values.red}
				onChange={event => setters.setRed(event.currentTarget.value)} /></label>
			<label><span>{text.green}</span><input data-framescaper-authoring-mask-green type="number" min={0} max={1} step="any" value={values.green}
				onChange={event => setters.setGreen(event.currentTarget.value)} /></label>
			<label><span>{text.blue}</span><input data-framescaper-authoring-mask-blue type="number" min={0} max={1} step="any" value={values.blue}
				onChange={event => setters.setBlue(event.currentTarget.value)} /></label>
			<label><span>{text.radius}</span><input data-framescaper-authoring-mask-radius type="number" min={0} max={1} step="any" value={values.radius}
				onChange={event => setters.setRadius(event.currentTarget.value)} /></label>
			<label><span>{text.falloff}</span><input data-framescaper-authoring-mask-falloff type="number" min={0} max={1} step="any" value={values.colorFalloff}
				onChange={event => setters.setColorFalloff(event.currentTarget.value)} /></label>
		</> : values.shape === 'luminance-range' ? <>
			<label><span>{text.lower}</span><input data-framescaper-authoring-mask-lower type="number" min={0} max={1} step="any" value={values.lower}
				onChange={event => setters.setLower(event.currentTarget.value)} /></label>
			<label><span>{text.upper}</span><input data-framescaper-authoring-mask-upper type="number" min={0} max={1} step="any" value={values.upper}
				onChange={event => setters.setUpper(event.currentTarget.value)} /></label>
			<label><span>{text.falloff}</span><input data-framescaper-authoring-mask-falloff type="number" min={0} max={1} step="any" value={values.falloff}
				onChange={event => setters.setFalloff(event.currentTarget.value)} /></label>
		</> : values.shape === 'radial-gradient' ? <>
			<label><span>{text.centerX}</span><input data-framescaper-authoring-mask-center-x type="number" min={-1_000_000} max={1_000_000} step="any" value={values.centerX}
				onChange={event => setters.setCenterX(event.currentTarget.value)} /></label>
			<label><span>{text.centerY}</span><input data-framescaper-authoring-mask-center-y type="number" min={-1_000_000} max={1_000_000} step="any" value={values.centerY}
				onChange={event => setters.setCenterY(event.currentTarget.value)} /></label>
			<label><span>{text.radiusX}</span><input data-framescaper-authoring-mask-radius-x type="number" min={Number.MIN_VALUE} max={1_000_000} step="any" value={values.radiusX}
				onChange={event => setters.setRadiusX(event.currentTarget.value)} /></label>
			<label><span>{text.radiusY}</span><input data-framescaper-authoring-mask-radius-y type="number" min={Number.MIN_VALUE} max={1_000_000} step="any" value={values.radiusY}
				onChange={event => setters.setRadiusY(event.currentTarget.value)} /></label>
			<label><span>{text.innerFraction}</span><input data-framescaper-authoring-mask-inner-fraction type="number" min={0} max={1} step="any" value={values.innerFraction}
				onChange={event => setters.setInnerFraction(event.currentTarget.value)} /></label>
		</> : values.shape === 'linear-gradient' ? <>
			<label><span>{text.startX}</span><input data-framescaper-authoring-mask-start-x type="number" min={-1_000_000} max={1_000_000} step="any" value={values.startX}
				onChange={event => setters.setStartX(event.currentTarget.value)} /></label>
			<label><span>{text.startY}</span><input data-framescaper-authoring-mask-start-y type="number" min={-1_000_000} max={1_000_000} step="any" value={values.startY}
				onChange={event => setters.setStartY(event.currentTarget.value)} /></label>
			<label><span>{text.endX}</span><input data-framescaper-authoring-mask-end-x type="number" min={-1_000_000} max={1_000_000} step="any" value={values.endX}
				onChange={event => setters.setEndX(event.currentTarget.value)} /></label>
			<label><span>{text.endY}</span><input data-framescaper-authoring-mask-end-y type="number" min={-1_000_000} max={1_000_000} step="any" value={values.endY}
				onChange={event => setters.setEndY(event.currentTarget.value)} /></label>
		</> : <><label><span>{text.width}</span><input data-framescaper-authoring-mask-width type="number" min="0.01"
			max="1" step="0.01" value={values.maskWidth}
			onChange={(event) => setters.setMaskWidth(event.currentTarget.value)} /></label>
		<label><span>{text.height}</span><input data-framescaper-authoring-mask-height type="number" min="0.01"
			max="1" step="0.01" value={values.maskHeight}
			onChange={(event) => setters.setMaskHeight(event.currentTarget.value)} /></label></>}
		<div><button data-framescaper-authoring-apply type="button" onClick={() => onPerform('apply')}>
			{values.maskId ? text.updateMask : text.createMask}</button>
		<button data-framescaper-authoring-remove type="button" disabled={!values.maskId}
			onClick={() => onPerform('remove')}>{text.removeAttachment}</button></div>
	</fieldset>;
}

function PresetFields({ text, model, blocked, values, setters, onPerform }: Parameters<typeof AuthoringFields>[0]) {
	const generatorSelected = model.selectedClipKind === 'generator';
	return <>
		<fieldset disabled={blocked || !generatorSelected}>
			<legend>{text.visualPreset}</legend>
			<label><span>{text.presetName}</span><input data-framescaper-authoring-preset-name value={values.presetName}
				onChange={(event) => setters.setPresetName(event.currentTarget.value)} /></label>
			<button data-framescaper-authoring-save-visual type="button" onClick={() => onPerform('save-visual')}>
				{text.saveGenerator}</button>
			<label><span>{text.savedVisualPreset}</span><select data-framescaper-authoring-visual-preset
				value={values.visualPresetId} onChange={(event) => setters.setVisualPresetId(event.currentTarget.value)}>
				<option value="">{text.none}</option>{model.visualPresets.map(({ id, name }) => (
					<option key={id} value={id}>{name}</option>
				))}</select></label>
			<button data-framescaper-authoring-apply-visual type="button" disabled={!values.visualPresetId}
				onClick={() => onPerform('apply-visual')}>{text.applyGenerator}</button>
			<button data-framescaper-authoring-remove-visual type="button" disabled={!values.visualPresetId}
				onClick={() => onPerform('remove-visual')}>{text.removeVisualPreset}</button>
		</fieldset>
		<fieldset disabled={blocked || model.selectedClipId === null}>
			<legend>{text.finishingPreset}</legend>
			<label><span>{text.savedFinishingPreset}</span><select data-framescaper-authoring-finishing-preset
				value={values.finishingPresetId}
				onChange={(event) => setters.setFinishingPresetId(event.currentTarget.value)}>
				<option value="">{text.none}</option>{model.finishingPresets.map(({ id, name }) => (
					<option key={id} value={id}>{name}</option>
				))}</select></label>
			<button data-framescaper-authoring-apply-finishing type="button" disabled={!values.finishingPresetId}
				onClick={() => onPerform('apply-finishing')}>{text.applyFresh}</button>
			<button data-framescaper-authoring-remove-finishing type="button" disabled={!values.finishingPresetId}
				onClick={() => onPerform('remove-finishing')}>{text.removeFinishingPreset}</button>
		</fieldset>
	</>;
}

function FreezeFields({ text, model, frameRate, blocked, values, setters, onPerform }: Parameters<typeof AuthoringFields>[0]) {
	if (model.selectedClipKind !== 'video') return <p role="alert">{text.selectVideo}</p>;
	return <fieldset disabled={blocked}>
		<legend>{text.exactPlayhead}</legend>
		<p data-framescaper-authoring-freeze-playhead>{text.timelineSample} {model.fence.playheadSample}</p>
		<label><span>{text.freezeDuration}</span><span data-framescaper-authoring-freeze-duration>
			<AudioEditorTimeCodeInput label={text.freezeDuration} value={values.freezeDuration}
				unit="frames" rate={frameRate} minimum={1} maximum={10_000}
				onChange={setters.setFreezeDuration} />
		</span></label>
		<button data-framescaper-authoring-freeze type="button" onClick={() => onPerform('create')}>
			{text.captureFrame}</button>
	</fieldset>;
}

function requestFor(operation: string, model: Model, values: Values) {
	const base = { fence: model.fence, operation, clipId: model.selectedClipId ?? undefined };
	if (model.surface === 'video-transition' || model.surface === 'video-transition-dissolve') {
		return { ...base, pairId: values.pairId, durationFrames: values.durationFrames };
	}
	if (model.surface === 'video-adjustment-layer') return { ...base,
		adjustmentLayerId: values.adjustmentLayerId, brightness: numericDraft(values.brightness) };
	if (model.surface === 'video-mask-matte') {
		const mask = { ...base, maskId: values.maskId || null, shape: values.shape };
		if (values.shape === 'linear-gradient') return { ...mask, startX: numericDraft(values.startX), startY: numericDraft(values.startY), endX: numericDraft(values.endX), endY: numericDraft(values.endY) };
		if (values.shape === 'radial-gradient') return { ...mask, centerX: numericDraft(values.centerX), centerY: numericDraft(values.centerY), radiusX: numericDraft(values.radiusX),
			radiusY: numericDraft(values.radiusY), innerFraction: numericDraft(values.innerFraction) };
		if (values.shape === 'luminance-range') return { ...mask, lower: numericDraft(values.lower), upper: numericDraft(values.upper), falloff: numericDraft(values.falloff) };
		if (values.shape === 'color-range') return { ...mask, red: numericDraft(values.red), green: numericDraft(values.green), blue: numericDraft(values.blue),
			radius: numericDraft(values.radius), falloff: numericDraft(values.colorFalloff) };
		return { ...mask, width: numericDraft(values.maskWidth), height: numericDraft(values.maskHeight) };
	}
	if (model.surface === 'video-freeze') return { ...base,
		playheadSample: model.fence.playheadSample, durationFrames: values.freezeDuration };
	const finishing = operation === 'apply-finishing' || operation === 'remove-finishing';
	return { ...base, presetId: (finishing ? values.finishingPresetId : values.visualPresetId) || null,
		name: values.presetName };
}

function selectedPair(model: Model, pairId: string) {
	return model.transitionPairs.find(({ id }) => id === pairId) ?? null;
}

function numericDraft(value: string): number { return value.trim() ? Number(value) : NaN; }

function initialFocus(surface: FramescaperSelectedVisualAuthoringSurface): string {
	if (surface === 'video-adjustment-layer') return '[data-framescaper-authoring-brightness]';
	if (surface === 'video-mask-matte') return '[data-framescaper-authoring-mask]';
	if (surface === 'video-visual-preset') return '[data-framescaper-authoring-preset-name]';
	if (surface === 'video-freeze') return '[data-framescaper-authoring-freeze-duration]';
	return '[data-framescaper-authoring-pair]';
}

function successText(operation: string, text: Parameters<typeof AuthoringFields>[0]['text']): string {
	if (operation.startsWith('remove')) return text.removed;
	if (operation === 'save-visual') return text.presetSaved;
	if (operation === 'create') return text.freezeCreated;
	return text.applied;
}
