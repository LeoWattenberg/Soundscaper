/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createDocumentMasteringSequenceSnapshot } from
	'../src/common/editor/controller/document-mastering-sequence-snapshot.ts';
import SoundscaperMasteringSequenceDialog from
	'../src/common/editor/ui/dialogs/SoundscaperMasteringSequenceDialog.tsx';
import { SOUNDSCAPER_MASTERING_SEQUENCE_COPY } from
	'../src/common/editor/ui/soundscaper-mastering-sequence-copy.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

test('the standalone mastering dialog renders only its focused editor and supports inspection while read-only', () => {
	const project = masteringProject();
	const markup = renderToStaticMarkup(<SoundscaperMasteringSequenceDialog
		isOpen
		controller={{ actions: { edit: { commit: () => undefined } } }}
		snapshot={{
			project,
			masteringSequences: createDocumentMasteringSequenceSnapshot(project),
			readOnly: true,
		}}
		copy={SOUNDSCAPER_MASTERING_SEQUENCE_COPY}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>);

	assert.match(markup, /role="dialog"[^>]*aria-label="Mastering sequences"/u);
	assert.match(markup, /data-soundscaper-mastering-sequence-dialog="true"/u);
	assert.match(markup, /data-soundscaper-mastering-sequence-editor="sequences"/u);
	assert.match(markup, /<fieldset[^>]*disabled=""/u);
	assert.match(markup, /Read-only projects can be inspected/u);
	assert.doesNotMatch(markup, /role="tablist"|data-soundscaper-production-dialog/u);
});

test('the standalone mastering dialog commits ordinary mastering commands', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const project = masteringProject();
	const committed: unknown[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<SoundscaperMasteringSequenceDialog
			isOpen
			controller={{ actions: { edit: { commit: (operation) => { committed.push(operation); } } } }}
			snapshot={{ project, masteringSequences: createDocumentMasteringSequenceSnapshot(project) }}
			copy={SOUNDSCAPER_MASTERING_SEQUENCE_COPY}
			run={(operation) => operation()}
			onClose={() => undefined}
		/>));
		await click(buttonWithText(dom.container, SOUNDSCAPER_MASTERING_SEQUENCE_COPY.newMasteringSequence));

		assert.equal(committed.length, 1);
		assert.equal((committed[0] as { type: string }).type, 'mastering-sequence/add');
		assert.equal(
			(committed[0] as { sequence: { sequenceId: string } }).sequence.sequenceId,
			project.primarySequenceId,
		);
		assert.match(dom.container.textContent, /Mastering sequence updated/u);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function masteringProject() {
	const base = createSoundscaperProject({
		id: 'mastering-dialog', title: 'Mastering', now: '2026-09-01T00:00:00.000Z',
		tracks: [{ type: 'audio', id: 'track-a', name: 'Track A' }],
	} as never);
	return createSoundscaperProject({
		...base,
		masteringSequences: [],
	} as never);
}

function buttonWithText(root: ReactTestElement, text: string): ReactTestElement {
	const button = root.querySelectorAll('button').find((candidate) => candidate.textContent === text);
	assert.ok(button, `Missing button ${text}.`);
	return button;
}

async function click(button: ReactTestElement): Promise<void> {
	await act(async () => {
		void reactProps(button).onClick({});
		await Promise.resolve();
		await Promise.resolve();
	});
}
