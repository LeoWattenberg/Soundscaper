/* SPDX-License-Identifier: AGPL-3.0-only */

import { formatRecordingNotesCode, recordingNotesCodeReader } from './recording-notes-code.ts';

export type RecordingNotesFormat = 'bold' | 'italic' | 'heading' | 'bullets' | 'numbered-list' | 'code';

export interface RecordingNotesSelection {
	readonly value: string;
	readonly selectionStart: number;
	readonly selectionEnd: number;
}

export type RecordingNotesInline =
	| { readonly kind: 'text'; readonly text: string }
	| { readonly kind: 'code'; readonly text: string }
	| { readonly kind: 'strong'; readonly content: readonly RecordingNotesInline[] }
	| { readonly kind: 'emphasis'; readonly content: readonly RecordingNotesInline[] };

export type RecordingNotesBlock =
	| { readonly kind: 'paragraph'; readonly content: readonly RecordingNotesInline[] }
	| { readonly kind: 'heading'; readonly level: number; readonly content: readonly RecordingNotesInline[] }
	| { readonly kind: 'list'; readonly ordered: boolean; readonly start: number;
		readonly items: readonly (readonly RecordingNotesInline[])[] };

function selectionOffset(offset: number, length: number): number {
	return Number.isFinite(offset) ? Math.max(0, Math.min(length, Math.trunc(offset))) : 0;
}

function replaceSelection(value: string, start: number, end: number, text: string,
	selectedStart: number, selectedEnd: number): RecordingNotesSelection {
	return {
		value: value.slice(0, start) + text + value.slice(end),
		selectionStart: start + selectedStart,
		selectionEnd: start + selectedEnd,
	};
}

function formatInline(value: string, start: number, end: number, marker: string,
	placeholder: string): RecordingNotesSelection {
	const selected = value.slice(start, end);
	if (selected.includes('\n')) return formatMultilineInline(value, start, end, marker, placeholder);
	if (marker === '`') return formatRecordingNotesCode(value, start, end, placeholder);
	if (marker !== '`' && selected) {
		const leading = /^\s*/u.exec(selected)?.[0].length ?? 0;
		const trailing = /\s*$/u.exec(selected)?.[0].length ?? 0;
		if (leading === selected.length) return { value, selectionStart: start, selectionEnd: end };
		if (leading || trailing) return formatInline(value, start + leading, end - trailing, marker, placeholder);
	}
	const markerRun = (text: string, offset: number, direction: number) => {
		let length = 0;
		while (text[offset] === marker[0]) { length += 1; offset += direction; }
		return length;
	};
	const applies = (length: number) => marker === '*' ? length % 2 === 1 : length >= marker.length;
	if (applies(markerRun(selected, 0, 1)) && applies(markerRun(selected, selected.length - 1, -1))
		&& selected.length > marker.length * 2) {
		const text = selected.slice(marker.length, -marker.length);
		return replaceSelection(value, start, end, text, 0, text.length);
	}
	if (applies(markerRun(value, start - 1, -1)) && applies(markerRun(value, end, 1))) {
		return replaceSelection(value, start - marker.length, end + marker.length, selected, 0, selected.length);
	}
	const text = selected || placeholder;
	return replaceSelection(value, start, end, marker + text + marker, marker.length, marker.length + text.length);
}

function formatMultilineInline(value: string, start: number, end: number, marker: string,
	placeholder: string): RecordingNotesSelection {
	let offset = start;
	const lines = value.slice(start, end).split('\n').map(text => {
		const from = offset;
		offset += text.length + 1;
		return { from, to: from + text.length, text };
	});
	let next = value;
	let selectionStart = start;
	let selectionEnd = end;
	let finalContent = true;
	// Independent inline spans cannot cross paragraph/list boundaries. Work
	// backwards so earlier authored offsets remain valid after each replacement.
	for (const line of lines.reverse()) {
		if (!line.text.trim()) continue;
		const lineStart = line.from === 0 ? 0 : value.lastIndexOf('\n', line.from - 1) + 1;
		const prefix = line.from === lineStart ? blockPrefix(line.text) : null;
		let from = line.from + (prefix ? prefix.indent.length + prefix.prefix.length : 0);
		let to = line.to;
		if (from === to) continue;
		const content = next.slice(from, to);
		const contentStart = from + (/^\s*/u.exec(content)?.[0].length ?? 0);
		const contentEnd = to - (/\s*$/u.exec(content)?.[0].length ?? 0);
		// The restored selection excludes the first opener and last closer.
		// Include that matching half when toggling the first or final line.
		if (marker === '`') {
			let opening = from;
			while (next[opening - 1] === '`') opening -= 1;
			if (opening === from && next[from - 1] === ' ') {
				opening -= 1;
				while (next[opening - 1] === '`') opening -= 1;
			}
			const readCode = recordingNotesCodeReader(next);
			const enclosing = readCode(opening);
			if (enclosing?.contentStart === from && enclosing.end === to) from = opening;
			const selected = readCode(from);
			if (selected?.contentEnd === to) to = selected.end;
		} else {
			if (next.slice(contentStart, contentEnd).endsWith(marker)
				&& next.slice(contentStart - marker.length, contentStart) === marker) from = contentStart - marker.length;
			if (next.slice(contentStart, contentEnd).startsWith(marker)
				&& next.slice(contentEnd, contentEnd + marker.length) === marker) to = contentEnd + marker.length;
		}
		const result = formatInline(next, from, to, marker, placeholder);
		selectionEnd = finalContent ? result.selectionEnd : selectionEnd + result.value.length - next.length;
		selectionStart = result.selectionStart;
		finalContent = false;
		next = result.value;
	}
	return { value: next, selectionStart, selectionEnd };
}

