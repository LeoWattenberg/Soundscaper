/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import {
	createFramescaperProjectTimelineImage,
} from '../src/framescaper/editor-project-timeline-image.ts';
import {
	FRAMESCAPER_TIMELINE_IMAGE_BODY_ENCODING_TIMELINE_IMAGE as BODY_ENCODING,
	FRAMESCAPER_TIMELINE_IMAGE_BODY_KIND_TIMELINE_IMAGE as BODY_KIND,
	FramescaperTimelineImagePublicationRepositoryTimelineImage as Repository,
	FramescaperTimelineImagePublisherTimelineImage as Publisher,
} from '../src/framescaper/editor-timeline-image-publication-timeline-image.ts';

type Data = Record<string, unknown>;

function project(): Data {
	return createFramescaperProjectTimelineImage(PROFILE, {} as never) as unknown as Data;
}

function port(): never {
	return { database: async () => null, memory: {} } as unknown as never;
}

function store(): never {
	return {
		beginMediaAssetWrite: async () => ({}),
		getMediaAssetMetadata: async () => null,
		deleteMediaAsset: async () => undefined,
	} as unknown as never;
}

test('the durable body identity is published as fixed kind and encoding', () => {
	assert.equal(typeof BODY_KIND, 'string');
	assert.equal(typeof BODY_ENCODING, 'string');
	assert.ok(BODY_KIND.length > 0 && BODY_ENCODING.length > 0);
});

test('a publication repository requires its profile, port and project codec', () => {
	assert.doesNotThrow(() => new Repository(PROFILE, port()));
	assert.throws(() => new Repository(PROFILE, {}), /storage repository port is required/u);
	assert.throws(() => new Repository({}, port()), TypeError);
	assert.throws(() => new Repository(PROFILE, port(), {} as never), /codec requires authenticate/u);
});

test('a publication is a closed record of exactly its expected and next project', async () => {
	const repo = new Repository(PROFILE, port());
	const current = project();

	await assert.rejects(() => repo.publishIfCurrent({} as never), /unsupported, missing, or extra/u);
	await assert.rejects(
		() => repo.publishIfCurrent({ expected: current, project: current, extra: 1 } as never),
		/unsupported, missing, or extra/u,
	);
});

test('a publication must advance to exactly the next revision', async () => {
	const repo = new Repository(PROFILE, port());
	const current = project();

	await assert.rejects(
		() => repo.publishIfCurrent({ expected: current, project: current } as never),
		/must publish exactly the next revision/u,
	);
});

test('a publisher requires a closed dependency record with port and store', () => {
	assert.doesNotThrow(() => new Publisher(PROFILE, { port: port(), store: store() } as never));
	assert.throws(
		() => new Publisher(PROFILE, { port: port() } as never),
		/unsupported, missing/u,
	);
	assert.throws(
		() => new Publisher(PROFILE, { port: port(), store: store(), extra: 1 } as never),
		/unsupported, missing/u,
	);
});

test('a publisher request is closed and must carry its staged body bytes', async () => {
	const publisher = new Publisher(PROFILE, { port: port(), store: store() } as never);
	const current = project();

	await assert.rejects(
		() => publisher.publishIfCurrent({} as never),
		/publication request has unsupported, missing/u,
	);
	await assert.rejects(
		() => publisher.publishIfCurrent({ expected: current, project: current } as never),
		/publication request has unsupported, missing/u,
	);
});
