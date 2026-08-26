

import { useEffect, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';

import { framesToSeconds, secondsToFrames } from '../../design-system-adapters.js';

export function LabelManagerRow({ label, sampleRate, controller, copy, disabled, run }) {
	const [title, setTitle] = useState(label.title || '');
	const [startSeconds, setStartSeconds] = useState(() => framesToSeconds(label.startFrame, { sampleRate }).toFixed(3));
	const [endSeconds, setEndSeconds] = useState(() => framesToSeconds(label.endFrame, { sampleRate }).toFixed(3));
	useEffect(() => {
		setTitle(label.title || '');
		setStartSeconds(framesToSeconds(label.startFrame, { sampleRate }).toFixed(3));
		setEndSeconds(framesToSeconds(label.endFrame, { sampleRate }).toFixed(3));
	}, [label.endFrame, label.startFrame, label.title, sampleRate]);
	const updateRange = () => {
		const startValue = Number(startSeconds);
		const endValue = Number(endSeconds);
		if (!Number.isFinite(startValue) || !Number.isFinite(endValue) || startValue < 0 || endValue < startValue) {
			setStartSeconds(framesToSeconds(label.startFrame, { sampleRate }).toFixed(3));
			setEndSeconds(framesToSeconds(label.endFrame, { sampleRate }).toFixed(3));
			return;
		}
		const startFrame = secondsToFrames(startValue, { sampleRate });
		const endFrame = secondsToFrames(endValue, { minimumFrame: startFrame, sampleRate });
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
					onBlur={() => {
						if (title !== label.title) run(() => controller.actions.labels.update(label.trackId, label.id, { title }));
					}}
				/>
				<button
					type="button"
					className="kw-audio-editor__workspace-panel-close"
					aria-label={`${copy.deleteLabel || copy.liftDelete}: ${title || copy.untitledLabel}`}
					disabled={disabled}
					onClick={() => run(() => controller.actions.labels.remove(label.trackId, label.id))}
				>×</button>
			</div>
			<small>{label.trackName}</small>
			<div className="kw-audio-editor__label-manager-range">
				<label><span>{copy.selectionStart || copy.clipStart}</span><input type="number" min="0" step="0.001" value={startSeconds} disabled={disabled} onChange={(event) => setStartSeconds(event.currentTarget.value)} onBlur={updateRange} /></label>
				<label><span>{copy.selectionEnd || copy.clipDuration}</span><input type="number" min="0" step="0.001" value={endSeconds} disabled={disabled} onChange={(event) => setEndSeconds(event.currentTarget.value)} onBlur={updateRange} /></label>
			</div>
			<Button variant="secondary" onClick={() => run(() => controller.actions.timeline.setSelection(label.startFrame, label.endFrame))}>{copy.select || copy.selection}</Button>
		</li>
	);
}

export function MetadataEditorField({ name, label, value, disabled, onCommit }) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	const commit = () => {
		if (draft !== value) onCommit(draft);
	};
	return (
		<label>
			<span>{label}</span>
			<input
				name={name}
				value={draft}
				disabled={disabled}
				onChange={(event) => setDraft(event.currentTarget.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === 'Enter') event.currentTarget.blur();
					else if (event.key === 'Escape') {
						setDraft(value);
						event.currentTarget.blur();
					}
				}}
			/>
		</label>
	);
}
