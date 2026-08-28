/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useEffect, useMemo, useState } from 'react';

import {
	framescaperSelectedVisualAuthoringRuntimeFor,
	type FramescaperSelectedAuthoringController,
} from '../../../../framescaper/editor-selected-finishing-authoring-controller.ts';
import {
	createFramescaperSelectedVisualAuthoringModel,
	type FramescaperSelectedVisualAuthoringSurface,
} from '../../../../framescaper/editor-selected-finishing-visual-authoring-model.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

const TEXT = Object.freeze({
	selectAdjacent: 'Select one clip from an unlocked video track containing an adjacent pair.',
	exactPair: 'Exact adjacent pair', outgoingIncoming: 'Outgoing → incoming', linkedAv: ' (linked A/V)',
	duration: 'Duration (sequence frames)', applyDissolve: 'Apply dissolve', removeDissolve: 'Remove dissolve',
	selectVideo: 'Select one timeline video clip first.', selectedVideo: 'Selected video occurrence',
	brightness: 'Brightness', updateAdjustment: 'Update adjustment', applyAdjustment: 'Apply adjustment',
	removeAdjustment: 'Remove adjustment', selectVisual: 'Select one timeline visual clip first.',
	selectedAttachment: 'Selected presentation attachment', attachedMask: 'Attached mask', newMask: 'New mask',
	shape: 'Shape', rectangle: 'Rectangle', ellipse: 'Ellipse', line: 'Line', width: 'Width', height: 'Height',
	updateMask: 'Update attached mask', createMask: 'Create and attach mask', removeAttachment: 'Remove attachment',
	visualPreset: 'Visual preset', presetName: 'Preset name', saveGenerator: 'Save selected generator preset',
	savedVisualPreset: 'Saved visual preset', none: 'None', applyGenerator: 'Apply to selected generator',
	removeVisualPreset: 'Remove visual preset', finishingPreset: 'Finishing preset',
	savedFinishingPreset: 'Saved finishing preset', applyFresh: 'Apply as fresh presentation',
	removeFinishingPreset: 'Remove finishing preset', exactPlayhead: 'Exact playhead picture',
	timelineSample: 'Timeline sample', freezeDuration: 'Freeze duration (sequence frames)',
	captureFrame: 'Capture authenticated rendered frame', removed: 'Selected authored state removed.',
	presetSaved: 'Selected visual preset saved.', freezeCreated: 'Exact playhead freeze created.',
	applied: 'Selected authored state applied.',
});

interface Props {
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
	const model = useMemo(() => createFramescaperSelectedVisualAuthoringModel({
		surface: props.surface, project: props.project,
		selectedClipId: props.selectedClipId, playheadSample: props.playheadSample,
	}), [props.playheadSample, props.project, props.selectedClipId, props.surface]);
	const [pairId, setPairId] = useState(model.selectedPairId ?? '');
	const [durationFrames, setDurationFrames] = useState(() => selectedPair(model, pairId)?.durationFrames ?? 12);
	const [brightness, setBrightness] = useState(model.adjustmentBrightness);
	const [adjustmentLayerId, setAdjustmentLayerId] = useState(model.adjustmentLayerId);
	const [maskId, setMaskId] = useState(model.selectedMaskId ?? '');
	const [shape, setShape] = useState<'rectangle' | 'ellipse' | 'line'>('rectangle');
	const [maskWidth, setMaskWidth] = useState(0.75);
	const [maskHeight, setMaskHeight] = useState(0.75);
	const [visualPresetId, setVisualPresetId] = useState(model.visualPresets[0]?.id ?? '');
	const [finishingPresetId, setFinishingPresetId] = useState(model.finishingPresets[0]?.id ?? '');
	const [presetName, setPresetName] = useState('Selected Visual Preset');
	const [freezeDuration, setFreezeDuration] = useState(24);
	const [pending, setPending] = useState(false);
	const [status, setStatus] = useState('');
	const [error, setError] = useState('');
	useEffect(() => {
		setPairId(model.selectedPairId ?? '');
		setDurationFrames(model.transitionPairs.find(({ id }) => id === model.selectedPairId)?.durationFrames ?? 12);
		setBrightness(model.adjustmentBrightness);
		setAdjustmentLayerId(model.adjustmentLayerId);
		setMaskId(model.selectedMaskId ?? '');
		setVisualPresetId((current) => model.visualPresets.some(({ id }) => id === current)
			? current : model.visualPresets[0]?.id ?? '');
		setFinishingPresetId((current) => model.finishingPresets.some(({ id }) => id === current)
			? current : model.finishingPresets[0]?.id ?? '');
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
			maskId, shape, maskWidth, maskHeight,
			visualPresetId, finishingPresetId, presetName, freezeDuration,
		});
		setPending(true);
		setStatus('');
		setError('');
		void Promise.resolve(props.run(() => runtime.run(props.surface, request)))
			.then(() => { setStatus(successText(operation)); })
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
				surface={props.surface}
				model={model}
				blocked={blocked}
				values={{ pairId, durationFrames, brightness, adjustmentLayerId,
					maskId, shape, maskWidth, maskHeight, visualPresetId,
					finishingPresetId, presetName, freezeDuration }}
				setters={{ setPairId, setDurationFrames, setBrightness,
					setMaskId, setShape, setMaskWidth, setMaskHeight,
					setVisualPresetId, setFinishingPresetId, setPresetName,
					setFreezeDuration }}
				onPerform={perform}
			/>
			<div role="status" aria-live="polite" aria-atomic="true">{error || status}</div>
		</div>
	</AudioEditorDialogShell>;
}

