/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import MixRenderDialog from '../src/common/editor/ui/dialogs/MixRenderDialog.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('a live Mix and Render lease change blocks submission while preserving cancellation', async () => {
	const dom = installReactTestDom();
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const project = {
		schemaVersion: 17, id: 'project', title: 'Production recording', sampleRate: 48_000,
		tracks: [{ id: 'track', name: 'Recording', type: 'audio' as const, clipIds: ['clip'], effects: [], gain: 1, pan: 0 }],
		clips: [{ id: 'clip', title: 'Recording', sourceId: 'source', timelineStartFrame: 0,
			durationFrames: 20, sourceStartFrame: 0, sourceDurationFrames: 20 }],
		sources: [{ id: 'source', storageKey: 'source', name: 'Recording', mimeType: 'audio/wav',
			frameCount: 20, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000 }],
		selection: { startFrame: 0, endFrame: 20, trackIds: ['track'], clipIds: [] },
		mixer: { groups: [], sends: [], routes: {} },
	};
	let calls = 0;
	let closes = 0;
	const controller = { actions: { track: { mixAndRender: () => { calls++; } } } };
	const render = async (readOnly: boolean) => {
		const snapshot = { project, selectedTrackId: 'track', selectedClipId: null, readOnly };
		await act(async () => { root.render(<MixRenderDialog controller={controller} snapshot={snapshot}
			copy={ENGLISH_COPY} run={operation => operation()} onClose={() => { closes++; }} />); });
	};
	const action = (label: string) => {
		const button = dom.container.querySelectorAll('button').find(candidate => candidate.textContent === label);
		assert.ok(button);
		return button;
	};
	try {
		await render(false);
		assert.equal(action('Mix & Render').hasAttribute('disabled'), false);
		await render(true);
		assert.equal(action('Mix & Render').hasAttribute('disabled'), true, 'the same open dialog follows the current editing lease');
		assert.equal(action('Cancel').hasAttribute('disabled'), false, 'the unavailable operation remains dismissible');
		await act(async () => { reactProps(dom.one('form')).onSubmit({ preventDefault: () => undefined }); });
		assert.equal(calls, 0, 'a stale native submit cannot publish after the lease changes');
		assert.equal(closes, 0);
		await render(false);
		assert.equal(action('Mix & Render').hasAttribute('disabled'), false);
		await act(async () => { reactProps(dom.one('form')).onSubmit({ preventDefault: () => undefined }); });
		assert.equal(calls, 1, 'a valid editable dialog still performs its normal operation');
		assert.equal(closes, 1);
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
