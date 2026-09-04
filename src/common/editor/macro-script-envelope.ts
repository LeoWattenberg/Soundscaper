/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The file a macro program travels in.
 *
 * The extension is `.soundscapemacro`, not `.js`, and that is not cosmetic: a
 * bare `.js` file is executable by other things on the machine it lands on.
 * Double-clicking one can hand it to Node, to Windows Script Host, or to an
 * editor's run button. An artifact people email each other must not be
 * something their computer will happily run outside the sandbox it was written
 * for.
 *
 * The envelope is JSON so the importer can show what it is holding before the
 * reader is ever offered a way to run it.
 */

export const MACRO_SCRIPT_ENVELOPE_VERSION = 1 as const;
export const MACRO_SCRIPT_FILE_EXTENSION = '.soundscapemacro';
export const MACRO_SCRIPT_ENGINE = 'soundscaper-macro-js/1';

const MAX_ENVELOPE_CODE_UNITS = 1024 * 1024;

export interface MacroScriptEnvelope {
	readonly schemaVersion: typeof MACRO_SCRIPT_ENVELOPE_VERSION;
	readonly kind: 'script';
	readonly engine: string;
	readonly name: string;
	readonly source: string;
}

export function serializeMacroScriptEnvelope(
	script: Readonly<{ name: string; source: string }>,
): string {
	const name = String(script.name ?? '').trim();
	if (!name) throw new TypeError('A macro program needs a name to be exported.');
	return `${JSON.stringify({
		schemaVersion: MACRO_SCRIPT_ENVELOPE_VERSION,
		kind: 'script',
		engine: MACRO_SCRIPT_ENGINE,
		name,
		source: String(script.source ?? ''),
	}, null, '\t')}\n`;
}

/**
 * Read a program file. Nothing here runs anything — it returns text and a name,
 * and the decision about whether that text may run is taken elsewhere, by a
 * person.
 */
export function parseMacroScriptEnvelope(text: unknown): MacroScriptEnvelope {
	if (typeof text !== 'string') throw new TypeError('A macro program file must be text.');
	if (text.length > MAX_ENVELOPE_CODE_UNITS) throw new RangeError('The macro program file is too large.');
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (cause) {
		throw new SyntaxError(
			`That is not a macro program file: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause },
		);
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A macro program file holds one program.');
	}
	const envelope = value as Record<string, unknown>;
	if (envelope.kind !== 'script') throw new RangeError('That file is not a macro program.');
	if (envelope.schemaVersion !== MACRO_SCRIPT_ENVELOPE_VERSION) {
		throw new RangeError(`Unsupported macro program file version: ${String(envelope.schemaVersion)}.`);
	}
	if (typeof envelope.engine !== 'string' || !envelope.engine.startsWith('soundscaper-macro-js/')) {
		throw new RangeError(`Unsupported macro program engine: ${String(envelope.engine)}.`);
	}
	const name = String(envelope.name ?? '').trim();
	if (!name) throw new TypeError('A macro program file names its program.');
	if (typeof envelope.source !== 'string') throw new TypeError('A macro program file carries its source.');
	return Object.freeze({
		schemaVersion: MACRO_SCRIPT_ENVELOPE_VERSION,
		kind: 'script',
		engine: envelope.engine,
		name,
		source: envelope.source,
	});
}
