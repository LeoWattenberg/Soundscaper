/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperCaptureSourceAdapterRouter,
	isWebVcrRecoveryOwner,
} from '../src/common/editor/controller/framescaper-capture-source-adapter-router.ts';

test('capture adapter routing keeps source, display authorization, recorder, and recovery ownership together', async () => {
	const events: string[] = [];
	const devices = adapter('devices', events);
	const webVcr = adapter('web-vcr', events);
	const router = createFramescaperCaptureSourceAdapterRouter([devices, webVcr]);

	assert.equal(router.activeId, 'devices');
	await router.sourcePort.probe({ signal: new AbortController().signal, embedded: false });
	router.select('web-vcr');
	await router.displaySelection.authorize({ generation: 7, roles: ['display', 'system-audio'], sourceToken: null });
	const lease = await router.sourcePort.openPreview({
		signal: new AbortController().signal,
		userActionGeneration: 7,
		roles: ['display', 'system-audio'],
	});
	const source = lease.sources[0]!;
	const identity = router.sourceIdentity(source, (prefix) => `${prefix}-one`);
	await router.createRecorder({
		sessionId: 'session', streamId: 'stream', sourceId: identity, source,
		monitoring: false, inputGain: 1,
		onPacket: async () => undefined, onError: () => undefined, onBackpressure: () => undefined,
	});
	await lease.dispose();

	assert.equal(isWebVcrRecoveryOwner(identity), true);
	assert.deepEqual(events, [
		'devices:probe',
		'web-vcr:authorize:7',
		'web-vcr:open:7',
		'web-vcr:recorder',
		'web-vcr:dispose',
	]);
});

test('capture adapter routing rejects missing, duplicate, unavailable, and unowned authorities', () => {
	const events: string[] = [];
	assert.throws(() => createFramescaperCaptureSourceAdapterRouter([]), /required/iu);
	assert.throws(() => createFramescaperCaptureSourceAdapterRouter([
		adapter('devices', events), adapter('devices', events),
	]), /duplicate/iu);
	const router = createFramescaperCaptureSourceAdapterRouter([adapter('devices', events)]);
	assert.throws(() => router.select('web-vcr'), /unavailable/iu);
	assert.throws(() => router.sourceIdentity(source(), () => 'source'), /no adapter owner/iu);
});

function adapter(id: 'devices' | 'web-vcr', events: string[]) {
	return {
		id,
		sourcePort: {
			async probe() {
				events.push(`${id}:probe`);
				return { status: 'available' as const, sourceRoles: ['display' as const] };
			},
			async enumerate() { return { devices: [] }; },
			async openPreview(request: Readonly<{ userActionGeneration: number }>) {
				events.push(`${id}:open:${request.userActionGeneration}`);
				return {
					sources: [source()],
					async dispose() { events.push(`${id}:dispose`); },
				};
			},
		},
		displaySelection: {
			mode: 'source-list' as const,
			async listSources() { return []; },
			async authorize(request: Readonly<{ generation: number }>) {
				events.push(`${id}:authorize:${request.generation}`);
			},
		},
		createRecorder() {
			events.push(`${id}:recorder`);
			return recorder();
		},
	};
}

function source() {
	return Object.freeze({
		sourceId: 'source', role: 'display' as const,
		stream: Object.freeze({}), track: Object.freeze({}),
		settings: Object.freeze({}), capabilities: Object.freeze({}),
	});
}

function recorder() {
	return Object.freeze({
		format: { kind: 'encoded-media' as const, mimeType: 'video/webm' },
		start() {}, pause: () => true, resume: () => true, stop() {}, dispose() {},
	});
}
