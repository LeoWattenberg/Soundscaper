/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SoundscaperMasteringSequenceEditor from '../src/common/editor/ui/dialogs/SoundscaperMasteringSequenceEditor.tsx';
import SoundscaperMasteringSequenceDialog from '../src/common/editor/ui/dialogs/SoundscaperMasteringSequenceDialog.tsx';
import { SOUNDSCAPER_MASTERING_SEQUENCE_COPY } from '../src/common/editor/ui/soundscaper-mastering-sequence-copy.ts';
import type { DocumentMasteringSequenceSnapshot } from '../src/common/editor/controller/document/document-mastering-sequence-snapshot.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

function sequence(id: string, name: string): DocumentMasteringSequenceSnapshot {
	return { id, name, sequenceId: 'main', entries: [], deliverable: true, issues: [], totalFrames: 0 };
}

test('mastering name publication and Undo update the focused field without replacing it', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const render = async (sequences: readonly DocumentMasteringSequenceSnapshot[]): Promise<void> => {
		await act(async () => { root.render(<SoundscaperMasteringSequenceEditor
			copy={SOUNDSCAPER_MASTERING_SEQUENCE_COPY} disabled={false} sequences={sequences}
			regions={[]} primarySequenceId="main" createId={() => 'new'} onOperation={() => undefined} />); });
	};
	try {
		await render([sequence('album', 'Original')]);
		const input = dom.one('input');
		input.focus();
		await act(async () => { reactProps(input).onChange?.({ currentTarget: { value: 'Album order' } }); });
		await render([sequence('album', 'Album order')]);
		assert.equal(dom.one('input'), input, 'a successful rename retains the actual keyboard target');
		assert.equal(input.ownerDocument.activeElement, input);
		assert.equal(input.value, 'Album order');
		await act(async () => { reactProps(input).onChange?.({ currentTarget: { value: 'Album order encore' } }); });
		await render([sequence('album', 'Album order')]);
		assert.equal(input.value, 'Album order encore', 'an unrelated publication preserves an unsubmitted draft');
		await render([sequence('album', 'Original')]);
		assert.equal(dom.one('input'), input);
		assert.equal(input.value, 'Original', 'Undo restores the authoritative name on the same field');
		await render([sequence('other', 'Other album')]);
		assert.equal(dom.one('input').value, 'Other album', 'changing the selected sequence refreshes its name');
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});

test('the mastering transaction restores a surviving field after its temporary disabled state', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let finish: () => void = () => { throw new Error('The mastering operation has not started.'); };
	const operation = new Promise<void>(resolve => { finish = resolve; });
	try {
		await act(async () => { root.render(<SoundscaperMasteringSequenceDialog
			controller={{ actions: { edit: { commit: () => operation } } }}
			snapshot={{ project: createSoundscaperProject({ id: 'mastering' }) }}
			copy={SOUNDSCAPER_MASTERING_SEQUENCE_COPY} run={action => action()} onClose={() => undefined} />); });
		const button = dom.container.querySelectorAll('button').find(node => node.textContent === 'New sequence');
		assert.ok(button);
		button.focus();
		await act(async () => { reactProps(button).onClick?.({}); });
		assert.equal(dom.one('[data-soundscaper-mastering-sequence-editor]').hasAttribute('disabled'), true);
		document.body.focus();
		await act(async () => { finish(); await operation; });
		assert.equal(document.activeElement, button, 'settling the operation returns keyboard use to its surviving control');
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
