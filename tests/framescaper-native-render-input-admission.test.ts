/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	admitFramescaperNativeRenderInputAuthorityNativeMedia as admitAuthority,
	admitFramescaperNativeRenderInputRequestNativeMedia as admitRequest,
} from '../src/framescaper/editor-native-render-input-admission.ts';
import {
	createFramescaperNativeRenderInputProducerNativeMedia as createProducer,
} from '../src/framescaper/editor-native-render-input-producer.ts';
import {
	createFramescaperNativeRenderInputStreamProducer as createStreamProducer,
} from '../src/framescaper/editor-native-render-input-stream-producer.ts';

type Data = Record<string, unknown>;

function authority(overrides: Data = {}): Data {
	return {
		authority: { begin: () => ({}) },
		store: { loadMediaAsset: async () => null },
		...overrides,
	};
}

function request(overrides: Data = {}): Data {
	return {
		planPayload: '{}',
		planFingerprint: 'ab'.repeat(32),
		projectId: 'project-1',
		projectRevision: 3,
		...overrides,
	};
}

test('a complete render-input authority is admitted unchanged', () => {
	const value = authority();

	assert.equal(admitAuthority(value), value);
});

test('an authority missing its begin port or media store is refused', () => {
	assert.throws(() => admitAuthority(authority({ authority: {} })), /authority is incomplete/u);
	assert.throws(() => admitAuthority(authority({ store: {} })), /authority is incomplete/u);
	assert.throws(() => admitAuthority(null), TypeError);
	assert.throws(() => admitAuthority([]), TypeError);
});

test('a well-formed render-input request is admitted', () => {
	const admitted = admitRequest(request()) as unknown as Data;

	assert.equal(admitted.projectId, 'project-1');
	assert.equal(admitted.projectRevision, 3);
	assert.equal(admitted.planFingerprint, 'ab'.repeat(32));
});

test('a render-input request is a closed record of exactly its four fields', () => {
	assert.throws(() => admitRequest(request({ extra: 1 })), /request is invalid/u);
	assert.throws(
		() => admitRequest({ planPayload: '{}', planFingerprint: 'ab'.repeat(32), projectId: 'p' }),
		/request is invalid/u,
	);
});

test('a render-input request refuses a malformed plan, digest or identity', () => {
	assert.throws(() => admitRequest(request({ planPayload: 1 })), /request is invalid/u);
	assert.throws(() => admitRequest(request({ planFingerprint: 'zz' })), /request is invalid/u);
	assert.throws(() => admitRequest(request({ projectId: '!!' })), /request is invalid/u);
});

test('a render-input revision must be a non-negative whole number', () => {
	for (const projectRevision of [-1, 1.5, Number.NaN]) {
		assert.throws(() => admitRequest(request({ projectRevision })), /request is invalid/u);
	}
});

test('a producer is composed from an admitted authority', () => {
	assert.equal(typeof createProducer(PROFILE, authority() as never), 'function');
});

test('a producer refuses an incomplete authority before any render begins', () => {
	assert.throws(
		() => createProducer(PROFILE, { authority: {}, store: {} } as never),
		/authority is incomplete/u,
	);
});

test('a stream producer requires the exact profile and authority composition', () => {
	assert.equal(typeof createStreamProducer(PROFILE, authority() as never), 'function');
	assert.throws(() => createStreamProducer({}, authority() as never), TypeError);
	assert.throws(
		() => createStreamProducer(PROFILE, null as never),
		/requires its exact authority composition/u,
	);
});
