/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroScriptLibraryService } from '../src/common/editor/controller/effects/macro-script-library-service.ts';
import { createMacroScriptLibrary, macroScriptIsRunnable } from '../src/common/editor/macro-script-library.ts';

function library() {
	let nextId = 0;
	return createMacroScriptLibraryService({
		state: { macroScripts: createMacroScriptLibrary() },
		createId: prefix => `${prefix}-${++nextId}`,
		persistSetting: async () => {},
		publishDocumentSnapshot: () => {},
		handleError: error => { throw error; },
	});
}

test('exporting and importing an authored program cannot revoke its existing exact-source permission', async () => {
	const service = library();
	const original = service.save({ name: 'My programme', source: "sound.log.info('Hello');" });
	const imported = service.import(service.export(original.id), 'my-programme.soundscapemacro');
	assert.equal(macroScriptIsRunnable(original), true);
	assert.equal(macroScriptIsRunnable(imported), false);
	assert.equal(service.blocked(original.source), false);
	service.delete(original.id);
	assert.equal(service.blocked(imported.source), true, 'removing the permitted copy leaves the unreviewed import blocked');
	await service.flush();
});

test('reviewing one of two ordinary imports admits their exact shared bytes', async () => {
	const service = library();
	const original = service.save({ name: 'Programme', source: 'sound.log.info(1);' });
	const file = service.export(original.id);
	service.delete(original.id);
	const first = service.import(file, 'programme.soundscapemacro');
	const second = service.import(file, 'programme.soundscapemacro');
	assert.equal(service.blocked(first.source), true);
	service.trust(first.id);
	assert.equal(service.blocked(first.source), false);
	service.save({ ...service.list().find(item => item.id === first.id)!, source: 'sound.log.info(2);' });
	assert.equal(service.blocked(second.source), true);
	assert.equal(service.blocked('sound.log.info(2);'), true, 'a changed reviewed copy needs review again');
	await service.flush();
});
