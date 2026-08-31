/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	verifyPublishedPagesArtifactIdentity,
} from '../scripts/lib/pages-deploy-artifact-binding.mjs';

const EXPECTED = Buffer.from('{"schemaVersion":2,"assets":[]}\n');
const STALE = Buffer.from('{"schemaVersion":2,"assets":[{"url":"/assets/stale.js"}]}\n');

async function artifactFixture(context) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-pages-binding-'));
	context.after(async () => {
		const { rm } = await import('node:fs/promises');
		await rm(root, { recursive: true, force: true });
	});
	const path = join(root, 'offline-shell.json');
	await writeFile(path, EXPECTED);
	return path;
}

test('Pages artifact binding polls through a stale policy-valid deployment and proves exact bytes', async (context) => {
	const expectedArtifactPath = await artifactFixture(context);
	const requests = [];
	const waits = [];
	const observations = [STALE, EXPECTED];
	const result = await verifyPublishedPagesArtifactIdentity({
		expectedArtifactPath,
		origin: 'https://soundscaper.org',
		fetchImpl: async (url, init) => {
			requests.push({ url, init });
			return new Response(observations.shift(), {
				status: 200,
				headers: {
					'cache-control': 'no-store',
					'content-type': 'application/json; charset=utf-8',
				},
			});
		},
	}, {
		intervalMs: 7,
		maxAttempts: 2,
		sleep: async (milliseconds) => { waits.push(milliseconds); },
	});

	assert.equal(result.schemaVersion, 1);
	assert.equal(result.origin, 'https://soundscaper.org');
	assert.equal(result.publishedPath, '/offline-shell.json');
	assert.equal(result.byteLength, EXPECTED.byteLength);
	assert.match(result.sha256, /^[a-f0-9]{64}$/u);
	assert.equal(result.attemptCount, 2);
	assert.deepEqual(waits, [7]);
	assert.equal(requests.length, 2);
	assert.notEqual(requests[0].url, requests[1].url, 'every poll must bypass a prior CDN cache key');
	for (const [index, request] of requests.entries()) {
		const url = new URL(request.url);
		assert.equal(url.origin, 'https://soundscaper.org');
		assert.equal(url.pathname, '/offline-shell.json');
		assert.match(url.searchParams.get('soundscaper-deploy-sha256'), /^[a-f0-9]{64}-[a-f0-9-]+-\d+$/u);
		assert.equal(request.init.cache, 'no-store');
		assert.equal(request.init.redirect, 'error');
		assert.equal(request.init.headers['cache-control'], 'no-cache, no-store');
		assert.equal(request.init.headers.pragma, 'no-cache');
		assert.equal(request.init.headers['accept-encoding'], 'identity');
		assert.equal(request.init.signal.aborted, false, `attempt ${String(index + 1)} has a live timeout signal`);
	}
});

test('Pages artifact binding cannot admit a stale deployment at its bounded poll limit', async (context) => {
	const expectedArtifactPath = await artifactFixture(context);
	let calls = 0;
	await assert.rejects(
		() => verifyPublishedPagesArtifactIdentity({
			expectedArtifactPath,
			origin: 'https://soundscaper.org',
			fetchImpl: async () => {
				calls += 1;
				return new Response(STALE, { status: 200 });
			},
		}, {
			intervalMs: 0,
			maxAttempts: 3,
			sleep: async () => {},
		}),
		/live Pages artifact.*does not match.*3 attempts/iu,
	);
	assert.equal(calls, 3);
});

test('Pages artifact binding refuses redirects, encoded bodies, and non-exact bytes', async (context) => {
	const expectedArtifactPath = await artifactFixture(context);
	for (const response of [
		new Response(EXPECTED, { status: 302, headers: { location: 'https://elsewhere.example/' } }),
		new Response(EXPECTED, { status: 200, headers: { 'content-encoding': 'gzip' } }),
		new Response(Buffer.concat([EXPECTED, Buffer.from(' ')]), { status: 200 }),
	]) {
		await assert.rejects(
			() => verifyPublishedPagesArtifactIdentity({
				expectedArtifactPath,
				origin: 'https://soundscaper.org',
				fetchImpl: async () => response.clone(),
			}, { maxAttempts: 1 }),
			/(?:HTTP 302|encoded response|does not match)/iu,
		);
	}
});

test('Stable 1 binds the downloaded site artifact before policy verification and release publication', async () => {
	const [workflow, verifier] = await Promise.all([
		readFile('.github/workflows/soundscaper-stable-1.yml', 'utf8'),
		readFile('scripts/verify-pages-deploy.mjs', 'utf8'),
	]);
	assert.match(verifier, /verifyPublishedPagesArtifactIdentity/u);
	assert.match(verifier, /SCAPE_DEPLOY_EXPECTED_OFFLINE_SHELL/u);
	assert.match(verifier, /SCAPE_DEPLOY_IDENTITY_EVIDENCE/u);
	assert.match(workflow, /SCAPE_DEPLOY_EXPECTED_OFFLINE_SHELL: dist\/offline-shell\.json/u);
	assert.match(workflow, /SCAPE_DEPLOY_IDENTITY_EVIDENCE: pages-deployment-identity\.json/u);
	assert.match(workflow, /path:\s*\|\s*pages-deployment\.log\s*pages-deployment-identity\.json/u);
	assert.match(workflow,
		/gh release upload "\$GITHUB_REF_NAME" pages-deployment\.log pages-deployment-identity\.json/u);
	const download = workflow.indexOf('name: Download the built Soundscaper site');
	const deploy = workflow.indexOf('name: Deploy Soundscaper Stable 1 to Pages');
	const verify = workflow.indexOf('name: Verify the live Soundscaper deployment');
	const publish = workflow.indexOf('name: Publish Soundscaper 1.0.0');
	assert.ok(download >= 0 && download < deploy && deploy < verify && verify < publish);
});
