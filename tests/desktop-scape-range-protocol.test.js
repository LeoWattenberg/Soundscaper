/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
	READ_PROFILE_MATERIALIZED_V1,
	READ_PROFILE_SCAPE_RANGE_V1,
	SCAPE_PROJECT_MIME_TYPE,
} from '../desktop/constants.js';
import { createProtocolHandler } from '../desktop/protocol.js';

const MAX_SCAPE_RANGE_BYTES = 16 * 1024 ** 2;

function capabilityUrl(profile, id, name = 'project.scape') {
	return `soundscaper-app://bundle/_desktop/read/${profile}/${id}/${encodeURIComponent(name)}`;
}

function capabilityStore({
	id = 'a'.repeat(64),
	profile = READ_PROFILE_SCAPE_RANGE_V1,
	size = 32 * 1024 ** 2,
	body = Buffer.from('range'),
} = {}) {
	const calls = {
		acquire: [],
		close: 0,
		get: [],
		retire: 0,
		stream: [],
	};
	const descriptor = Object.freeze({
		id,
		readProfile: profile,
		size,
		mimeType: profile === READ_PROFILE_SCAPE_RANGE_V1
			? SCAPE_PROJECT_MIME_TYPE
			: 'application/octet-stream',
	});
	const lease = {
		...descriptor,
		createReadStream(options) {
			calls.stream.push(options);
			return Readable.from([body]);
		},
		async close() {
			calls.close += 1;
		},
		async retire() {
			calls.retire += 1;
		},
	};
	const store = {
		get(candidate) {
			calls.get.push(candidate);
			return candidate === id ? descriptor : null;
		},
		acquireRequest(candidate, expectedProfile) {
			calls.acquire.push([candidate, expectedProfile]);
			return candidate === id && expectedProfile === profile ? lease : null;
		},
	};
	return { calls, descriptor, id, store };
}

function handlerFor(store) {
	return createProtocolHandler({
		rendererRoot: '/unused-renderer',
		runtimeRoot: '/unused-runtime',
		readCapabilities: store,
	});
}

test('Scape profile serves only one explicit bounded range through an expected-profile lease', async () => {
	const fixture = capabilityStore({ body: Buffer.from('bounded') });
	const handler = handlerFor(fixture.store);
	const response = await handler(new Request(
		capabilityUrl(READ_PROFILE_SCAPE_RANGE_V1, fixture.id),
		{ headers: { Range: 'bytes=1024-1030' } },
	));

	assert.equal(response.status, 206);
	assert.equal(response.headers.get('Content-Range'), `bytes 1024-1030/${fixture.descriptor.size}`);
	assert.equal(response.headers.get('Content-Length'), '7');
	assert.deepEqual(fixture.calls.acquire, [[fixture.id, READ_PROFILE_SCAPE_RANGE_V1]]);
	assert.deepEqual(fixture.calls.stream, [{ start: 1024, end: 1030, autoClose: false }]);
	assert.equal(await response.text(), 'bounded');
	assert.equal(fixture.calls.close, 1);
	assert.equal(fixture.calls.retire, 0);
});

test('Scape profile rejects non-GET and non-explicit or oversized ranges before lease acquisition', async (context) => {
	const cases = [
		{ name: 'HEAD', method: 'HEAD', range: 'bytes=0-0', status: 405 },
		{ name: 'missing range', method: 'GET', status: 416 },
		{ name: 'suffix range', method: 'GET', range: 'bytes=-10', status: 416 },
		{ name: 'open range', method: 'GET', range: 'bytes=10-', status: 416 },
		{ name: 'multiple ranges', method: 'GET', range: 'bytes=0-1,4-5', status: 416 },
		{ name: 'range ends beyond EOF', method: 'GET', range: `bytes=${32 * 1024 ** 2 - 1}-${32 * 1024 ** 2}`, status: 416 },
		{ name: 'oversized range', method: 'GET', range: `bytes=0-${MAX_SCAPE_RANGE_BYTES}`, status: 416 },
	];
	for (const scenario of cases) {
		await context.test(scenario.name, async () => {
			const fixture = capabilityStore();
			const handler = handlerFor(fixture.store);
			const response = await handler(new Request(
				capabilityUrl(READ_PROFILE_SCAPE_RANGE_V1, fixture.id),
				{
					method: scenario.method,
					headers: scenario.range ? { Range: scenario.range } : undefined,
				},
			));

			assert.equal(response.status, scenario.status);
			assert.deepEqual(fixture.calls.acquire, []);
			assert.deepEqual(fixture.calls.stream, []);
			assert.equal(fixture.calls.close, 0);
			assert.equal(fixture.calls.retire, 0);
		});
	}
});

