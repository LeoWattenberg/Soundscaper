import assert from 'node:assert/strict';
import test from 'node:test';

import {
	promotePointer,
	validateAudacityArtifactResult,
	validateAudacityWorkflowRun,
	validateCommittedRouteEligibility,
	validateHistoricalPack,
} from '../scripts/manage-audacity-translation-release.mjs';

test('historical rollback packs use current canonical keys and named placeholders', () => {
	const descriptor = { mapped: 1 };
	assert.doesNotThrow(() => validateHistoricalPack({
		schemaVersion: 1,
		locale: 'fr',
		messages: { labelsImported: '{count} étiquette(s) importée(s).' },
	}, 'fr', descriptor));
	assert.throws(() => validateHistoricalPack({
		schemaVersion: 1,
		locale: 'fr',
		messages: { labelsImported: '{total} étiquette(s) importée(s).' },
	}, 'fr', descriptor), /placeholders/u);
	assert.throws(() => validateHistoricalPack({
		schemaVersion: 1,
		locale: 'fr',
		messages: { removedCatalogKey: 'Ancienne valeur' },
	}, 'fr', descriptor), /canonical catalog/u);
});

test('stage verification requires every committed non-default route to remain eligible', () => {
	assert.doesNotThrow(() => validateCommittedRouteEligibility({ fr: { eligible: true } }, ['en', 'de', 'fr']));
	assert.throws(
		() => validateCommittedRouteEligibility({ fr: { eligible: false } }, ['en', 'de', 'fr']),
		/Committed locale route fr/u,
	);
	assert.throws(
		() => validateCommittedRouteEligibility({}, ['en', 'de', 'fr']),
		/Committed locale route fr/u,
	);
});

test('protected publication validation binds GitHub run and artifact metadata', () => {
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

test('a failed first-pointer smoke test removes the guarded pointer', async () => {
	let stored = null;
	let etag = null;
	let deleted = false;
	const client = {
		async put(_key, bytes) {
			stored = Buffer.from(bytes);
			etag = '"promoted"';
			return response(200, etag);
		},
		async get() {
			return stored
				? { response: response(200, etag), bytes: Buffer.from(stored) }
				: { response: response(404), bytes: Buffer.alloc(0) };
		},
		async delete() {
			deleted = true;
			stored = null;
			etag = null;
			return response(204);
		},
	};
	await assert.rejects(
		promotePointer(
			client,
			{ key: 'runtime/translations/audacity/4/latest.json', pointer: null, bytes: null, etag: null },
			{ schemaVersion: 1, releaseId: '123' },
			'https://translations.example.test/runtime/translations/audacity/4',
			async () => { throw new Error('public pointer unavailable'); },
		),
		/removed the guarded latest\.json pointer/u,
	);
	assert.equal(deleted, true);
	assert.equal(stored, null);
});

function response(status, etag) {
	return { status, headers: new Headers(etag ? { etag } : {}) };
}