function blockPrefix(line: string): { indent: string; prefix: string; content: string } {
	const indent = /^[\t ]*/u.exec(line)?.[0] || '';
	const content = line.slice(indent.length);
	const prefix = /^(?:#{1,6}[\t ]+|[-*+][\t ]+|\d+[.)][\t ]+)/u.exec(content)?.[0] || '';
	return { indent, prefix, content: content.slice(prefix.length) };
}

function formatLines(value: string, start: number, end: number,
	format: 'heading' | 'bullets' | 'numbered-list', placeholder: string): RecordingNotesSelection {
	const first = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
	const finalSelectionOffset = end > start && value[end - 1] === '\n' ? end - 1 : end;
	const nextNewline = value.indexOf('\n', finalSelectionOffset);
	const last = nextNewline < 0 ? value.length : nextNewline;
	const lines = value.slice(first, last).split('\n').map(blockPrefix);
	const matches = (prefix: string) => format === 'heading' ? /^#[\t ]+$/u.test(prefix)
		: format === 'bullets' ? /^[-*+][\t ]+$/u.test(prefix) : /^\d+[.)][\t ]+$/u.test(prefix);
	const remove = lines.some((line) => matches(line.prefix))
		&& lines.every((line) => !line.content || matches(line.prefix));
	let itemNumber = 0;
	const replacements = lines.map((line) => {
		// A selected separator is authored whitespace, not a request for a new
		// placeholder note. Keep the explicit empty-caret insertion behavior.
		const content = line.content || (!remove && start === end && lines.length === 1 ? placeholder : '');
		const prefix = remove || !content ? '' : format === 'heading' ? '# '
			: format === 'bullets' ? '- ' : `${++itemNumber}. `;
		return { original: line, prefix, text: line.indent + prefix + content };
	});
	const mapOffset = (offset: number): number => {
		let originalPosition = first;
		let replacementPosition = 0;
		for (const line of replacements) {
			const oldLength = line.original.indent.length + line.original.prefix.length + line.original.content.length;
			if (offset <= originalPosition + oldLength) {
				const prefixEnd = line.original.indent.length + line.original.prefix.length;
				return replacementPosition + line.original.indent.length + line.prefix.length
					+ Math.max(0, offset - originalPosition - prefixEnd);
			}
			originalPosition += oldLength + 1;
			replacementPosition += line.text.length + 1;
		}
		return replacements.map((line) => line.text).join('\n').length;
	};
	const text = replacements.map((line) => line.text).join('\n');
	const selectedStart = mapOffset(start);
	const selectedEnd = start === end && !value.slice(first, last)
		? text.length : mapOffset(Math.min(end, last));
	return replaceSelection(value, first, last, text, selectedStart, selectedEnd);
}

/** Formats the textarea selection; the caller restores these offsets after its controlled update. */
export function formatRecordingNotes(value: string, selectionStart: number, selectionEnd: number,
	format: RecordingNotesFormat, placeholder: string): RecordingNotesSelection {
	const start = selectionOffset(selectionStart, value.length);
	const end = Math.max(start, selectionOffset(selectionEnd, value.length));
	if (format === 'code') return formatInline(value, start, end, '`', placeholder);
	if (format === 'bold' || format === 'italic') {
		return formatInline(value, start, end, format === 'bold' ? '**' : '*', placeholder);
	}
	return formatLines(value, start, end, format, placeholder);
}

interface InlineFrame {
	readonly marker: string;
	readonly content: RecordingNotesInline[];
}

function appendText(content: RecordingNotesInline[], text: string): void {
	if (!text) return;
	const last = content.at(-1);
	if (last?.kind === 'text') content[content.length - 1] = { kind: 'text', text: last.text + text };
	else content.push({ kind: 'text', text });
}

function appendUnmatchedFrame(stack: InlineFrame[]): void {
	const frame = stack.pop() as InlineFrame;
	const parent = stack[stack.length - 1] as InlineFrame;
	appendText(parent.content, frame.marker);
	for (const token of frame.content) {
		if (token.kind === 'text') appendText(parent.content, token.text);
		else parent.content.push(token);
	}
}

