

import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';

import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';
import {
	cancelDraftEditOnEscape,
	createDraftBlurCommitGuard,
	draftBlurShouldCommit,
} from '../draft-blur-commit.ts';

export function LabelManagerRow({ label, sampleRate, controller, copy, disabled, run,
	onRemoving = /** @type {null | ((control: HTMLElement) => void)} */ (null) }) {
	const [title, setTitle] = useState(label.title || '');
	const blurCommitGuard = useRef(createDraftBlurCommitGuard()).current;
	useEffect(() => {
		setTitle(label.title || '');
	}, [label.title]);
	const commitTitle = () => {
		if (!draftBlurShouldCommit(blurCommitGuard)) return;
		if (title !== label.title) run(() => controller.actions.labels.update(label.trackId, label.id, { title }));
	};
	const updateRange = (edge, value) => {
		const startFrame = edge === 'start' ? value : label.startFrame;
		const endFrame = edge === 'end' ? value : label.endFrame;
		if (startFrame === label.startFrame && endFrame === label.endFrame) return;
		run(() => controller.actions.labels.update(label.trackId, label.id, { startFrame, endFrame }));
	};
	return (
		<li data-label-id={label.id} data-track-id={label.trackId}>
			<div className="kw-audio-editor__label-manager-heading">
				<input
					aria-label={`${copy.labelTitle || copy.trackName}: ${label.trackName}`}
					value={title}
					disabled={disabled}
					onChange={(event) => setTitle(event.currentTarget.value)}
					onBlur={commitTitle}
					onKeyDown={(event) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							event.stopPropagation();
							event.currentTarget.blur();
						} else if (event.key === 'Escape') {
							cancelDraftEditOnEscape(blurCommitGuard, event, () => setTitle(label.title || ''));
						}
					}}
				/>
				<button
					type="button"
					className="kw-audio-editor__workspace-panel-close"
					aria-label={`${copy.deleteLabel || copy.liftDelete}: ${title || copy.untitledLabel}`}
					disabled={disabled}
					onClick={(event) => { onRemoving?.(event.currentTarget); run(() => controller.actions.labels.remove(label.trackId, label.id)); }}
				>×</button>
			</div>
			<small>{label.trackName}</small>
			<div className="kw-audio-editor__label-manager-range">
				<label><span>{copy.selectionStart || copy.clipStart}</span><AudioEditorTimeCodeInput
					label={copy.selectionStart || copy.clipStart} value={label.startFrame}
					unit="samples" rate={sampleRate} format="hh:mm:ss+milliseconds"
					directEntryUnit="seconds" directEntryPrecision={3}
					maximum={label.endFrame} disabled={disabled}
					onCommit={(value) => updateRange('start', value)} /></label>
				<label><span>{copy.selectionEnd || copy.clipDuration}</span><AudioEditorTimeCodeInput
					label={copy.selectionEnd || copy.clipDuration} value={label.endFrame}
					unit="samples" rate={sampleRate} format="hh:mm:ss+milliseconds"
					directEntryUnit="seconds" directEntryPrecision={3}
					minimum={label.startFrame} disabled={disabled}
					onCommit={(value) => updateRange('end', value)} /></label>
			</div>
			<Button variant="secondary" onClick={() => run(() => controller.actions.timeline.setSelection(label.startFrame, label.endFrame))}>{copy.select || copy.selection}</Button>
		</li>
	);
}

export function MetadataEditorField({ name, label, value, disabled, onCommit, multiline = false }) {
	const [draft, setDraft] = useState(value);
	const blurCommitGuard = useRef(createDraftBlurCommitGuard()).current;
	useEffect(() => setDraft(value), [value]);
	const commit = () => {
		if (!draftBlurShouldCommit(blurCommitGuard)) return;
		if (draft !== value) onCommit(draft);
	};
	const Field = multiline ? 'textarea' : 'input';
	return (
		<label>
			<span>{label}</span>
			<Field
				name={name}
				value={draft}
				rows={multiline ? 3 : undefined}
				disabled={disabled}
				onChange={(event) => setDraft(event.currentTarget.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === 'Enter' && !multiline) event.currentTarget.blur();
					else if (event.key === 'Escape') {
						cancelDraftEditOnEscape(
							blurCommitGuard,
							event,
							() => setDraft(value),
						);
					}
				}}
			/>
		</label>
	);
}
