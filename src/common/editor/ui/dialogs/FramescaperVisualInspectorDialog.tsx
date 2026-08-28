/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { type FormEvent, useEffect, useMemo, useState } from 'react';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import {
	createFramescaperVisualInspectorCommand,
	createFramescaperVisualInspectorModel,
	type FramescaperVisualInspectorDraft,
} from '../framescaper-visual-inspector-model.ts';
import type { VideoGeneratorDocumentV1 } from '../../video-visual-model-v24.ts';

interface Props {
	readonly controller: Readonly<{ readonly actions: Readonly<{
		readonly edit: Readonly<{ commit(command: unknown): unknown }>;
	}> }>;
	readonly project: unknown;
	readonly selectedClipId?: unknown;
	readonly editingBlocked: boolean;
	readonly readOnly: boolean;
	readonly copy?: Readonly<Record<string, string>>;
	readonly run: (operation: () => unknown) => unknown;
	readonly onClose: () => void;
}

const BLEND_MODES = Object.freeze(['normal', 'multiply', 'screen', 'overlay', 'add'] as const);

export default function FramescaperVisualInspectorDialog({
	controller, project, selectedClipId, editingBlocked, readOnly, copy = {}, run, onClose,
}: Props) {
	const model = useMemo(() => createFramescaperVisualInspectorModel({
		project, selectedClipId,
	}), [project, selectedClipId]);
	const [draft, setDraft] = useState<FramescaperVisualInspectorDraft>(() => draftFor(model));
	const [pending, setPending] = useState(false);
	const [status, setStatus] = useState('');
	const [error, setError] = useState('');
	useEffect(() => {
		setDraft(draftFor(model));
		setStatus('');
		setError('');
	}, [model]);
	const blocked = pending || editingBlocked || readOnly || model.clipId === null;
	const updateGenerator = (changes: Readonly<Record<string, unknown>>): void => {
		setDraft((current) => current.generator === null ? current : {
			...current, presetId: null,
			generator: { ...current.generator, ...changes } as VideoGeneratorDocumentV1,
		});
		setError('');
	};
	const apply = (event: FormEvent): void => {
		event.preventDefault();
		if (blocked || model.clipId === null) return;
		let command: unknown;
		try {
			command = createFramescaperVisualInspectorCommand(project, model.clipId, draft);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
			return;
		}
		setPending(true);
		setError('');
		setStatus('');
		void Promise.resolve().then(() => run(() => controller.actions.edit.commit(command)))
			.then(() => { setStatus(label(copy, 'visualInspectorApplied', 'Selected visual updated.')); })
			.catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)); })
			.finally(() => { setPending(false); });
	};
	return <AudioEditorDialogShell
		title={label(copy, 'videoVisualInspector', 'Selected Visual Inspector')}
		onClose={onClose}
		width={680}
		initialFocus="[data-visual-inspector-opacity]"
		dataAttributes={{ 'data-framescaper-visual-inspector': 'true' }}
	>
		<form className="audio-editor-clip-inspector" onSubmit={apply}>
			<p>{label(copy, 'visualInspectorDescription',
				'Edit exact built-in generator and presentation state for the selected timeline visual.')}</p>
			{model.clipId === null ? <p role="status">{label(copy, 'visualInspectorSelection',
				'Select one still, title, text, shape, or solid clip first.')}</p> : <>
				<p data-visual-inspector-kind>{model.kind}</p>
					<GeneratorFields generator={draft.generator} disabled={blocked} copy={copy}
						onChange={updateGenerator} />
				{model.presets.length > 0 && <label>
					<span>{label(copy, 'visualPreset', 'Visual preset')}</span>
					<select data-visual-inspector-preset value={draft.presetId ?? ''} disabled={blocked}
						onChange={(event) => {
							const selectedId = event.currentTarget.value;
							const preset = model.presets.find(({ id }) => id === selectedId);
							setDraft((current) => ({ ...current,
								presetId: preset?.id ?? null,
								generator: preset?.generator ?? current.generator,
							}));
						}}>
						<option value="">{label(copy, 'none', 'None')}</option>
						{model.presets.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
					</select>
				</label>}
				<label>
					<span>{label(copy, 'opacity', 'Opacity')}</span>
					<input data-visual-inspector-opacity type="number" min="0" max="1" step="0.01"
						value={draft.opacity} disabled={blocked}
						onChange={(event) => {
							const opacity = event.currentTarget.valueAsNumber;
							setDraft((current) => ({ ...current, opacity }));
						}} />
				</label>
				<label>
					<span>{label(copy, 'blendMode', 'Blend mode')}</span>
					<select data-visual-inspector-blend value={draft.blendMode} disabled={blocked}
						onChange={(event) => {
							const blendMode = event.currentTarget.value as
								FramescaperVisualInspectorDraft['blendMode'];
							setDraft((current) => ({ ...current, blendMode }));
						}}>
						{BLEND_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
					</select>
				</label>
				{model.masks.length > 0 && <fieldset disabled={blocked}>
					<legend>{label(copy, 'maskMatte', 'Mask / matte')}</legend>
					<label><span>{label(copy, 'maskMatte', 'Mask / matte')}</span>
						<select data-visual-inspector-mask value={draft.maskId ?? ''}
							onChange={(event) => {
								const maskId = event.currentTarget.value || null;
								setDraft((current) => ({ ...current, maskId }));
							}}>
							<option value="">{label(copy, 'none', 'None')}</option>
							{model.masks.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
						</select>
					</label>
					<label><span>{label(copy, 'maskWidth', 'Mask width')}</span>
						<input data-visual-inspector-mask-width type="range" min="0.01" max="1" step="0.01"
							value={draft.maskWidth} disabled={draft.maskId === null}
							onChange={(event) => {
								const maskWidth = event.currentTarget.valueAsNumber;
								setDraft((current) => ({ ...current, maskWidth }));
							}} />
					</label>
				</fieldset>}
				<button type="submit" data-visual-inspector-apply disabled={blocked}>{
					label(copy, 'apply', 'Apply')
				}</button>
			</>}
			<div role="status" aria-live="polite" aria-atomic="true">{error || status}</div>
		</form>
	</AudioEditorDialogShell>;
}

function GeneratorFields(props: Readonly<{
		readonly generator: VideoGeneratorDocumentV1 | null;
		readonly disabled: boolean;
		readonly copy: Readonly<Record<string, string>>;
		readonly onChange: (changes: Readonly<Record<string, unknown>>) => void;
	}>) {
		const generator = props.generator;
		if (generator === null) return null;
		if (generator.kind === 'title' || generator.kind === 'text') return <fieldset disabled={props.disabled}>
			<legend>{generator.kind === 'title'
				? label(props.copy, 'title', 'Title') : label(props.copy, 'text', 'Text')}</legend>
			<label><span>{label(props.copy, 'text', 'Text')}</span><textarea data-visual-inspector-text rows={3} maxLength={16_384}
				value={generator.text} onChange={(event) => props.onChange({ text: event.currentTarget.value })} /></label>
			<label><span>{label(props.copy, 'rgbaColor', 'RGBA color')}</span><input data-visual-inspector-color value={generator.color}
				pattern="#[0-9a-f]{8}" onChange={(event) => props.onChange({ color: event.currentTarget.value })} /></label>
			<label><span>{label(props.copy, 'fontSize', 'Font size')}</span><input data-visual-inspector-font-size type="number" min="1" max="4096"
				value={generator.fontSize} onChange={(event) => props.onChange({ fontSize: event.currentTarget.valueAsNumber })} /></label>
		</fieldset>;
		if (generator.kind === 'solid') return <label><span>{label(props.copy, 'rgbaColor', 'RGBA color')}</span>
			<input data-visual-inspector-color value={generator.color} pattern="#[0-9a-f]{8}"
				disabled={props.disabled} onChange={(event) => props.onChange({ color: event.currentTarget.value })} />
		</label>;
		if (generator.kind === 'shape') return <label><span>{label(props.copy, 'fillRgbaColor', 'Fill RGBA color')}</span>
			<input data-visual-inspector-color value={generator.fillColor ?? '#00000000'} pattern="#[0-9a-f]{8}"
				disabled={props.disabled} onChange={(event) => props.onChange({ fillColor: event.currentTarget.value })} />
		</label>;
		return <p role="alert">{label(props.copy, 'externalGeneratorUnavailable',
			'External generators are unavailable in the current Framescaper project.')}</p>;
}

function draftFor(model: ReturnType<typeof createFramescaperVisualInspectorModel>): FramescaperVisualInspectorDraft {
	return {
		generator: model.generator,
		opacity: model.opacity,
		blendMode: model.blendMode,
		maskId: model.maskId,
		maskWidth: model.maskWidth,
		presetId: null,
	};
}

function label(copy: Readonly<Record<string, string>>, key: string, fallback: string): string {
	return copy[key] || fallback;
}
