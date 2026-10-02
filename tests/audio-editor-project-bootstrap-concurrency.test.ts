/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectBootstrapService } from '../src/common/editor/controller/document/internal/project/project-bootstrap-service.ts';
import { createFixture } from './helpers/audio-editor-project-bootstrap-fixture.ts';

function readGate() {
	let release: () => void = () => undefined;
	const promise = new Promise<void>((resolve) => { release = resolve; });
	return { promise, release };
}

test('bootstrap starts its independent settings reads together before awaiting storage', async () => {
	const fixture = createFixture();
	const gate = readGate();
	const requested: string[] = [];
	const service = createProjectBootstrapService({
		...fixture.runtime,
		store: {
			...fixture.runtime.store,
			async loadSetting(key, fallback: unknown = null) {
				requested.push(key);
				await gate.promise;
				return fixture.runtime.store.loadSetting(key, fallback);
			},
		},
	});
	const bootstrap = service.bootstrap(fixture.lifetime.capture());
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	const pendingReads = requested.length;
	gate.release();
	await bootstrap;
	assert.equal(pendingReads, 17, 'each storage latency is paid once, rather than seventeen times');
	assert.equal(new Set(requested).size, 17, 'each setting is read once');
	assert.equal(fixture.state.showVerticalRulers, true);
	assert.equal(fixture.state.scrollViewToPlayhead, true);
	assert.equal(fixture.state.playbackOnRulerClick, true);
	assert.equal(fixture.state.recordingInputGain, 1);
	assert.ok(fixture.events.includes('new-project'));
});

test('persisted false and null settings retain their values despite true-valued defaults', async () => {
	const fixture = createFixture();
	fixture.settings.set('product:timeline-show-vertical-rulers', false);
	fixture.settings.set('product:timeline-update-while-playing', null);
	fixture.settings.set('product:timeline-ruler-playback', false);
	await fixture.service.bootstrap(fixture.lifetime.capture());
	assert.equal(fixture.state.showVerticalRulers, false);
	assert.equal(fixture.state.scrollViewToPlayhead, false);
	assert.equal(fixture.state.playbackOnRulerClick, false);
});

test('disposal during parallel setting reads prevents project activation and publication', async () => {
	const fixture = createFixture();
	const gate = readGate();
	const service = createProjectBootstrapService({
		...fixture.runtime,
		store: {
			...fixture.runtime.store,
			async loadSetting(key, fallback: unknown = null) {
				await gate.promise;
				return fixture.runtime.store.loadSetting(key, fallback);
			},
		},
	});
	const bootstrap = service.bootstrap(fixture.lifetime.capture());
	const rejected = assert.rejects(bootstrap, { code: 'DISPOSED' });
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	fixture.lifetime.beginDisposal();
	fixture.setDisposed(true);
	gate.release();
	await rejected;
	assert.equal(fixture.events.includes('new-project'), false);
	assert.equal(fixture.events.includes('publish'), false);
});

test('a later rejected setting retains its existing fatal-read semantics', async () => {
	const fixture = createFixture();
	const failure = new Error('latency setting unavailable');
	const service = createProjectBootstrapService({
		...fixture.runtime,
		store: {
			...fixture.runtime.store,
			loadSetting(key, fallback) {
				if (key === 'recording-latency-offset-ms') return Promise.reject(failure);
				return fixture.runtime.store.loadSetting(key, fallback);
			},
		},
	});
	await assert.rejects(service.bootstrap(fixture.lifetime.capture()), (error) => error === failure);
	assert.equal(fixture.events.includes('new-project'), false);
});
