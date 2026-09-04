/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { Checkbox } from '@soundscaper/design-system/Checkbox';
import { TextInput } from '@soundscaper/design-system/TextInput';

/**
 * The editor for a macro written as a program.
 *
 * A plain textarea, the way the Nyquist prompt is a plain textarea. A syntax
 * editor would be a third of a megabyte of dependency for a surface people
 * reach through one menu, and a contenteditable one reads badly to a screen
 * reader inside a dialog's focus trap.
 *
 * Tab inserts two spaces, because a program is what is being typed. Escape then
 * Tab leaves the field: a tab trap with no way out is not something to ship, and
 * the hint says so where the reader will look for it.
 */
export default function MacroScriptEditor({
	copy,
	script,
	log,
	failure,
	running,
	completed = false,
	blocked,
	onChange,
	onRun,
	onCancel,
	onTrust,
	runnable = true,
}) {
	const sourceRef = useRef(null);
	const [tabEscapes, setTabEscapes] = useState(false);
	const [reviewed, setReviewed] = useState(false);

	const handleKeyDown = (event) => {
		if (event.key === 'Escape') {
			setTabEscapes(true);
			return;
		}
		if (event.key !== 'Tab' || tabEscapes || event.ctrlKey || event.metaKey || event.altKey) {
			setTabEscapes(false);
			return;
		}
		event.preventDefault();
		const field = event.currentTarget;
		const { selectionStart: start, selectionEnd: end, value } = field;
		onChange({ ...script, source: `${value.slice(0, start)}  ${value.slice(end)}` });
		requestAnimationFrame(() => {
			field.selectionStart = start + 2;
			field.selectionEnd = start + 2;
		});
	};

	return (
		<section className="audio-editor-macro-script" data-macro-script>
			<label className="audio-editor-field">
				<span>{copy.programName}</span>
				<TextInput
					value={script.name || ''}
					onChange={(name) => onChange({ ...script, name })}
					width="100%"
				/>
			</label>
			<label className="audio-editor-field audio-editor-macro-script__source">
				<span>{copy.program}</span>
				<textarea
					ref={sourceRef}
					rows={14}
					spellCheck="false"
					autoCapitalize="off"
					autoCorrect="off"
					wrap="off"
					data-macro-script-source
					value={script.source || ''}
					onKeyDown={handleKeyDown}
					onChange={(event) => onChange({ ...script, source: event.target.value })}
				/>
			</label>
			<p className="audio-editor-panel-hint" data-macro-script-notice>{copy.sandboxNotice}</p>
			<p className="audio-editor-panel-hint">{copy.tabHint}</p>
			{failure && (
				<p className="audio-editor-field-error" role="alert" data-macro-script-failure>
					{failure.line ? copy.failureAtLine.replace('{line}', String(failure.line)) : copy.failure}
					{' '}
					{failure.message}
				</p>
			)}
			<div
				className="audio-editor-macro-script__log"
				data-macro-script-log
				data-outcome={running ? 'running' : failure ? 'failed' : completed ? 'completed' : 'idle'}
				aria-live="polite"
			>
				{log.map((entry, index) => (
					// A log is append-only within a run, so its position is its identity.
					<p key={`${index}:${entry.at}`} data-macro-script-log-level={entry.level}>{entry.text}</p>
				))}
			</div>
			{!runnable && (
				// The gate sits directly under the program it is about, so the text
				// being vouched for is the text on screen rather than a summary of it.
				<section className="audio-editor-macro-script__review" data-macro-script-review>
					<h4>{copy.reviewHeading}</h4>
					<p className="audio-editor-panel-hint">
						{script.origin
							? copy.reviewOrigin.replace('{origin}', script.origin)
							: copy.reviewUnknownOrigin}
					</p>
					<p className="audio-editor-panel-hint">{copy.reviewRisk}</p>
					<div
						className="audio-editor-macro-script__review-acknowledge"
						onClick={() => setReviewed((current) => !current)}
					>
						<Checkbox
							checked={reviewed}
							onChange={setReviewed}
							aria-label={copy.reviewAcknowledge}
						/>
						<span aria-hidden="true">{copy.reviewAcknowledge}</span>
					</div>
				</section>
			)}
			<div className="audio-editor-macro-script__actions">
				{running
					? <Button variant="secondary" onClick={onCancel}>{copy.cancelRun}</Button>
					: runnable
						? <Button variant="primary" disabled={blocked || !String(script.source || '').trim()} onClick={onRun}>{copy.runProgram}</Button>
						: <Button variant="primary" disabled={!reviewed} onClick={onTrust}>{copy.enableProgram}</Button>}
			</div>
		</section>
	);
}
