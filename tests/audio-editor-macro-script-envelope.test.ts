/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MACRO_SCRIPT_ENGINE,
	MACRO_SCRIPT_FILE_EXTENSION,
	parseMacroScriptEnvelope,
	serializeMacroScriptEnvelope,
} from '../src/common/editor/macro-script-envelope.ts';

test('a program travels as its own file kind, not as JavaScript', () => {
	// A bare .js file is executable by other things on the machine it lands on;
	// an artifact people email each other must not be one their computer will
	// happily run outside the sandbox it was written for.
	assert.equal(MACRO_SCRIPT_FILE_EXTENSION, '.soundscapemacro');
	const text = serializeMacroScriptEnvelope({ name: 'Level all', source: 'await sound.select.all();' });
	assert.deepEqual(JSON.parse(text), {
		schemaVersion: 1,
		kind: 'script',
		engine: MACRO_SCRIPT_ENGINE,
		name: 'Level all',
		source: 'await sound.select.all();',
	});
	assert.deepEqual(parseMacroScriptEnvelope(text), {
		schemaVersion: 1, kind: 'script', engine: MACRO_SCRIPT_ENGINE,
		name: 'Level all', source: 'await sound.select.all();',
	});
});

test('anything that is not a program file is refused by name', () => {
	assert.throws(() => parseMacroScriptEnvelope('await sound.select.all();'), /not a macro program file/u);
	assert.throws(() => parseMacroScriptEnvelope('[]'), /holds one program/u);
	assert.throws(() => parseMacroScriptEnvelope('{"kind":"steps"}'), /not a macro program/u);
	assert.throws(
		() => parseMacroScriptEnvelope('{"kind":"script","schemaVersion":2}'),
		/Unsupported macro program file version/u,
	);
	assert.throws(
		() => parseMacroScriptEnvelope('{"kind":"script","schemaVersion":1,"engine":"other/1"}'),
		/Unsupported macro program engine/u,
	);
	assert.throws(
		() => parseMacroScriptEnvelope('{"kind":"script","schemaVersion":1,"engine":"soundscaper-macro-js/1","name":" "}'),
		/names its program/u,
	);
	assert.throws(
		() => parseMacroScriptEnvelope(`{"kind":"script","schemaVersion":1,"engine":"soundscaper-macro-js/1","name":"x","source":${'"' + 'y'.repeat(1024 * 1024) + '"'}}`),
		/too large/u,
	);
	assert.throws(() => serializeMacroScriptEnvelope({ name: '  ', source: '' }), /needs a name/u);
});
