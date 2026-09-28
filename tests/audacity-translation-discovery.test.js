/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { discover } from '../scripts/lib/audacity-translation-release-discovery.mjs';
import {
	validateAudacityArtifactResult,
	validateAudacityWorkflowRun,
} from '../scripts/manage-audacity-translation-release.mjs';

function workflowRun(id, overrides = {}) {
	return {
		id,
		repository: { id: 32921736, full_name: 'audacity/audacity' },
		path: '.github/workflows/translate_tx_pull_to_s3.yml',
		head_branch: 'master',
		event: 'schedule',
		status: 'completed',
		conclusion: 'success',
		head_sha: 'a'.repeat(40),
		html_url: `https://github.com/audacity/audacity/actions/runs/${id}`,
		updated_at: new Date().toISOString(),
		...overrides,
	};
}

test('discovery selects the latest qualifying run from an unfiltered listing', async () => {
	const output = await mkdtemp(join(tmpdir(), 'soundscaper-audacity-discovery-'));
	const originalFetch = globalThis.fetch;
	const requests = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		requests.push(url);
		if (url.pathname.endsWith('/runs')) {
			return new Response(JSON.stringify({ workflow_runs: [
				workflowRun(400, { event: 'workflow_dispatch' }),
				workflowRun(300, { head_branch: 'release' }),
				workflowRun(200, { conclusion: 'failure' }),
				workflowRun(100),
			] }), { status: 200 });
		}
		return new Response(JSON.stringify({ total_count: 0, artifacts: [] }), { status: 200 });
	};
	try {
		await assert.rejects(discover({ output, 'max-age-hours': '168' }),
			/Expected exactly one artifact from the Audacity translation run/u);
		assert.equal(requests.length, 2);
		assert.equal(requests[0].searchParams.has('branch'), false);
		assert.equal(requests[0].searchParams.has('event'), false);
		assert.equal(requests[0].searchParams.has('status'), false);
		assert.equal(requests[1].pathname, '/repos/audacity/audacity/actions/runs/100/artifacts');
	} finally {
		globalThis.fetch = originalFetch;
		await rm(output, { recursive: true, force: true });
	}
});

test('upstream discovery binds GitHub run and artifact metadata', () => {
	const run = validateAudacityWorkflowRun(workflowRun(123), 123);
	const artifactResult = {
		total_count: 1,
		artifacts: [{
			id: 456,
			name: 'Audacity_locale_789',
			expired: false,
			size_in_bytes: 1024,
			digest: `sha256:${'b'.repeat(64)}`,
			created_at: '2026-07-14T12:00:00Z',
			workflow_run: { id: 123, repository_id: 32921736, head_sha: 'a'.repeat(40) },
		}],
	};
	assert.doesNotThrow(() => validateAudacityArtifactResult(artifactResult, run, {
		artifactId: 456,
		archiveName: 'Audacity_locale_789.zip',
		byteLength: 1024,
		sha256: 'b'.repeat(64),
	}));
	assert.throws(() => validateAudacityArtifactResult(artifactResult, run, {
		artifactId: 456,
		archiveName: 'Audacity_locale_789.zip',
		byteLength: 1024,
		sha256: 'c'.repeat(64),
	}), /SHA-256/u);
});
