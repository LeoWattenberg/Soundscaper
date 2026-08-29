/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	VideoProxyClaimRepository,
} from '../src/common/editor/storage/video-proxy-claim-repository.ts';
import {
	FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	FramescaperProjectSequenceArchiveRepository,
} from '../src/framescaper/editor-project-sequence-archive-repository.ts';
import {
	FramescaperProjectSequencePreservationRepository,
	framescaperProjectFingerprintSequence,
} from '../src/framescaper/editor-project-sequence-preservation-repository.ts';
import { createFramescaperProjectSequence } from '../src/framescaper/editor-project-sequence.ts';

type Data = Record<string, unknown>;

function port(): never {
	return { database: async () => null } as unknown as never;
}

function claims(): VideoProxyClaimRepository {
	return new VideoProxyClaimRepository(port());
}

function project(overrides: Data = {}): Data {
	return createFramescaperProjectSequence(
		PROFILE,
		overrides as never,
	) as unknown as Data;
}

function archive(): Data {
	return new FramescaperProjectSequenceArchiveRepository(
		PROFILE,
		{ port: port(), claims: claims() } as never,
	) as unknown as Data;
}

function publish(repository: Data, publication: Data): Promise<unknown> {
	return (repository.publish as (value: unknown) => Promise<unknown>)(publication);
}

test('an archive repository requires its exact profile, port and claim authority', () => {
	assert.throws(
		() => new FramescaperProjectSequenceArchiveRepository({}, { port: port(), claims: claims() } as never),
		TypeError,
	);
	assert.throws(
		() => new FramescaperProjectSequenceArchiveRepository(PROFILE, { claims: claims() } as never),
		TypeError,
	);
	assert.throws(
		() => new FramescaperProjectSequenceArchiveRepository(PROFILE, { port: {}, claims: claims() } as never),
		/durable repository port is required/u,
	);
	assert.throws(
		() => new FramescaperProjectSequenceArchiveRepository(PROFILE, { port: port(), claims: {} } as never),
		/requires its exact claim authority/u,
	);
	assert.throws(
		() => new FramescaperProjectSequenceArchiveRepository(
			PROFILE, { port: port(), claims: claims(), extra: 1 } as never,
		),
		TypeError,
	);
});

test('a publication carrying the wrong fields or an unknown mode is refused', async () => {
	const repository = archive();

	await assert.rejects(() => publish(repository, {}), TypeError);
	await assert.rejects(
		() => publish(repository, {
			mode: 'archive-somehow', origin: project(), expected: null,
			project: project(), plans: [],
		}),
		/supported sequence archive publication mode is required/u,
	);
});

test('an archive create must publish the inspected project into an absent destination', async () => {
	const repository = archive();
	const origin = project();

	await assert.rejects(
		() => publish(repository, { mode: 'create', origin, expected: origin, project: origin, plans: [] }),
		/exact inspected project into an absent destination/u,
	);
	await assert.rejects(
		() => publish(repository, {
			mode: 'create', origin, expected: null,
			project: project({ title: 'A different project' }), plans: [],
		}),
		/exact inspected project into an absent destination/u,
	);
});

test('an archive copy requires a fresh identity at revision zero', async () => {
	const origin = project();

	await assert.rejects(
		() => publish(archive(), { mode: 'copy', origin, expected: null, project: origin, plans: [] }),
		/fresh project identity at revision 0/u,
	);
});

test('an archive replacement must compare and swap a strictly higher revision', async () => {
	const origin = project();

	await assert.rejects(
		() => publish(archive(), {
			mode: 'compare-and-swap', origin, expected: null, project: origin, plans: [],
		}),
		/compare and swap a strictly higher revision/u,
	);
});

test('a validated archive publication still refuses to proceed without durable storage', async () => {
	const origin = project();

	await assert.rejects(
		() => publish(archive(), { mode: 'create', origin, expected: null, project: origin, plans: [] }),
		/Durable storage is required for sequence archive publication/u,
	);
});

test('a preservation repository requires its exact profile and claim authority', () => {
	assert.throws(
		() => new FramescaperProjectSequencePreservationRepository(
			{}, { port: port(), claims: claims() } as never,
		),
		TypeError,
	);
	assert.throws(
		() => new FramescaperProjectSequencePreservationRepository(
			PROFILE, { port: port(), claims: {} } as never,
		),
		/video proxy claim repository is required/u,
	);
	assert.throws(
		() => new FramescaperProjectSequencePreservationRepository(
			PROFILE, { port: {}, claims: claims() } as never,
		),
		/storage repository port is required/u,
	);
});

test('preservation refuses memory storage rather than silently losing the proxy pointer', async () => {
	const repository = new FramescaperProjectSequencePreservationRepository(
		PROFILE,
		{ port: port(), claims: claims() } as never,
	);
	const origin = project();

	await assert.rejects(
		() => repository.publishIfCurrent({
			expected: origin, project: origin,
			baseFingerprint: framescaperProjectFingerprintSequence(PROFILE, origin),
			projectId: String(origin.id), baseRevision: 0, nextRevision: 1,
		} as never),
		/memory sequence preservation is unsupported/u,
	);
});

test('a project fingerprint is stable across repeated reads of one project', () => {
	const source = project();

	const first = framescaperProjectFingerprintSequence(PROFILE, source);
	const second = framescaperProjectFingerprintSequence(PROFILE, source);

	assert.equal(first, second);
	assert.match(first, /^[0-9a-f]{64}$/u);
});

test('a project fingerprint separates any two distinct projects', () => {
	const source = project();
	const renamed = { ...source, title: 'Renamed' };

	assert.notEqual(
		framescaperProjectFingerprintSequence(PROFILE, source),
		framescaperProjectFingerprintSequence(PROFILE, renamed),
		'a changed field must change the digest a claim is bound to',
	);
	assert.notEqual(
		framescaperProjectFingerprintSequence(PROFILE, project()),
		framescaperProjectFingerprintSequence(PROFILE, project()),
		'separately created projects carry their own identity, so they never share a digest',
	);
});
