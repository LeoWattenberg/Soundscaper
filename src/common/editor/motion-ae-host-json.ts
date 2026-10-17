/* SPDX-License-Identifier: AGPL-3.0-only */
/** ES3-host-compatible codec. No eval, host JSON object, prototypes, or application state is changed. */
export function parseMotionAeHostJson(source: string): unknown {
	if (source.length > 16_777_216) throw new Error('AE JSON input budget exceeded.');
	let position = 0, nodes = 0;
	function whitespace(): void { while (position < source.length && /[ \t\n\r]/.test(source.charAt(position))) position++; }
	function string(): string {
		if (source.charAt(position++) !== '"') throw new Error('AE JSON string expected.');
		let result = '';
		while (position < source.length) {
			let character = source.charAt(position++);
			if (character === '"') return result;
			if (character === '\\') {
				character = source.charAt(position++);
				if (character === 'u') {
					const hex = source.substr(position, 4); if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error('AE JSON Unicode escape is invalid.');
					result += String.fromCharCode(parseInt(hex, 16)); position += 4;
				} else if (character === '"' || character === '\\' || character === '/') result += character;
				else if (character === 'b') result += '\b'; else if (character === 'f') result += '\f';
				else if (character === 'n') result += '\n'; else if (character === 'r') result += '\r'; else if (character === 't') result += '\t';
				else throw new Error('AE JSON escape is invalid.');
			} else { if (character.charCodeAt(0) < 32) throw new Error('AE JSON control character is invalid.'); result += character; }
		}
		throw new Error('AE JSON string is unterminated.');
	}
	function value(depth: number): unknown {
		if (depth > 64) throw new Error('AE JSON depth budget exceeded.'); if (++nodes > 1_048_576) throw new Error('AE JSON value budget exceeded.');
		whitespace(); const character = source.charAt(position);
		if (character === '"') return string();
		if (character === '{') {
			position++; whitespace(); const result: Record<string, unknown> = {};
			if (source.charAt(position) === '}') { position++; return result; }
			while (position < source.length) {
				whitespace(); const key = string();
				if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('AE JSON object key is forbidden.');
				if (Object.prototype.hasOwnProperty.call(result, key)) throw new Error('AE JSON contains a duplicate key.');
				whitespace(); if (source.charAt(position++) !== ':') throw new Error('AE JSON colon expected.'); result[key] = value(depth + 1);
				whitespace(); const delimiter = source.charAt(position++); if (delimiter === '}') return result; if (delimiter !== ',') throw new Error('AE JSON object delimiter expected.');
			}
		} else if (character === '[') {
			position++; whitespace(); const result: unknown[] = [];
			if (source.charAt(position) === ']') { position++; return result; }
			while (position < source.length) {
				result.push(value(depth + 1)); whitespace(); const delimiter = source.charAt(position++);
				if (delimiter === ']') return result; if (delimiter !== ',') throw new Error('AE JSON array delimiter expected.');
			}
		} else {
			let end = position; while (end < source.length && /[0-9.eE+-]/.test(source.charAt(end))) end++;
			const number = source.substring(position, end);
			if (/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(number)) {
				position = end; const result = Number(number); if (!isFinite(result)) throw new Error('AE JSON number must be finite.'); return result;
			}
			if (source.substr(position, 4) === 'null') { position += 4; return null; }
			if (source.substr(position, 4) === 'true') { position += 4; return true; }
			if (source.substr(position, 5) === 'false') { position += 5; return false; }
		}
		throw new Error('AE JSON value is invalid.');
	}
	const result = value(0); whitespace(); if (position !== source.length) throw new Error('AE JSON has trailing input.'); return result;
}
export function stringifyMotionAeHostJson(input: unknown): string {
	const parts: string[] = [], active: object[] = []; let length = 0, nodes = 0, buffer = '';
	function append(text: string): void {
		length += text.length; if (length > 16_777_216) throw new Error('AE JSON output budget exceeded.'); buffer += text;
		if (buffer.length >= 4096) { parts.push(buffer); buffer = ''; }
	}
	function string(text: string): void {
		append('"');
		for (let i = 0; i < text.length; i++) {
			const character = text.charAt(i), code = text.charCodeAt(i);
			if (character === '"' || character === '\\') append('\\' + character);
			else if (code < 32 || code > 126) append('\\u' + ('0000' + code.toString(16)).slice(-4)); else append(character);
		}
		append('"');
	}
	function value(item: unknown, depth: number): void {
		if (depth > 64) throw new Error('AE JSON depth budget exceeded.'); if (++nodes > 1_048_576) throw new Error('AE JSON value budget exceeded.');
		if (item === null) { append('null'); return; }
		if (typeof item === 'string') { string(item); return; }
		if (typeof item === 'boolean') { append(item ? 'true' : 'false'); return; }
		if (typeof item === 'number') { if (!isFinite(item)) throw new Error('AE JSON number must be finite.'); append(String(item)); return; }
		if (typeof item !== 'object') throw new Error('AE JSON accepts only inert values.');
		for (let i = 0; i < active.length; i++) if (active[i] === item) throw new Error('AE JSON cannot serialize a cyclic object.');
		active.push(item);
		if (Object.prototype.toString.call(item) === '[object Array]') {
			const array = item as readonly unknown[]; append('[');
			for (let i = 0; i < array.length; i++) { if (i) append(','); value(array[i], depth + 1); } append(']');
		} else {
			const record = item as Record<string, unknown>; let count = 0; append('{');
			for (const key in record) if (Object.prototype.hasOwnProperty.call(record, key)) {
				if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('AE JSON object key is forbidden.');
				if (count++) append(','); string(key); append(':'); value(record[key], depth + 1);
			}
			append('}');
		}
		active.pop();
	}
	value(input, 0); parts.push(buffer); return parts.join('');
}
