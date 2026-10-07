/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SoundscaperMasteringSequenceDialog from '../src/common/editor/ui/dialogs/SoundscaperMasteringSequenceDialog.tsx';
import { SOUNDSCAPER_MASTERING_SEQUENCE_COPY } from '../src/common/editor/ui/soundscaper-mastering-sequence-copy.ts';
import type { DocumentMasteringSequenceDocumentSnapshot, DocumentMasteringSequenceEntrySnapshot, DocumentMasteringSequenceSnapshot } from '../src/common/editor/controller/document/document-mastering-sequence-snapshot.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

function entry(id: string): DocumentMasteringSequenceEntrySnapshot {
	return { id, annotationId: id, title: id, titleOverride: null, gapBeforeFrames: 0,
		fadeInFrames: 0, fadeOutFrames: 0, metadata: {}, durationFrames: 48_000 };
}

function sequence(entries: readonly DocumentMasteringSequenceEntrySnapshot[]): DocumentMasteringSequenceSnapshot {
	return { id: 'album', name: 'Album', sequenceId: 'main', entries, deliverable: true, issues: [], totalFrames: 48_000 };
}

for (const operation of ['sequence', 'entry', 'last-entry'] as const) {
	test(`mastering ${operation} deletion hands focus to a surviving authoring control`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		let finish: () => void = () => { throw new Error('The operation has not begun.'); };
		const pending = new Promise<void>(resolve => { finish = resolve; });
		const project = createSoundscaperProject({ id: 'mastering' });
		const controller = { actions: { edit: { commit: () => pending } } };
		const render = async (sequences: readonly DocumentMasteringSequenceSnapshot[]): Promise<void> => {
			const document: DocumentMasteringSequenceDocumentSnapshot = {
				primarySequenceId: 'main', sequences, regions: [{ id: 'region', name: 'Region', startFrame: 0, endFrame: 48_000 }],
			};
			await act(async () => { root.render(<SoundscaperMasteringSequenceDialog controller={controller}
				snapshot={{ project, masteringSequences: document }} copy={SOUNDSCAPER_MASTERING_SEQUENCE_COPY}
				run={action => action()} onClose={() => undefined} />); });
		};
		try {
			await render([sequence(operation === 'last-entry' ? [entry('first')] : [entry('first'), entry('second')])]);
			const removeLabel = operation === 'sequence' ? 'Remove sequence' : 'Remove entry';
			const remove = dom.container.querySelectorAll('button').find(node => node.textContent === removeLabel);
			assert.ok(remove);
			remove.focus();
			await act(async () => { reactProps(remove).onClick?.({}); });
			await render(operation === 'sequence' ? [] : [sequence(operation === 'entry' ? [entry('second')] : [])]);
			assert.equal(remove.isConnected, false);
			document.body.focus();
			await act(async () => { finish(); await pending; });
			const expectedLabel = operation === 'sequence' ? 'New sequence' : operation === 'entry' ? 'Remove entry' : 'Add region';
			const target = dom.container.querySelectorAll('button').find(node => node.textContent === expectedLabel);
			assert.ok(target);
			assert.equal(document.activeElement, target);
		} finally {
			await act(async () => { root.unmount(); });
			dom.restore();
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}