test('profile and descriptor mismatches fail before acquiring a request', async (context) => {
	for (const scenario of [
		{ name: 'unknown URL profile', urlProfile: 'unknown-v1', descriptorProfile: READ_PROFILE_SCAPE_RANGE_V1 },
		{ name: 'URL profile differs from descriptor', urlProfile: READ_PROFILE_MATERIALIZED_V1, descriptorProfile: READ_PROFILE_SCAPE_RANGE_V1 },
	]) {
		await context.test(scenario.name, async () => {
			const fixture = capabilityStore({ profile: scenario.descriptorProfile });
			const handler = handlerFor(fixture.store);
			const response = await handler(new Request(
				capabilityUrl(scenario.urlProfile, fixture.id),
				{ headers: { Range: 'bytes=0-4' } },
			));

			assert.equal(response.status, 404);
			assert.deepEqual(fixture.calls.acquire, []);
			assert.deepEqual(fixture.calls.stream, []);
		});
	}
});

test('materialized profile preserves full, HEAD, suffix, and open-ended reads', async (context) => {
	for (const scenario of [
		{ name: 'full GET', method: 'GET', status: 200, expectedRange: null },
		{ name: 'HEAD', method: 'HEAD', status: 200, expectedRange: null },
		{ name: 'suffix', method: 'GET', range: 'bytes=-4', status: 206, expectedRange: { start: 6, end: 9 } },
		{ name: 'open ended', method: 'GET', range: 'bytes=6-', status: 206, expectedRange: { start: 6, end: 9 } },
	]) {
		await context.test(scenario.name, async () => {
			const fixture = capabilityStore({
				profile: READ_PROFILE_MATERIALIZED_V1,
				size: 10,
				body: Buffer.from('data'),
			});
			const response = await handlerFor(fixture.store)(new Request(
				capabilityUrl(READ_PROFILE_MATERIALIZED_V1, fixture.id, 'input.wav'),
				{
					method: scenario.method,
					headers: scenario.range ? { Range: scenario.range } : undefined,
				},
			));

			assert.equal(response.status, scenario.status);
			assert.deepEqual(fixture.calls.acquire, [[fixture.id, READ_PROFILE_MATERIALIZED_V1]]);
			if (scenario.method === 'HEAD') {
				assert.deepEqual(fixture.calls.stream, []);
				assert.equal(fixture.calls.close, 1);
				return;
			}
			const expected = scenario.expectedRange ?? { start: 0, end: 9 };
			assert.deepEqual(fixture.calls.stream, [{ ...expected, autoClose: false }]);
			await response.arrayBuffer();
			assert.equal(fixture.calls.close, 1);
		});
	}
});

test('invalid materialized range is rejected before lease acquisition', async () => {
	const fixture = capabilityStore({ profile: READ_PROFILE_MATERIALIZED_V1, size: 10 });
	const response = await handlerFor(fixture.store)(new Request(
		capabilityUrl(READ_PROFILE_MATERIALIZED_V1, fixture.id, 'input.wav'),
		{ headers: { Range: 'bytes=20-30' } },
	));

	assert.equal(response.status, 416);
	assert.deepEqual(fixture.calls.acquire, []);
	assert.deepEqual(fixture.calls.stream, []);
});
