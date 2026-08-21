import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ollamaUrlCandidates,
	resolveOllamaUrl,
	resolveRoleModel,
} from '../scripts/docs-ai/config.mjs';

test('an explicit Ollama URL takes precedence and is normalized', () => {
	assert.deepEqual(ollamaUrlCandidates({
		env: { OLLAMA_URL: 'http://host.example:11434/' },
		isWsl: true,
		resolvConf: 'nameserver 172.28.32.1\n',
		routeTable: '',
	}), ['http://host.example:11434']);
});

test('WSL discovery tries route and nameserver gateways before localhost', () => {
	assert.deepEqual(ollamaUrlCandidates({
		env: {},
		isWsl: true,
		resolvConf: '# generated\nnameserver 172.29.48.1\n',
		routeTable: 'Iface\tDestination\tGateway\tFlags\neth0\t00000000\t01D014AC\t0003\n',
	}), [
		'http://172.20.208.1:11434',
		'http://172.29.48.1:11434',
		'http://127.0.0.1:11434',
	]);
});

test('endpoint resolution probes candidates without invoking a model', async () => {
	const seen = [];
	const url = await resolveOllamaUrl({
		candidates: ['http://172.29.48.1:11434', 'http://127.0.0.1:11434'],
		fetchImpl: async (input) => {
			seen.push(String(input));
			return { ok: seen.length === 2, status: seen.length === 2 ? 200 : 503 };
		},
	});

	assert.equal(url, 'http://127.0.0.1:11434');
	assert.deepEqual(seen, [
		'http://172.29.48.1:11434/api/version',
		'http://127.0.0.1:11434/api/version',
	]);
});

test('role-specific model settings and CLI overrides have explicit precedence', () => {
	const env = {
		OLLAMA_MODEL: 'shared:latest',
		OLLAMA_DOCS_DRAFT_MODEL: 'draft:latest',
		OLLAMA_DOCS_TRANSLATE_MODEL: 'translate:latest',
	};

	assert.equal(resolveRoleModel('draft', { env }), 'draft:latest');
	assert.equal(resolveRoleModel('translate', { env }), 'translate:latest');
	assert.equal(resolveRoleModel('translate', { env, override: 'cli:latest' }), 'cli:latest');
});
