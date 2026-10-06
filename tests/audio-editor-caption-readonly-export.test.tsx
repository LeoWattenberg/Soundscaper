/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import FramescaperFinishingDialog from '../src/common/editor/ui/dialogs/FramescaperFinishingDialog.tsx';
import { importFramescaperCaptionSidecar } from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';
import { createFramescaperFinishingMenuItems } from '../src/common/editor/ui/framescaper-finishing-menu.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('read-only caption export reaches the file service without admitting a document edit', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const base = { schemaFamily: 'framescaper', schemaVersion: 1, id: 'project', sampleRate: 48_000, primarySequenceId: 'main', sequences: [{ id: 'main' }], videoCaptionTracks: [] };
	const track = importFramescaperCaptionSidecar({ project: base, format: 'srt',
		text: '1\n00:00:00,000 --> 00:00:01,000\nBonjour\n', trackId: 'captions', sequenceId: 'main', trackName: 'Captions', language: 'fr' }).result.track;
	const saved: string[] = [];
	let commits = 0;
	try {
		await act(async () => { root.render(<FramescaperFinishingDialog surface="captions"
			controller={{ actions: { edit: { commit: () => { commits += 1; } } } }}
			project={{ ...base, videoCaptionTracks: [track] }} editingBlocked readOnly copy={{}}
			fileService={{ saveFile: (request) => { saved.push(request.text); } }}
			run={(operation) => operation()} onClose={() => undefined} />); });
		const exportButton = dom.container.querySelectorAll('button').find((button) => button.textContent === 'Export selected track');
		assert.ok(exportButton);
		await act(async () => {
			void reactProps(exportButton).onClick({});
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.equal(saved.length, 1, 'an existing caption export is a read operation');
		assert.match(saved[0] ?? '', /Bonjour/u);
		assert.equal(commits, 0);
		assert.equal(reactProps(dom.one('[data-framescaper-finishing-document]')).disabled, true);
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
	}
});

test('the caption menu remains reachable for read-only export while automation stays disabled', () => {
	const opened: string[] = [];
	const items = createFramescaperFinishingMenuItems({ productId: 'framescaper',
		project: { schemaFamily: 'framescaper', schemaVersion: 1 },
		capabilities: { videoCaptions: true, audioAutomation: true }, editingBlocked: true, readOnly: true,
	}, { open: (surface) => { opened.push(surface); } });
	assert.equal(items.tracks[0]?.disabled, false);
	assert.equal(items.tracks[1]?.disabled, true);
	items.tracks[0]?.onClick?.();
	assert.deepEqual(opened, ['captions']);
});
