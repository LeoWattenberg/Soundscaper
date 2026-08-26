/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	framescaperSelectedV28WatchProject,
	inspectFramescaperSelectedV28WatchImport,
} from '../desktop/native-services-selected-v28-watch-authority.ts';

const CONTENT_DIGEST = '12'.repeat(32);
const PROXY_DIGEST = '34'.repeat(32);

test('selected V28 watch authority binds the exact project generation, bin, source digest, and proxy', async () => {
	const fixture = projectFixture(false);
	assert.deepEqual(framescaperSelectedV28WatchProject(fixture.port, {
		open: true, writable: true,
	}, 'project-28'), {
		schemaVersion: 28, projectId: 'project-28', projectRevision: 7,
		open: true, writable: true, binId: 'project-bin',
	});
	assert.deepEqual(await inspectFramescaperSelectedV28WatchImport(
		fixture.port, 'project-28', 'project-bin', CONTENT_DIGEST,
	), {
		projectId: 'project-28', projectRevision: 7, binId: 'project-bin',
		sourceId: 'video-source-1', contentSha256: CONTENT_DIGEST, proxyAttached: false,
	});
	const proxied = projectFixture(true);
	assert.equal((await inspectFramescaperSelectedV28WatchImport(
		proxied.port, 'project-28', 'project-bin', CONTENT_DIGEST,
	))?.proxyAttached, true);
});

test('selected V28 watch authority rejects wrong bins and generation drift before recovery', async () => {
	const fixture = projectFixture(false);
	await assert.rejects(() => inspectFramescaperSelectedV28WatchImport(
		fixture.port, 'project-28', 'other-bin', CONTENT_DIGEST,
	), /exact bin/iu);
	fixture.projectSha256 = '56'.repeat(32);
	await assert.rejects(() => inspectFramescaperSelectedV28WatchImport(
		fixture.port, 'project-28', 'project-bin', CONTENT_DIGEST,
	), /identity changed/iu);
});

test('selected watch authority admits an exact F31 project without normalizing its claim', async () => {
	const fixture = projectFixture(false, 31);
	assert.equal(framescaperSelectedV28WatchProject(fixture.port, {
		open: true, writable: true,
	}, 'project-28', 31)?.schemaVersion, 31);
	assert.equal((await inspectFramescaperSelectedV28WatchImport(
		fixture.port, 'project-28', 'project-bin', CONTENT_DIGEST, 31,
	))?.sourceId, 'video-source-1');
	await assert.rejects(() => inspectFramescaperSelectedV28WatchImport(
		fixture.port, 'project-28', 'project-bin', CONTENT_DIGEST, 28,
	), /wrong document identity/iu);
});

function projectFixture(proxied: boolean, schemaVersion: 28 | 31 = 28) {
	const document = JSON.stringify({
		schemaVersion, id: 'project-28', revision: 7,
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
		projectRecord: (projectId: string) => projectId === 'project-28' ? Object.freeze({
			projectId, projectRevision: 7, projectSha256,
		}) : null,
		readProjectBundle: async () => Object.freeze({
			project: Object.freeze({ projectRevision: 7, sha256: createHash('sha256')
				.update(document).digest('hex') }),
			document,
		}),
	};
	return {
		port,
		set projectSha256(value: string) { projectSha256 = value; },
	};
}
