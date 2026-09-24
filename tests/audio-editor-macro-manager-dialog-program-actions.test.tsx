/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { act } from 'react';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { resolveMacroManagerCopy } from '../src/common/editor/ui/inspector/macro-manager-copy.ts';
import {
	changeFile, click, macroSnapshot, mountedMacroManagerFixture,
} from './helpers/macro-manager-fixture.tsx';

const COPY = resolveMacroManagerCopy('en');
const DELETE_PROGRAM = 'Delete program';

test('programs offer the same four header actions as macros with no separate creation button', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		const programs = fixture.find('[data-macro-programs]');
		assert.ok(programs);
		const header = programs.querySelector('.audio-editor-macros-palette__library-header');
		assert.ok(header);
		assert.deepEqual(header.querySelectorAll('button').map((button) => button.getAttribute('aria-label')), [
			COPY.newProgram, COPY.importProgram, COPY.exportProgram, DELETE_PROGRAM,
		]);
		assert.equal(programs.querySelectorAll('button').length, 4);
		assert.equal(fixture.button(COPY.exportProgram).hasAttribute('disabled'), true);
		assert.equal(fixture.button(DELETE_PROGRAM).hasAttribute('disabled'), true);

		await click(fixture.button(COPY.newProgram));
		assert.deepEqual(fixture.scripts.list().map(({ name }) => name), [COPY.newProgram]);
		assert.equal(fixture.selectedProgramName(), COPY.newProgram);
		assert.equal(fixture.selectedMacroName(), null);
		assert.equal(fixture.button(COPY.exportProgram).hasAttribute('disabled'), false);
		assert.equal(fixture.button(DELETE_PROGRAM).hasAttribute('disabled'), false);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('deleting a program selects its next neighbor, then its previous neighbor, then a saved macro', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await act(async () => {
			fixture.scripts.save({ name: 'Program A', source: 'await sound.select.all();' });
			fixture.scripts.save({ name: 'Program B', source: 'await sound.select.none();' });
			fixture.scripts.save({ name: 'Program C', source: 'await sound.select.all();' });
			await Promise.resolve();
		});
		await click(fixture.program('Program B'));
		await click(fixture.button(DELETE_PROGRAM));
		assert.deepEqual(fixture.programNames(), ['Program A', 'Program C']);
		assert.equal(fixture.selectedProgramName(), 'Program C');
		assert.equal(fixture.scriptNameInput().value, 'Program C');

		await click(fixture.button(DELETE_PROGRAM));
		assert.deepEqual(fixture.programNames(), ['Program A']);
		assert.equal(fixture.selectedProgramName(), 'Program A');
		assert.equal(fixture.scriptNameInput().value, 'Program A');

		await click(fixture.button(DELETE_PROGRAM));
		assert.deepEqual(fixture.scripts.list(), []);
		assert.equal(fixture.selectedProgramName(), null);
		assert.equal(fixture.selectedMacroName(), 'Portable chain');
		assert.deepEqual(fixture.effectNames(), ['Invert']);
		assert.equal(fixture.button(COPY.exportProgram).hasAttribute('disabled'), true);
		assert.equal(fixture.button(DELETE_PROGRAM).hasAttribute('disabled'), true);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('deleting the final program with no macros shows the unselected hint', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await click(fixture.button(ENGLISH_COPY.deleteMacro));
		await click(fixture.button(COPY.newProgram));
		await click(fixture.button(DELETE_PROGRAM));
		assert.deepEqual(fixture.scripts.list(), []);
		assert.equal(fixture.selectedProgramName(), null);
		assert.equal(fixture.selectedMacroName(), null);
		assert.ok(fixture.find('[data-macro-unselected]'));
		assert.equal(fixture.button(ENGLISH_COPY.runMacro).hasAttribute('disabled'), true);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('creating and importing a macro while a program is selected opens the macro', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await click(fixture.button(COPY.newProgram));
		await click(fixture.button(ENGLISH_COPY.newMacro));
		assert.equal(fixture.selectedProgramName(), null);
		assert.equal(fixture.selectedMacroName(), ENGLISH_COPY.untitledMacro);
		assert.deepEqual(fixture.effectNames(), []);
		assert.equal(fixture.button(DELETE_PROGRAM).hasAttribute('disabled'), true);

		await click(fixture.program(COPY.newProgram));
		await changeFile(fixture.importInput(), new File(['Invert:\n'], 'Imported chain.txt'));
		assert.equal(fixture.selectedProgramName(), null);
		assert.equal(fixture.selectedMacroName(), 'Imported chain');
		assert.deepEqual(fixture.effectNames(), ['Invert']);
		assert.equal(fixture.button(COPY.exportProgram).hasAttribute('disabled'), true);
		assert.deepEqual(fixture.scripts.list().map(({ name }) => name), [COPY.newProgram]);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});
