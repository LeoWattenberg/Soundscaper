/* SPDX-License-Identifier: AGPL-3.0-only */

import { createElement, Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
	formatRecordingNotes,
	parseRecordingNotesMarkdown,
	type RecordingNotesBlock,
	type RecordingNotesFormat,
	type RecordingNotesInline,
	type RecordingNotesSelection,
} from '../../recording-notes-markdown.ts';

interface RecordingNotesPanelProps {
	readonly value: string;
	readonly disabled: boolean;
	readonly copy: Readonly<Record<string, string>>;
	readonly onChange: (value: string) => void;
}

function renderInline(content: readonly RecordingNotesInline[]): ReactNode {
	return content.map((token, index) => {
		if (token.kind === 'text') return <Fragment key={index}>{token.text}</Fragment>;
		if (token.kind === 'code') return <code key={index}>{token.text}</code>;
		return token.kind === 'strong'
			? <strong key={index}>{renderInline(token.content)}</strong>
			: <em key={index}>{renderInline(token.content)}</em>;
	});
}

function renderBlock(block: RecordingNotesBlock, index: number): ReactNode {
	if (block.kind === 'heading') {
		return createElement(`h${block.level}`, { key: index }, renderInline(block.content));
	}
	if (block.kind === 'paragraph') return <p key={index}>{renderInline(block.content)}</p>;
	const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>);
	return block.ordered ? <ol key={index} start={block.start}>{items}</ol> : <ul key={index}>{items}</ul>;
}

/** The project owns every edit immediately; this panel only owns its preview and textarea selection. */
export default function RecordingNotesPanel({ value, disabled, copy, onChange }: RecordingNotesPanelProps) {
	const [preview, setPreview] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const pendingSelection = useRef<RecordingNotesSelection | null>(null);
	const focusEditor = useRef(false);
	const blocks = useMemo(() => preview ? parseRecordingNotesMarkdown(value) : [], [preview, value]);
	const formats: readonly { format: RecordingNotesFormat; label: string }[] = [
		{ format: 'bold', label: copy.recordingNotesBold },
		{ format: 'italic', label: copy.recordingNotesItalic },
		{ format: 'heading', label: copy.recordingNotesHeading },
		{ format: 'bullets', label: copy.recordingNotesBullets },
		{ format: 'numbered-list', label: copy.recordingNotesNumberedList },
		{ format: 'code', label: copy.recordingNotesCode },
	];

	useLayoutEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		if (disabled) pendingSelection.current = null;
		const selection = pendingSelection.current;
		if (selection && selection.value === value) {
			pendingSelection.current = null;
			textarea.focus();
			textarea.setSelectionRange(selection.selectionStart, selection.selectionEnd);
		} else if (focusEditor.current) {
			focusEditor.current = false;
			textarea.focus();
		}
	}, [value, preview, disabled]);

	const applyFormat = (format: RecordingNotesFormat, label: string) => {
		const textarea = textareaRef.current;
		if (disabled || !textarea) return;
		const result = formatRecordingNotes(value, textarea.selectionStart, textarea.selectionEnd, format, label);
		pendingSelection.current = result;
		onChange(result.value);
	};

	return (
		<div className="kw-audio-editor__recording-notes" data-recording-notes-panel>
			<p className="kw-audio-editor__recording-notes-description">{copy.recordingNotesDescription}</p>
			<div className="kw-audio-editor__recording-notes-actions">
				{!preview && <div className="kw-audio-editor__recording-notes-formatting"
					role="group" aria-label={copy.recordingNotesFormatting}>
					{formats.map(({ format, label }) => <button key={format} type="button"
						data-recording-notes-format={format} disabled={disabled}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => applyFormat(format, label)}>{label}</button>)}
				</div>}
				<button type="button" data-recording-notes-toggle onClick={() => {
					focusEditor.current = preview;
					setPreview(!preview);
				}}>{preview ? copy.recordingNotesEdit : copy.recordingNotesPreviewAction}</button>
			</div>
			<textarea ref={textareaRef} data-recording-notes-editor aria-label={copy.recordingNotes} hidden={preview}
				className="kw-audio-editor__recording-notes-editor" value={value} disabled={disabled} spellCheck
				onChange={(event) => {
					pendingSelection.current = null;
					onChange(event.currentTarget.value);
				}}
				onKeyDown={(event) => {
					if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey) return;
					const format = event.key.toLowerCase() === 'b' ? 'bold'
						: event.key.toLowerCase() === 'i' ? 'italic' : null;
					if (!format) return;
					event.preventDefault();
					applyFormat(format, format === 'bold' ? copy.recordingNotesBold : copy.recordingNotesItalic);
				}} />
			{preview && <section className="kw-audio-editor__recording-notes-preview" data-recording-notes-preview
				aria-label={copy.recordingNotesPreview}>
				{blocks.length ? blocks.map(renderBlock) : <p className="kw-audio-editor__panel-empty">{copy.recordingNotesEmpty}</p>}
			</section>}
		</div>
	);
}
