/* SPDX-License-Identifier: AGPL-3.0-only */

import React, {
	type FormEvent,
	useEffect,
	useMemo,
	useState,
} from 'react';

import {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
	VIDEO_CLIP_COMPOSITION_BLEND_MODES,
	videoClipCompositionsEqual,
} from '../../video-clip-composition.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import {
	createVideoCompositionDialogModel,
	createVideoCompositionDraft,
	createVideoCompositionCommitCommand,
	parseVideoCompositionDraft,
	type VideoCompositionBatchCommand,
	type VideoCompositionDraft,
	type VideoCompositionSetCommand,
} from '../video-composition-dialog-model.ts';

interface VideoCompositionDialogProps {
	readonly productId: string;
	readonly capability: boolean;
	readonly controller: Readonly<{
		readonly actions: Readonly<{
			readonly edit: Readonly<{
				commit(command: VideoCompositionSetCommand | VideoCompositionBatchCommand): unknown;
			}>;
		}>;
	}>;
	readonly snapshot: Readonly<Record<string, unknown>> & {
		readonly project?: unknown;
		readonly selectedClipId?: unknown;
	};
	readonly copy: Readonly<Record<string, string>>;
	readonly run: (operation: () => unknown) => unknown;
	readonly onClose: () => void;
}

type TextDraftKey = Exclude<keyof VideoCompositionDraft,
	'flipHorizontal' | 'flipVertical' | 'blendMode'>;

