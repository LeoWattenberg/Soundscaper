/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The receiving page's archive picker, exercised for the retry a visitor makes.
 *
 * A file input only raises `change` when its value changes, so a picker that
 * keeps the previous selection cannot be handed the same archive twice. That is
 * exactly the second attempt someone makes after an import reports a failure,
 * or after they re-export the archive under the name they already picked, and a
 * picker that silently ignores it looks like a dead page.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTransferView } from '../src/common/transfer/transfer-page-view.ts';
import { FakeDocument, type FakeElement, settle } from './project-transfer-page-fixture.ts';

function fileInput(document: FakeDocument): FakeElement {
	const input = document.body.querySelector('input[type=file]');
	assert.ok(input, 'the view must offer a file input');
	return input;
}

function change(input: FakeElement): void {
	for (const listener of input.listeners.get('change') ?? []) listener();
}

function archive(name: string) {
	return { name, arrayBuffer: async () => new ArrayBuffer(0) };
}

test('the archive picker is re-armed as it is read, so the same file can be chosen again', async () => {
	const document = new FakeDocument();
	const runs: string[][] = [];
	const view = createTransferView(document as unknown as Document, 'Receive', 'Summary');
	view.files('Import downloaded .scape archives', '.scape', async (files) => {
		runs.push(files.map(({ name }) => name));
	});

	const input = fileInput(document);
	input.files = [archive('mix.scape')];
	input.value = 'C:\\fakepath\\mix.scape';
	change(input);

	assert.equal(
		input.value,
		'',
		'the control must be cleared while the selection is read, so an identical second choice still raises change',
	);
	await settle();
	assert.deepEqual(runs, [['mix.scape']], 'the cleared control must not cost the page its selection');

	input.files = [archive('mix.scape')];
	input.value = 'C:\\fakepath\\mix.scape';
	change(input);
	await settle();
	assert.deepEqual(runs, [['mix.scape'], ['mix.scape']]);
});

test('an empty selection neither imports nor leaves a stale value behind', async () => {
	const document = new FakeDocument();
	const runs: string[][] = [];
	const view = createTransferView(document as unknown as Document, 'Receive', 'Summary');
	view.files('Import downloaded .scape archives', '.scape', async (files) => {
		runs.push(files.map(({ name }) => name));
	});

	const input = fileInput(document);
	input.files = [];
	input.value = 'C:\\fakepath\\mix.scape';
	change(input);
	await settle();

	assert.deepEqual(runs, []);
	assert.equal(input.value, '');
});
