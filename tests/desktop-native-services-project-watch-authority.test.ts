/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	framescaperNativeWatchProject,
	inspectFramescaperNativeWatchImport,
} from '../desktop/native-services-project-watch-authority.ts';

const CONTENT_DIGEST = '12'.repeat(32);
const PROXY_DIGEST = '34'.repeat(32);
const PROJECT_STATE = Object.freeze({
	schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
	open: true, writable: true, binId: 'project-bin' as const,
});

test('baseline watch authority binds the exact project tuple, bin, source digest, and proxy', async () => {
	const fixture = projectFixture(false);
	assert.deepEqual(framescaperNativeWatchProject(fixture.port, PROJECT_STATE, 'project-28'), {
		schemaFamily: 'framescaper', schemaVersion: 1,
		projectId: 'project-28', projectRevision: 7,
		open: true, writable: true, binId: 'project-bin',
	});
	assert.deepEqual(await inspectFramescaperNativeWatchImport(
		fixture.port, 'project-28', 'project-bin', CONTENT_DIGEST,
	), {
		schemaFamily: 'framescaper', schemaVersion: 1,
		projectId: 'project-28', projectRevision: 7, binId: 'project-bin',
		sourceId: 'video-source-1', contentSha256: CONTENT_DIGEST, proxyAttached: false,
	});
	const proxied = projectFixture(true);
	assert.equal((await inspectFramescaperNativeWatchImport(
		proxied.port, 'project-28', 'project-bin', CONTENT_DIGEST,
	))?.proxyAttached, true);
});

test('baseline watch authority rejects wrong bins and project drift before recovery', async () => {
	const fixture = projectFixture(false);
	await assert.rejects(() => inspectFramescaperNativeWatchImport(
		fixture.port, 'project-28', 'other-bin', CONTENT_DIGEST,
	), /exact bin/iu);
	fixture.projectSha256 = '56'.repeat(32);
	await assert.rejects(() => inspectFramescaperNativeWatchImport(
		fixture.port, 'project-28', 'project-bin', CONTENT_DIGEST,
	), /identity changed/iu);
});

test('baseline watch authority refuses malformed identity before project reads', async () => {
	const fixture = projectFixture(false);
	let reads = 0;
	const malformed = Object.freeze({
		...fixture.port,
		schemaFamily: 'soundscaper' as const,
		projectRecord: () => { reads += 1; return null; },
	});
	await assert.rejects(() => inspectFramescaperNativeWatchImport(
		malformed as never, 'project-28', 'project-bin', CONTENT_DIGEST,
	), /Framescaper v1/iu);
	assert.equal(reads, 0);
	const numericOnly = { ...fixture.port } as Record<string, unknown>;
	delete numericOnly.schemaFamily;
	assert.throws(() => framescaperNativeWatchProject(
		numericOnly as never, PROJECT_STATE, 'project-28',
	), /Framescaper v1/iu);
});

function projectFixture(proxied: boolean) {
	const document = JSON.stringify({
		schemaFamily: 'framescaper', schemaVersion: 1, id: 'project-28', revision: 7,
		sources: [{
			kind: 'video', id: 'video-source-1', contentSha256: CONTENT_DIGEST,
			proxyAttachment: proxied ? {
				originalSha256: CONTENT_DIGEST, sha256: PROXY_DIGEST,
			} : null,
		}],
		projectBin: { clips: [{ kind: 'video', id: 'bin-video-1', sourceId: 'video-source-1' }] },
	});
	let projectSha256 = createHash('sha256').update(document).digest('hex');
	const port = {
		schemaFamily: 'framescaper' as const,
		schemaVersion: 1 as const,
		projectRecord: (projectId: string) => projectId === 'project-28' ? Object.freeze({
			schemaFamily: 'framescaper', schemaVersion: 1,
			projectId, projectRevision: 7, projectSha256,
		}) : null,
		readProjectBundle: async () => Object.freeze({
			project: Object.freeze({ schemaFamily: 'framescaper', schemaVersion: 1,
				projectRevision: 7, sha256: createHash('sha256')
				.update(document).digest('hex') }),
			document,
		}),
	};
	return {
		port,
		set projectSha256(value: string) { projectSha256 = value; },
	};
}