export default function VideoCompositionDialog({
	productId,
	capability,
	controller,
	snapshot,
	copy,
	run,
	onClose,
}: VideoCompositionDialogProps) {
	const model = useMemo(() => createVideoCompositionDialogModel({
		productId, capability, project: snapshot.project, snapshot,
	}), [capability, productId, snapshot]);
	const [draft, setDraft] = useState<Readonly<VideoCompositionDraft>>(() => (
		createVideoCompositionDraft(model.composition ?? DEFAULT_VIDEO_CLIP_COMPOSITION)
	));
	const [pending, setPending] = useState(false);
	const [status, setStatus] = useState('');
	const [error, setError] = useState('');

	useEffect(() => {
		setDraft(createVideoCompositionDraft(model.composition ?? DEFAULT_VIDEO_CLIP_COMPOSITION));
		setStatus('');
		setError('');
	}, [model.clipId, model.composition]);

	const disabled = model.operationsBlocked || pending;
	const descriptionId = 'video-composition-description';
	const title = label(copy, 'videoCompositionTitle', 'Transform and compositing');
	const blockMessage = model.blockReason === 'read-only'
		? label(copy, 'videoCompositionReadOnly', 'This project is read-only.')
		: model.blockReason === 'locked'
			? label(copy, 'videoCompositionLocked', 'Unlock the video track to edit its composition.')
			: model.blockReason === 'busy'
				? label(copy, 'videoCompositionBusy', 'Composition editing is unavailable while another operation is running.')
				: model.blockReason === 'unsupported'
					? label(copy, 'videoCompositionUnsupported', 'Video composition is unavailable for this project.')
					: model.blockReason === 'no-video-clip'
						? label(copy, 'videoCompositionNoSelection', 'Select exactly one timeline video clip.')
						: '';

	const updateText = (key: TextDraftKey, value: string): void => {
		setDraft((current) => ({ ...current, [key]: value }));
		setError('');
	};
	const commit = (composition: unknown, success: string): void => {
		if (!model.clipId || !model.composition || disabled) return;
		try {
			if (videoClipCompositionsEqual(model.composition, composition)) return;
			const command = createVideoCompositionCommitCommand(
				snapshot.project, model.clipId, model.composition, composition,
			);
			setPending(true);
			setError('');
			void Promise.resolve()
				.then(() => run(() => controller.actions.edit.commit(command)))
				.then(() => { setStatus(success); })
				.catch(() => {
					setError(label(copy, 'videoCompositionApplyFailed', 'The composition could not be applied. Refresh the project and try again.'));
				})
				.finally(() => { setPending(false); });
		} catch {
			setError(label(copy, 'videoCompositionApplyFailed', 'The composition could not be applied. Refresh the project and try again.'));
		}
	};
	const applyDraft = (): void => {
		try {
			commit(
				parseVideoCompositionDraft(draft),
				label(copy, 'videoCompositionApplied', 'Composition applied.'),
			);
		} catch {
			setError(label(copy, 'videoCompositionInvalid', 'Check that every composition value is within its displayed range.'));
		}
	};
	const apply = (event: FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		applyDraft();
	};
	const reset = (): void => {
		commit(
			DEFAULT_VIDEO_CLIP_COMPOSITION,
			label(copy, 'videoCompositionResetStatus', 'Composition reset.'),
		);
	};

	return <AudioEditorDialogShell
		title={title}
		onClose={onClose}
		width={760}
		initialFocus={'[data-video-composition-field="crop-left"]'}
		ariaDescribedBy={descriptionId}
		dataAttributes={{ 'data-video-composition-dialog': 'true' }}
	>
		<form className="audio-editor-clip-inspector" onSubmit={apply} onBlur={(event) => {
			if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
				applyDraft();
			}
		}}>
			<p id={descriptionId}>{label(
				copy,
				'videoCompositionDescription',
				'Adjust the selected video clip. Percentages are measured against its display aperture or the sequence canvas.',
			)}</p>
			{model.clipId && <h3>{model.clipName}</h3>}
			{blockMessage && <p role="status">{blockMessage}</p>}
			{model.composition && <div className="audio-editor-clip-properties" aria-disabled={disabled}>
				<fieldset className="audio-editor-clip-properties__card" disabled={disabled}>
					<legend>{label(copy, 'videoCompositionCrop', 'Crop')}</legend>
					<div className="audio-editor-field-grid">
						<NumberField field="crop-left" label={label(copy, 'videoCompositionCropLeft', 'Left (%)')} value={draft.cropLeftPercent} minimum={0} maximum={100} onChange={(value) => updateText('cropLeftPercent', value)} />
						<NumberField field="crop-top" label={label(copy, 'videoCompositionCropTop', 'Top (%)')} value={draft.cropTopPercent} minimum={0} maximum={100} onChange={(value) => updateText('cropTopPercent', value)} />
						<NumberField field="crop-right" label={label(copy, 'videoCompositionCropRight', 'Right (%)')} value={draft.cropRightPercent} minimum={0} maximum={100} onChange={(value) => updateText('cropRightPercent', value)} />
						<NumberField field="crop-bottom" label={label(copy, 'videoCompositionCropBottom', 'Bottom (%)')} value={draft.cropBottomPercent} minimum={0} maximum={100} onChange={(value) => updateText('cropBottomPercent', value)} />
					</div>
				</fieldset>
				<fieldset className="audio-editor-clip-properties__card" disabled={disabled}>
					<legend>{label(copy, 'videoCompositionTransform', 'Transform')}</legend>
					<div className="audio-editor-field-grid">
						<NumberField field="anchor-x" label={label(copy, 'videoCompositionAnchorX', 'Anchor X (%)')} value={draft.anchorXPercent} minimum={0} maximum={100} onChange={(value) => updateText('anchorXPercent', value)} />
						<NumberField field="anchor-y" label={label(copy, 'videoCompositionAnchorY', 'Anchor Y (%)')} value={draft.anchorYPercent} minimum={0} maximum={100} onChange={(value) => updateText('anchorYPercent', value)} />
						<NumberField field="position-x" label={label(copy, 'videoCompositionPositionX', 'Position X offset (%)')} value={draft.positionXPercent} minimum={-850} maximum={750} onChange={(value) => updateText('positionXPercent', value)} />
						<NumberField field="position-y" label={label(copy, 'videoCompositionPositionY', 'Position Y offset (%)')} value={draft.positionYPercent} minimum={-850} maximum={750} onChange={(value) => updateText('positionYPercent', value)} />
						<NumberField field="scale-x" label={label(copy, 'videoCompositionScaleX', 'Scale X (%)')} value={draft.scaleXPercent} minimum={1} maximum={10_000} onChange={(value) => updateText('scaleXPercent', value)} />
						<NumberField field="scale-y" label={label(copy, 'videoCompositionScaleY', 'Scale Y (%)')} value={draft.scaleYPercent} minimum={1} maximum={10_000} onChange={(value) => updateText('scaleYPercent', value)} />
						<NumberField field="rotation" label={label(copy, 'videoCompositionRotation', 'Rotation (degrees)')} value={draft.rotationDegrees} minimum={-36_000} maximum={36_000} onChange={(value) => updateText('rotationDegrees', value)} />
						<CheckField field="flip-horizontal" label={label(copy, 'videoCompositionFlipHorizontal', 'Flip horizontally')} checked={draft.flipHorizontal} onChange={(checked) => setDraft((current) => ({ ...current, flipHorizontal: checked }))} />
						<CheckField field="flip-vertical" label={label(copy, 'videoCompositionFlipVertical', 'Flip vertically')} checked={draft.flipVertical} onChange={(checked) => setDraft((current) => ({ ...current, flipVertical: checked }))} />
					</div>
				</fieldset>
				<fieldset className="audio-editor-clip-properties__card audio-editor-clip-properties__card--wide" disabled={disabled}>
					<legend>{label(copy, 'videoCompositionCompositing', 'Compositing')}</legend>
					<div className="audio-editor-field-grid">
						<NumberField field="opacity" label={label(copy, 'videoCompositionOpacity', 'Opacity (%)')} value={draft.opacityPercent} minimum={0} maximum={100} onChange={(value) => updateText('opacityPercent', value)} />
						<label className="audio-editor-field">
							<span>{label(copy, 'videoCompositionBlendMode', 'Blend mode')}</span>
							<select data-video-composition-field="blend-mode" value={draft.blendMode} onChange={(event) => {
								const blendMode = event.currentTarget.value;
								setDraft((current) => ({ ...current, blendMode }));
							}}>
				{VIDEO_CLIP_COMPOSITION_BLEND_MODES.map((mode) => <option key={mode} value={mode}>{label(
					copy,
					`videoCompositionBlend${mode[0]?.toUpperCase() ?? ''}${mode.slice(1)}`,
					mode,
				)}</option>)}
							</select>
						</label>
						<NumberField field="compositing-order" label={label(copy, 'videoCompositionOrder', 'Layer order')} value={draft.compositingOrder} minimum={-32_768} maximum={32_767} step="1" onChange={(value) => updateText('compositingOrder', value)} />
					</div>
				</fieldset>
			</div>}
			<fieldset disabled={disabled}>
				<legend>{label(copy, 'videoCompositionActions', 'Composition actions')}</legend>
				<button type="button" onClick={reset}>{label(copy, 'videoCompositionReset', 'Reset')}</button>
				<button type="submit">{label(copy, 'videoCompositionApply', 'Apply')}</button>
			</fieldset>
			<div role="status" aria-live="polite" aria-atomic="true">{error || status}</div>
			{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
		</form>
	</AudioEditorDialogShell>;
}

function NumberField({
	field,
	label: fieldLabel,
	value,
	minimum,
	maximum,
	step = 'any',
	onChange,
}: Readonly<{
	field: string;
	label: string;
	value: string;
	minimum: number;
	maximum: number;
	step?: string;
	onChange(value: string): void;
}>) {
	return <label className="audio-editor-field">
		<span>{fieldLabel}</span>
		<input
			type="number"
			data-video-composition-field={field}
			min={minimum}
			max={maximum}
			step={step}
			value={value}
			onChange={(event) => onChange(event.currentTarget.value)}
		/>
	</label>;
}

function CheckField({
	field,
	label: fieldLabel,
	checked,
	onChange,
}: Readonly<{
	field: string;
	label: string;
	checked: boolean;
	onChange(checked: boolean): void;
}>) {
	return <label className="audio-editor-field">
		<input
			type="checkbox"
			data-video-composition-field={field}
			checked={checked}
			onChange={(event) => onChange(event.currentTarget.checked)}
		/>
		<span>{fieldLabel}</span>
	</label>;
}

function label(copy: Readonly<Record<string, string>>, key: string, fallback: string): string {
	return copy[key] || fallback;
}
