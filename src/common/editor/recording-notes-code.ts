/* SPDX-License-Identifier: AGPL-3.0-only */

interface CodeSpan {
	readonly end: number;
	readonly contentStart: number;
	readonly contentEnd: number;
	readonly text: string;
}

/** Match whole equal-length delimiter runs, without rescanning unmatched runs. */
export function recordingNotesCodeReader(value: string): (start: number) => CodeSpan | null {
	const runs = [...value.matchAll(/`+/gu)];
	const nextByLength = new Map<number, number>();
	const closes = new Map<number, number>();
	for (let index = runs.length - 1; index >= 0; index -= 1) {
		const run = runs[index];
		if (!run) continue;
		const next = nextByLength.get(run[0].length);
		if (next !== undefined) closes.set(run.index, next);
		nextByLength.set(run[0].length, run.index);
	}
	return start => {
		const closing = closes.get(start);
		if (closing === undefined) return null;
		let length = 0;
		while (value[start + length] === '`') length += 1;
		let contentStart = start + length;
		let contentEnd = closing;
		if (contentEnd <= contentStart) return null;
		// Multi-backtick spans use padding to separate literal boundary backticks.
		// Keep the editor's established single-backtick whitespace behavior.
		if (length > 1 && value[contentStart] === ' ' && value[contentEnd - 1] === ' '
			&& /[^ ]/u.test(value.slice(contentStart, contentEnd))) {
			contentStart += 1;
			contentEnd -= 1;
		}
		return { end: closing + length, contentStart, contentEnd,
			text: value.slice(contentStart, contentEnd) };
	};
}

export function formatRecordingNotesCode(value: string, start: number, end: number,
	placeholder: string): Readonly<{ value: string; selectionStart: number; selectionEnd: number }> {
	const selected = value.slice(start, end);
	const whole = selected.startsWith('`') ? recordingNotesCodeReader(selected)(0) : null;
	const replace = (from: number, to: number, text: string, offset: number, length: number) => ({
		value: value.slice(0, from) + text + value.slice(to),
		selectionStart: from + offset, selectionEnd: from + offset + length,
	});
	if (whole?.end === selected.length) return replace(start, end, whole.text, 0, whole.text.length);
	let opening = start;
	while (value[opening - 1] === '`') opening -= 1;
	if (opening === start && value[start - 1] === ' ') {
		opening -= 1;
		while (value[opening - 1] === '`') opening -= 1;
	}
	const enclosing = value[opening] === '`' ? recordingNotesCodeReader(value)(opening) : null;
	if (enclosing?.contentStart === start && enclosing.contentEnd === end) {
		return replace(opening, enclosing.end, selected, 0, selected.length);
	}
	const text = selected || placeholder;
	const longest = [...text.matchAll(/`+/gu)].reduce((length, run) => Math.max(length, run[0].length), 0);
	const marker = '`'.repeat(longest + 1);
	const padding = longest > 0 && (text.startsWith('`') || text.endsWith('`')
		|| (text.startsWith(' ') && text.endsWith(' '))) ? ' ' : '';
	return replace(start, end, marker + padding + text + padding + marker,
		marker.length + padding.length, text.length);
}
