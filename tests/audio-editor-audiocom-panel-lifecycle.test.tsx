/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import AudiocomPanelContainer from '../src/common/editor/ui/workspace/AudiocomPanelContainer.tsx';
import {
	audiocomPanelSession,
	type AudiocomApiClient,
	type AudiocomPanelSession,
	type AudiocomPanelSnapshot,
} from '../src/common/editor/controller/import/audiocom-panel-session.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('audio.com container forwards listening preferences, actions, visibility, and owner cleanup', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const calls: unknown[] = [];
	const snapshot: AudiocomPanelSnapshot = {
		auth: { status: 'disconnected' }, search: { query: '', page: 1, hasNext: false, status: 'idle', results: [] },
		previewingId: null, uploadQueue: { active: false, items: [] },
	};
	const session: AudiocomPanelSession = {
		getSnapshot: () => snapshot, subscribe: () => () => undefined,
		initialize: () => { calls.push('initialize'); return Promise.resolve(); },
		connect: () => { calls.push('connect'); return Promise.resolve(); },
		disconnect: () => Promise.resolve(), search: () => Promise.resolve(), preview: () => Promise.resolve(),
		stopPreview: () => undefined, enqueueFiles: () => [], publish: () => Promise.resolve(),
		retry: () => undefined, cancel: () => undefined, remove: () => undefined,
		setActive: (active) => { calls.push({ active }); },
		setListeningPreferences: (gain, outputDeviceId) => { calls.push({ gain, outputDeviceId }); },
		dispose: () => { calls.push('dispose'); },
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<AudiocomPanelContainer session={session} copy={{}} snapshot={{
			locale: 'en', audioDevices: { playbackGain: 0.3, preferredOutputDeviceId: 'speakers-b' },
		}} />));
		assert.deepEqual(calls, ['initialize', { active: true }, { gain: 0.3, outputDeviceId: 'speakers-b' }]);
		const connect = dom.container.querySelectorAll('button').find((node) => node.textContent === 'Connect to audio.com');
		assert.ok(connect);
		await act(async () => reactProps(connect).onClick());
		assert.equal(calls.at(-1), 'connect');
		await act(async () => root.render(<AudiocomPanelContainer session={session} copy={{}} panelActive={false} snapshot={{
			locale: 'en', audioDevices: { playbackGain: 0.5, preferredOutputDeviceId: 'native:system-default' },
		}} />));
		assert.deepEqual(calls.slice(-2), [{ active: false }, { gain: 0.5, outputDeviceId: '' }]);
		await act(async () => root.unmount());
		assert.equal(calls.at(-1), 'dispose');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});

test('closing and reopening the owner panel retains search and queued files without reconnecting', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let accountChecks = 0;
	const owner = {};
	const client: AudiocomApiClient = {
		session: () => { accountChecks += 1; return Promise.resolve({ connected: true }); },
		startOAuth: () => Promise.reject(new Error('Unexpected authorization')),
		pollOAuth: () => Promise.resolve(null), disconnect: () => Promise.resolve(),
		reserveAuthorization: () => ({ open: () => undefined, close: () => undefined }),
		search: () => Promise.resolve({ page: 1, hasNext: false, results: [{
			id: '1', title: 'Retained rain', authorName: 'Recorder', username: 'recorder',
			url: 'https://audio.com/recorder/audio/rain', description: '', license: 'arr', isDownloadable: false,
			durationSeconds: 2,
		}] }),
		upload: () => Promise.reject(new Error('Unexpected upload')),
	};
	const session = audiocomPanelSession(owner, { client });
	await session.initialize();
	await session.search({ query: 'rain', page: 1 });
	session.enqueueFiles([new File(['rain'], 'retained.wav', { type: 'audio/wav' })]);
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		const panel = <AudiocomPanelContainer controller={owner} copy={{}} snapshot={{ locale: 'en' }} />;
		await act(async () => root.render(panel));
		await act(async () => root.render(null));
		assert.equal(session.getSnapshot().search.results[0]?.title, 'Retained rain');
		assert.equal(session.getSnapshot().uploadQueue.items[0]?.fileName, 'retained.wav');
		await act(async () => root.render(panel));
		const links = dom.container.querySelectorAll('a');
		assert.ok(links.some((link) => link.textContent === 'Retained rain'));
		assert.ok(dom.container.querySelectorAll('strong').some((name) => name.textContent === 'retained.wav'));
		assert.equal(accountChecks, 1);
	} finally {
		await act(async () => root.unmount());
		session.dispose();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
