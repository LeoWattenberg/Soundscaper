/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FramescaperVideoProxyPreviewUnavailableError,
	createFramescaperVideoProxyPreviewMediaResolverRetime as createResolver,
} from '../src/framescaper/editor-video-proxy-preview-media-retime.ts';

type Data = Record<string, unknown>;

const PROJECT: Data = Object.freeze({
	schemaFamily: 'framescaper', schemaVersion: 1, id: 'project-1', revision: 1,
});

function options(overrides: Data = {}): never {
	return {
		bodyStore: {},
		originalStore: {},
		getProject: () => PROJECT,
		getMode: () => 'auto',
		getPressure: () => 'none',
		...overrides,
	} as unknown as never;
}

function resolver(mode: string, overrides: Data = {}): (request: unknown) => Promise<unknown> {
	return createResolver(options({ getMode: () => mode, ...overrides })) as unknown as
		(request: unknown) => Promise<unknown>;
}

function request(source: Data, project: Data = PROJECT): Data {
	return { source, project };
}

function isUnavailable(reason: string): (error: unknown) => boolean {
	return (error) => {
		assert.ok(error instanceof FramescaperVideoProxyPreviewUnavailableError);
		assert.equal(error.code, 'FRAMESCAPER_PROXY_PREVIEW_UNAVAILABLE');
		assert.equal(error.reason, reason);
		return true;
	};
}

test('a source that is not identified video resolves to no proxy media', async () => {
	const resolve = resolver('auto');

	assert.equal(await resolve(request({ id: 'source-1', kind: 'audio' })), null);
	assert.equal(await resolve(request({ kind: 'video' })), null);
	assert.equal(
		await resolve(request({ id: 'source-1', kind: 'video' }, { schemaFamily: 'soundscaper' })),
		null,
	);
});

test('auto and original modes fall back silently when no attachment exists', async () => {
	const source = { id: 'source-1', kind: 'video', proxyAttachment: null };

	assert.equal(await resolver('auto')(request(source)), null);
	assert.equal(await resolver('original')(request(source)), null);
});

test('a forced proxy mode reports why no proxy could be served', async () => {
	const resolve = resolver('proxy');

	await assert.rejects(
		() => resolve(request({ id: 'source-1', kind: 'video', proxyAttachment: null })),
		isUnavailable('attachment-unavailable'),
	);
	await assert.rejects(
		() => resolve(request({ id: 'source-1', kind: 'video', proxyAttachment: { kind: 'nonsense' } })),
		isUnavailable('attachment-unavailable'),
	);
});

test('an attachment bound to a different original is refused as stale', async () => {
	const source = {
		id: 'source-1', kind: 'video', contentSha256: 'ff'.repeat(32),
		proxyAttachment: { kind: 'nonsense' },
	};

	assert.equal(await resolver('auto')(request(source)), null);
	assert.equal(await resolver('original')(request(source)), null);
	await assert.rejects(() => resolver('proxy')(request(source)), FramescaperVideoProxyPreviewUnavailableError);
});

test('trust status is reported for every source the resolver inspects', async () => {
	const observed: string[] = [];
	const resolve = createResolver(options({
		onTrustStatus: (sourceId: string) => { observed.push(sourceId); },
	})) as unknown as (value: unknown) => Promise<unknown>;

	await resolve(request({ id: 'source-1', kind: 'video', proxyAttachment: null }));
	await resolve(request({ id: 'source-2', kind: 'video', proxyAttachment: { kind: 'nonsense' } }));

	assert.deepEqual(observed, ['source-1', 'source-2']);
});

test('incomplete preview-media ports are refused at construction', () => {
	for (const override of [
		{ bodyStore: null },
		{ originalStore: null },
		{ getProject: 1 },
		{ getMode: 1 },
		{ getPressure: 1 },
		{ onTrustStatus: 1 },
	]) {
		assert.throws(() => createResolver(options(override)), /preview-media ports are incomplete/u);
	}
});

test('the unavailable error names its own reason for each refusal', () => {
	for (const reason of ['attachment-unavailable', 'attachment-stale', 'verification-failed'] as const) {
		const error = new FramescaperVideoProxyPreviewUnavailableError(reason);
		assert.equal(error.reason, reason);
		assert.equal(error.code, 'FRAMESCAPER_PROXY_PREVIEW_UNAVAILABLE');
		assert.equal(error.name, 'FramescaperVideoProxyPreviewUnavailableError');
		assert.ok(error instanceof Error);
	}
});
