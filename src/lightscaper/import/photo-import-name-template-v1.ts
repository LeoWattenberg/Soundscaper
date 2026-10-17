/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImportSettingsV1 } from '../../common/editor/photo-library-import-settings-port-v1.ts';
import { field, integer, name, record, text } from '../catalog/value-validation.ts';

type Rename = PhotoLibraryImportSettingsV1['rename'];
const tokens = ['{stem}', '{sequence}', '{extension}'];

export function normalizePhotoImportRenameV1(value: unknown): Rename {
	if (value === null) return null;
	const input = record(value, 'photo import rename', ['template', 'sequenceStart', 'sequencePadding']);
	const template = text(field(input, 'template'), 'photo rename template', 256, 1);
	parts(template);
	return Object.freeze({ template, sequenceStart: integer(field(input, 'sequenceStart'), 1, Number.MAX_SAFE_INTEGER, 'rename sequence start'),
		sequencePadding: integer(field(input, 'sequencePadding'), 1, 16, 'rename sequence padding') });
}

/** Pure authored display-name expansion; it never mutates a File or filesystem. */
export function expandPhotoImportNameV1(fileName: string, selectedIndex: number, value: Rename): string {
	const source = name(fileName, 'selected photo filename');
	const index = integer(selectedIndex, 0, 63, 'selected photo index');
	const rename = normalizePhotoImportRenameV1(value);
	if (rename === null) return source;
	if (rename.sequenceStart > Number.MAX_SAFE_INTEGER - index) throw new RangeError('Photo rename sequence exceeds its safe integer bound.');
	const dot = source.lastIndexOf('.'), hasExtension = dot > 0 && dot < source.length - 1;
	const substitutions: Readonly<Record<string, string>> = {
		'{stem}': hasExtension ? source.slice(0, dot) : source,
		'{extension}': hasExtension ? source.slice(dot + 1) : '',
		'{sequence}': String(rename.sequenceStart + index).padStart(rename.sequencePadding, '0'),
	};
	let result = '';
	for (const part of parts(rename.template)) {
		result += substitutions[part] ?? part;
		if (result.length > 256) throw new RangeError('Renamed photo filename exceeds its name bound.');
	}
	return name(result, 'renamed photo filename');
}

function parts(template: string): readonly string[] {
	const result: string[] = [];
	for (let index = 0; index < template.length; index++) {
		const character = template[index]!;
		if (character === '}') throw new RangeError('Photo rename template has an unmatched token.');
		if (character !== '{') { result.push(character); continue; }
		const end = template.indexOf('}', index + 1);
		const token = end < 0 ? '' : template.slice(index, end + 1);
		if (!tokens.includes(token)) throw new RangeError('Photo rename template contains an unsupported token.');
		result.push(token); index = end;
	}
	return result;
}