function parseInline(text: string): InlineFrame {
	const root: InlineFrame = { marker: '', content: [] };
	const stack: InlineFrame[] = [root];
	const readCode = recordingNotesCodeReader(text);
	let position = 0;
	while (position < text.length) {
		const frame = stack[stack.length - 1] as InlineFrame;
		if (text[position] === '\\' && /[\\`*_{}[\]()#+\-.!>]/u.test(text[position + 1] || '')) {
			appendText(frame.content, text[position + 1] || '');
			position += 2;
			continue;
		}
		if (text[position] === '`') {
			const code = readCode(position);
			if (code) {
				frame.content.push({ kind: 'code', text: code.text });
				position = code.end;
			} else {
				const start = position;
				while (text[position] === '`') position += 1;
				appendText(frame.content, text.slice(start, position));
			}
			continue;
		}
		const character = text[position] || '';
		if (character === '*' || character === '_') {
			let runEnd = position + 1;
			while (text[runEnd] === character) runEnd += 1;
			const before = text[position - 1] || '';
			const after = text[runEnd] || '';
			const intraword = character === '_' && /[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after);
			const canOpen = !intraword && Boolean(after) && !/\s/u.test(after);
			const canClose = !intraword && Boolean(before) && !/\s/u.test(before);
			while (position < runEnd) {
				const remaining = runEnd - position;
				const closes = (candidate: InlineFrame) => candidate.marker.startsWith(character)
					&& remaining >= candidate.marker.length && !(candidate.marker.length === 1 && remaining === 2);
				if (canClose && !closes(stack[stack.length - 1] as InlineFrame)) {
					// A literal wildcard or unfinished inner emphasis must not block
					// the completed outer span added by the formatting action.
					for (let index = stack.length - 2; index > 0; index -= 1) {
						if (!closes(stack[index] as InlineFrame)) continue;
						while (stack.length - 1 > index) appendUnmatchedFrame(stack);
						break;
					}
				}
				const current = stack[stack.length - 1] as InlineFrame;
				if (canClose && closes(current)) {
					stack.pop();
					const parent = stack[stack.length - 1] as InlineFrame;
					parent.content.push({ kind: current.marker.length === 2 ? 'strong' : 'emphasis', content: current.content });
					position += current.marker.length;
				} else if (canOpen && stack.length < 13) {
					const marker = character.repeat(remaining >= 2 ? 2 : 1);
					stack.push({ marker, content: [] });
					position += marker.length;
				} else {
					appendText(current.content, text.slice(position, runEnd));
					position = runEnd;
				}
			}
			continue;
		}
		const start = position;
		position += 1;
		while (position < text.length && !/[\\`*_]/u.test(text[position] || '')) position += 1;
		appendText(frame.content, text.slice(start, position));
	}
	while (stack.length > 1) appendUnmatchedFrame(stack);
	return root;
}

function headingLine(line: string): RegExpExecArray | null {
	return /^ {0,3}(#{1,6})[\t ]+(.+)$/u.exec(line);
}

function listLine(line: string): RegExpExecArray | null {
	return /^ {0,3}(?:(\d+)[.)]|([-*+]))[\t ]+(.*)$/u.exec(line);
}

/** Builds a text-only Markdown tree. HTML and link syntax never become executable elements. */
export function parseRecordingNotesMarkdown(value: string): readonly RecordingNotesBlock[] {
	const lines = value.replace(/\r\n?/gu, '\n').split('\n');
	const blocks: RecordingNotesBlock[] = [];
	let position = 0;
	while (position < lines.length) {
		const line = lines[position] || '';
		if (!line.trim()) { position += 1; continue; }
		const heading = headingLine(line);
		if (heading) {
			blocks.push({ kind: 'heading', level: heading[1]?.length || 1, content: parseInline(heading[2] || '').content });
			position += 1;
			continue;
		}
		const list = listLine(line);
		if (list) {
			const ordered = Boolean(list[1]);
			const items: (readonly RecordingNotesInline[])[] = [];
			while (position < lines.length) {
				const next = listLine(lines[position] || '');
				if (!next || Boolean(next[1]) !== ordered) break;
				items.push(parseInline(next[3] || '').content);
				position += 1;
			}
			blocks.push({ kind: 'list', ordered, start: ordered ? Number(list[1]) : 1, items });
			continue;
		}
		const paragraph: string[] = [];
		while (position < lines.length) {
			const next = lines[position] || '';
			if (!next.trim() || headingLine(next) || listLine(next)) break;
			paragraph.push(next);
			position += 1;
		}
		blocks.push({ kind: 'paragraph', content: parseInline(paragraph.join('\n')).content });
	}
	return blocks;
}
