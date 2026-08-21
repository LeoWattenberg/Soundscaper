import assert from 'node:assert/strict';
import test from 'node:test';

import {
	cacheKey,
	createProvenance,
	embedProvenance,
	parseProvenance,
	sha256,
	translationStatus,
} from '../scripts/docs-ai/provenance.mjs';

test('provenance is parseable and records exact model and source identity', () => {
	const source = '# Source\n\nA bounded source.\n';
	const provenance = createProvenance({
		operation: 'translate',
		model: 'qwen3:27b',
		modelDigest: 'sha256:model',
		promptVersion: 'docs-translate-v1',
		source,
		sourceLocale: 'en',
		targetLocale: 'de',
	});
	const document = embedProvenance('---\ntitle: Ziel\n---\n\n# Ziel\n', provenance);

	assert.deepEqual(parseProvenance(document), provenance);
	assert.equal(provenance.sourceSha256, sha256(source));
	assert.equal(translationStatus({ source, target: document }).status, 'current');
	assert.equal(translationStatus({ source: `${source}\nChanged.`, target: document }).status, 'stale-source');
});

test('cache keys include operation, exact digest, prompt version, and source hash', () => {
	const common = {
		operation: 'translate',
		modelDigest: 'sha256:model-a',
		promptVersion: 'docs-translate-v1',
		sourceSha256: sha256('source'),
		targetLocale: 'de',
	};
	const initial = cacheKey(common);

	assert.notEqual(cacheKey({ ...common, operation: 'draft' }), initial);
	assert.notEqual(cacheKey({ ...common, modelDigest: 'sha256:model-b' }), initial);
	assert.notEqual(cacheKey({ ...common, promptVersion: 'docs-translate-v2' }), initial);
	assert.notEqual(cacheKey({ ...common, sourceSha256: sha256('changed') }), initial);
});
