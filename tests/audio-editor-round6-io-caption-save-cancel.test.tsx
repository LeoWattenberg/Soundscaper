/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import FramescaperFinishingDialog from '../src/common/editor/ui/dialogs/FramescaperFinishingDialog.tsx';
import { importFramescaperCaptionSidecar } from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const cancelled of [false, true]) test(`caption export reports a ${cancelled ? 'cancelled' : 'completed'} save without editing its document`, async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const base = { schemaFamily: 'framescaper', schemaVersion: 1, id: 'project', sampleRate: 48_000,
		primarySequenceId: 'main', sequences: [{ id: 'main' }], videoCaptionTracks: [] };
	const track = importFramescaperCaptionSidecar({ project: base, format: 'srt',
		text: '1\n00:00:00,100 --> 00:00:00,500\nA normal caption\n', trackId: 'captions',
		sequenceId: 'main', trackName: 'Captions', language: 'en' }).result.track;
	const project = { ...base, videoCaptionTracks: [track] };
	const prior = JSON.stringify(project);
	const saved: string[] = [];
	let commits = 0;
	try {
		await act(async () => { root.render(<FramescaperFinishingDialog surface="captions"
			controller={{ actions: { edit: { commit: () => { commits += 1; } } } }}
			project={project} editingBlocked={false} readOnly={false} copy={{}}
			fileService={{ saveFile: (request) => { saved.push(request.text); return { cancelled }; } }}
			run={(operation) => operation()} onClose={() => undefined} />); });
		const button = dom.container.querySelectorAll('button').find((node) => node.textContent === 'Export selected track');
		assert.ok(button);
		await act(async () => {
			void reactProps(button).onClick({});
			await Promise.resolve(); await Promise.resolve();
		});
		assert.equal(dom.one('[role="status"]').textContent,
			cancelled ? 'Caption export cancelled.' : '2 interchange losses recorded.');
		assert.equal(saved.length, 1);
		assert.match(saved[0] ?? '', /A normal caption/u);
		assert.equal(Boolean(reactProps(button).disabled), false);
		assert.equal(commits, 0);
		assert.equal(JSON.stringify(project), prior);
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
	}
});
