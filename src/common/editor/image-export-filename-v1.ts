/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import { sanitizeSuggestedSaveName } from './browser-file-save-service.ts';

/** Format a suggested flat basename, then append the selected codec's suffix.
 * {name} is the original's stem; {index} is the caller's stable, one-based batch
 * order; {index:1} through {index:8} apply minimum zero-padding without cutting
 * digits. Double braces escape literal braces. No clock, filesystem or catalog
 * mutation is consulted. Input/expansion bounds refuse rather than truncate.
 * The actual save picker may still choose another filename. */
export function formatImageExportFilenameV1(value: unknown): string {
	const input = record(value, 'image export filename', ['template', 'sourceFileName', 'format', 'index']);
	const template = text(field(input, 'template', 'image export filename'), 256);
	const source = text(field(input, 'sourceFileName', 'image export filename'), 512);
	const format = field(input, 'format', 'image export filename'), index = field(input, 'index', 'image export filename');
	if (format !== 'png' && format !== 'jpeg') throw new RangeError('Unsupported image export filename format.');
	if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 1 || index > 99_999_999) {
		throw new RangeError('Image export filename index is outside its bound.');
	}
	const name = source.replace(/\.[^.]*$/u, '') || 'photo', digits = String(index);
	let expanded = '';
	const append = (part: string) => {
		if (expanded.length + part.length > 508) throw new RangeError('Image export filename expansion exceeds its bound.');
		expanded += part;
	};
	for (let cursor = 0; cursor < template.length;) {
		const character = template[cursor];
		if ((character === '{' || character === '}') && template[cursor + 1] === character) {
			append(character); cursor += 2;
		} else if (character === '{') {
			const end = template.indexOf('}', cursor + 1);
			if (end === -1) throw new RangeError('Unclosed image export filename template token.');
			const token = template.slice(cursor + 1, end);
			if (token === 'name') append(name);
			else if (token === 'index') append(digits);
			else if (/^index:[1-8]$/u.test(token)) append(digits.padStart(Number(token.at(-1)), '0'));
			else throw new RangeError('Unsupported image export filename template token.');
			cursor = end + 1;
		} else {
			if (character === '}') throw new RangeError('Unescaped image export filename template brace.');
			append(character); cursor += 1;
		}
	}
	if (!expanded.trim().replace(/[. ]+$/u, '')) throw new RangeError('Image export filename template is empty.');
	return sanitizeSuggestedSaveName(expanded) + (format === 'png' ? '.png' : '.jpg');
}

function text(value: unknown, maximum: number): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
		throw new TypeError('Image export filename text exceeds its scalar bound.');
	}
	return value;
}
