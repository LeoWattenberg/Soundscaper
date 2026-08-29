/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	VideoProxyClaimRepository,
} from '../src/common/editor/storage/video-proxy-claim-repository.ts';
import {
	FramescaperCapturedVideoProxyPreservationRepository as Repository,
	framescaperCapturedVideoProxyProjectFingerprint as fingerprint,
} from '../src/framescaper/editor-captured-video-proxy-preservation.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';

type Data = Record<string, unknown>;

const SCHEMA_VERSION = 1;

function project(overrides: Data = {}): Data {
	return createFramescaperProject(PROFILE, overrides as never) as unknown as Data;
}

function port(): never {
	return { database: async () => null } as unknown as never;
}

function claims(): VideoProxyClaimRepository {
	return new VideoProxyClaimRepository(port());
}

function repository(): Repository {
	return new Repository(SCHEMA_VERSION, PROFILE, { port: port(), claims: claims() } as never);
}

test('a preservation repository is bound to the Framescaper 1.0 schema generation', () => {
	assert.doesNotThrow(() => repository());
	assert.throws(
		() => new Repository(2 as never, PROFILE, { port: port(), claims: claims() } as never),
		/requires Framescaper 1\.0/u,
	);
});

test('a preservation repository requires its exact durable authorities', () => {
	assert.throws(
		() => new Repository(SCHEMA_VERSION, PROFILE, { port: port(), claims: {} } as never),
		/exact durable authorities/u,
	);
	assert.throws(
		() => new Repository(SCHEMA_VERSION, PROFILE, { port: {}, claims: claims() } as never),
		/exact durable authorities/u,
	);
});

test('preservation refuses memory storage rather than losing the proxy pointer', async () => {
	const current = project();

	await assert.rejects(
		() => repository().publishIfCurrent({
			expected: current,
			project: current,
			baseFingerprint: fingerprint(SCHEMA_VERSION, PROFILE, current as never),
			projectId: String(current.id),
			baseRevision: 0,
			nextRevision: 1,
		} as never),
		Error,
	);
});

test('a captured proxy fingerprint is stable across repeated reads of one project', () => {
	const current = project();

	const first = fingerprint(SCHEMA_VERSION, PROFILE, current as never);
	const second = fingerprint(SCHEMA_VERSION, PROFILE, current as never);

	assert.equal(first, second);
	assert.match(first, /^[0-9a-f]+$/u);
});

test('a captured proxy fingerprint separates any two distinct projects', () => {
	const current = project();

	assert.notEqual(
		fingerprint(SCHEMA_VERSION, PROFILE, current as never),
		fingerprint(SCHEMA_VERSION, PROFILE, { ...current, title: 'Renamed' } as never),
	);
	assert.notEqual(
		fingerprint(SCHEMA_VERSION, PROFILE, project() as never),
		fingerprint(SCHEMA_VERSION, PROFILE, project() as never),
		'separately created projects carry their own identity',
	);
});

test('the fingerprint currently ignores the schema generation it is given', () => {
	const current = project();

	// Pins today's behaviour rather than endorsing it. The repository constructor
	// refuses a generation other than 1, but this digest neither gates on the
	// argument nor mixes it in, so two generations produce the same digest for
	// the same project. If the parameter is ever meant to separate generations,
	// this assertion is the one that should fail.
	assert.equal(
		fingerprint(SCHEMA_VERSION, PROFILE, current as never),
		fingerprint(2 as never, PROFILE, current as never),
	);
});