type Model = ReturnType<typeof createFramescaperSelectedVisualAuthoringModel>;
interface Values {
	readonly pairId: string; readonly durationFrames: number; readonly brightness: number;
	readonly adjustmentLayerId: string | null; readonly maskId: string;
	readonly shape: 'rectangle' | 'ellipse' | 'line'; readonly maskWidth: number;
	readonly maskHeight: number; readonly visualPresetId: string;
	readonly finishingPresetId: string; readonly presetName: string; readonly freezeDuration: number;
}
interface Setters {
	readonly setPairId: (value: string) => void;
	readonly setDurationFrames: (value: number) => void;
	readonly setBrightness: (value: number) => void;
	readonly setMaskId: (value: string) => void;
	readonly setShape: (value: 'rectangle' | 'ellipse' | 'line') => void;
	readonly setMaskWidth: (value: number) => void;
	readonly setMaskHeight: (value: number) => void;
	readonly setVisualPresetId: (value: string) => void;
	readonly setFinishingPresetId: (value: string) => void;
	readonly setPresetName: (value: string) => void;
	readonly setFreezeDuration: (value: number) => void;
}

function AuthoringFields(props: Readonly<{
	readonly surface: FramescaperSelectedVisualAuthoringSurface;
	readonly model: Model; readonly blocked: boolean; readonly values: Values;
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

function DissolveFields({ model, blocked, values, setters, onPerform }: Parameters<typeof AuthoringFields>[0]) {
	const pair = selectedPair(model, values.pairId);
	return model.transitionPairs.length === 0 ? <p role="alert">
		{TEXT.selectAdjacent}
	</p> : <fieldset disabled={blocked}>
		<legend>{TEXT.exactPair}</legend>
		<label><span>{TEXT.outgoingIncoming}</span>
			<select data-framescaper-authoring-pair value={values.pairId} onChange={(event) => {
				const pairId = event.currentTarget.value;
				setters.setPairId(pairId);
				setters.setDurationFrames(selectedPair(model, pairId)?.durationFrames ?? 1);
			}}>{model.transitionPairs.map((candidate) => <option key={candidate.id} value={candidate.id}>
				{candidate.label}{candidate.linkedAudio ? TEXT.linkedAv : ''}
			</option>)}</select>
		</label>
		<label><span>{TEXT.duration}</span>
			<input data-framescaper-authoring-duration type="number" min="1"
				max={pair?.maximumDurationFrames ?? 1} step="1" value={values.durationFrames}
				onChange={(event) => setters.setDurationFrames(event.currentTarget.valueAsNumber)} />
		</label>
		<div><button data-framescaper-authoring-apply type="button" onClick={() => onPerform('apply')}>{TEXT.applyDissolve}</button>
			<button data-framescaper-authoring-remove type="button" disabled={!pair?.transitionId}
				onClick={() => onPerform('remove')}>{TEXT.removeDissolve}</button></div>
	</fieldset>;
}

function AdjustmentFields({ model, blocked, values, setters, onPerform }: Parameters<typeof AuthoringFields>[0]) {
	if (model.selectedClipKind !== 'video') return <p role="alert">{TEXT.selectVideo}</p>;
	return <fieldset disabled={blocked}>
		<legend>{TEXT.selectedVideo}</legend>
		<label><span>{TEXT.brightness}</span><input data-framescaper-authoring-brightness type="number"
			min="-1" max="1" step="0.05" value={values.brightness}
			onChange={(event) => setters.setBrightness(event.currentTarget.valueAsNumber)} /></label>
		<div><button data-framescaper-authoring-apply type="button" onClick={() => onPerform('apply')}>
			{values.adjustmentLayerId ? 'Update adjustment' : 'Apply adjustment'}</button>
		<button data-framescaper-authoring-remove type="button" disabled={!values.adjustmentLayerId}
			onClick={() => onPerform('remove')}>{TEXT.removeAdjustment}</button></div>
	</fieldset>;
}

function MaskFields({ model, blocked, values, setters, onPerform }: Parameters<typeof AuthoringFields>[0]) {
	if (!['video', 'still', 'generator'].includes(model.selectedClipKind ?? '')) {
		return <p role="alert">{TEXT.selectVisual}</p>;
	}
	return <fieldset disabled={blocked}>
		<legend>{TEXT.selectedAttachment}</legend>
		<label><span>{TEXT.attachedMask}</span><select data-framescaper-authoring-mask value={values.maskId}
			onChange={(event) => setters.setMaskId(event.currentTarget.value)}>
			<option value="">{TEXT.newMask}</option>
			{model.attachedMaskIds.map((id) => <option key={id} value={id}>{id}</option>)}
		</select></label>
		<label><span>{TEXT.shape}</span><select data-framescaper-authoring-mask-shape value={values.shape}
			onChange={(event) => setters.setShape(event.currentTarget.value as Values['shape'])}>
			<option value="rectangle">{TEXT.rectangle}</option><option value="ellipse">{TEXT.ellipse}</option>
			<option value="line">{TEXT.line}</option>
		</select></label>
		<label><span>{TEXT.width}</span><input data-framescaper-authoring-mask-width type="number" min="0.01"
			max="1" step="0.01" value={values.maskWidth}
			onChange={(event) => setters.setMaskWidth(event.currentTarget.valueAsNumber)} /></label>
		<label><span>{TEXT.height}</span><input data-framescaper-authoring-mask-height type="number" min="0.01"
			max="1" step="0.01" value={values.maskHeight}
			onChange={(event) => setters.setMaskHeight(event.currentTarget.valueAsNumber)} /></label>
		<div><button data-framescaper-authoring-apply type="button" onClick={() => onPerform('apply')}>
			{values.maskId ? TEXT.updateMask : TEXT.createMask}</button>
		<button data-framescaper-authoring-remove type="button" disabled={!values.maskId}
			onClick={() => onPerform('remove')}>{TEXT.removeAttachment}</button></div>
	</fieldset>;
}

function PresetFields({ model, blocked, values, setters, onPerform }: Parameters<typeof AuthoringFields>[0]) {
	const generatorSelected = model.selectedClipKind === 'generator';
	return <>
		<fieldset disabled={blocked || !generatorSelected}>
			<legend>{TEXT.visualPreset}</legend>
			<label><span>{TEXT.presetName}</span><input data-framescaper-authoring-preset-name value={values.presetName}
				onChange={(event) => setters.setPresetName(event.currentTarget.value)} /></label>
			<button data-framescaper-authoring-save-visual type="button" onClick={() => onPerform('save-visual')}>
				{TEXT.saveGenerator}</button>
			<label><span>{TEXT.savedVisualPreset}</span><select data-framescaper-authoring-visual-preset
				value={values.visualPresetId} onChange={(event) => setters.setVisualPresetId(event.currentTarget.value)}>
				<option value="">{TEXT.none}</option>{model.visualPresets.map(({ id, name }) => (
					<option key={id} value={id}>{name}</option>
				))}</select></label>
			<button data-framescaper-authoring-apply-visual type="button" disabled={!values.visualPresetId}
				onClick={() => onPerform('apply-visual')}>{TEXT.applyGenerator}</button>
			<button data-framescaper-authoring-remove-visual type="button" disabled={!values.visualPresetId}
				onClick={() => onPerform('remove-visual')}>{TEXT.removeVisualPreset}</button>
		</fieldset>
		<fieldset disabled={blocked || model.selectedClipId === null}>
			<legend>{TEXT.finishingPreset}</legend>
			<label><span>{TEXT.savedFinishingPreset}</span><select data-framescaper-authoring-finishing-preset
				value={values.finishingPresetId}
				onChange={(event) => setters.setFinishingPresetId(event.currentTarget.value)}>
				<option value="">{TEXT.none}</option>{model.finishingPresets.map(({ id, name }) => (
					<option key={id} value={id}>{name}</option>
				))}</select></label>
			<button data-framescaper-authoring-apply-finishing type="button" disabled={!values.finishingPresetId}
				onClick={() => onPerform('apply-finishing')}>{TEXT.applyFresh}</button>
			<button data-framescaper-authoring-remove-finishing type="button" disabled={!values.finishingPresetId}
				onClick={() => onPerform('remove-finishing')}>{TEXT.removeFinishingPreset}</button>
		</fieldset>
	</>;
}

function FreezeFields({ model, blocked, values, setters, onPerform }: Parameters<typeof AuthoringFields>[0]) {
	if (model.selectedClipKind !== 'video') return <p role="alert">{TEXT.selectVideo}</p>;
	return <fieldset disabled={blocked}>
		<legend>{TEXT.exactPlayhead}</legend>
		<p data-framescaper-authoring-freeze-playhead>{TEXT.timelineSample} {model.fence.playheadSample}</p>
		<label><span>{TEXT.freezeDuration}</span>
			<input data-framescaper-authoring-freeze-duration type="number" min="1" max="10000" step="1"
				value={values.freezeDuration}
				onChange={(event) => setters.setFreezeDuration(event.currentTarget.valueAsNumber)} /></label>
		<button data-framescaper-authoring-freeze type="button" onClick={() => onPerform('create')}>
			{TEXT.captureFrame}</button>
	</fieldset>;
}

function requestFor(operation: string, model: Model, values: Values) {
	const base = { fence: model.fence, operation, clipId: model.selectedClipId ?? undefined };
	if (model.surface === 'video-transition' || model.surface === 'video-transition-dissolve') {
		return { ...base, pairId: values.pairId, durationFrames: values.durationFrames };
	}
	if (model.surface === 'video-adjustment-layer') return { ...base,
		adjustmentLayerId: values.adjustmentLayerId, brightness: values.brightness };
	if (model.surface === 'video-mask-matte') return { ...base,
		maskId: values.maskId || null, shape: values.shape,
		width: values.maskWidth, height: values.maskHeight };
	if (model.surface === 'video-freeze') return { ...base,
		playheadSample: model.fence.playheadSample, durationFrames: values.freezeDuration };
	const finishing = operation === 'apply-finishing' || operation === 'remove-finishing';
	return { ...base, presetId: (finishing ? values.finishingPresetId : values.visualPresetId) || null,
		name: values.presetName };
}

function selectedPair(model: Model, pairId: string) {
	return model.transitionPairs.find(({ id }) => id === pairId) ?? null;
}

function initialFocus(surface: FramescaperSelectedVisualAuthoringSurface): string {
	if (surface === 'video-adjustment-layer') return '[data-framescaper-authoring-brightness]';
	if (surface === 'video-mask-matte') return '[data-framescaper-authoring-mask]';
	if (surface === 'video-visual-preset') return '[data-framescaper-authoring-preset-name]';
	if (surface === 'video-freeze') return '[data-framescaper-authoring-freeze-duration]';
	return '[data-framescaper-authoring-pair]';
}

function successText(operation: string): string {
	if (operation.startsWith('remove')) return TEXT.removed;
	if (operation === 'save-visual') return TEXT.presetSaved;
	if (operation === 'create') return TEXT.freezeCreated;
	return TEXT.applied;
}
