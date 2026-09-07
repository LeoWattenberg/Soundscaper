/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	validateAudacityArtifactResult,
	validateAudacityWorkflowRun,
} from '../scripts/manage-audacity-translation-release.mjs';

test('upstream discovery binds GitHub run and artifact metadata', () => {
	const run = validateAudacityWorkflowRun({
		id: 123,
		repository: { id: 32921736, full_name: 'audacity/audacity' },
		path: '.github/workflows/translate_tx_pull_to_s3.yml',
		head_branch: 'master',
		event: 'schedule',
		status: 'completed',
		conclusion: 'success',
		head_sha: 'a'.repeat(40),
		html_url: 'https://github.com/audacity/audacity/actions/runs/123',
	}, 123);
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
