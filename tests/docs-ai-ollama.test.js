import assert from 'node:assert/strict';
import test from 'node:test';

import { InvalidModelOutputError } from '../scripts/docs-ai/generation.mjs';
import { createOllamaClient } from '../scripts/docs-ai/ollama.mjs';

test('Ollama requests pin the installed digest identity and bounded generation options', async () => {
	const requests = [];
	const client = createOllamaClient({
		role: 'draft',
		url: 'http://ollama.test:11434',
		env: {
			OLLAMA_DOCS_DRAFT_MODEL: 'qwen3:27b',
			OLLAMA_DOCS_TEMPERATURE: '0.1',
			OLLAMA_DOCS_TIMEOUT_MS: '5000',
		},
		fetchImpl: async (input, init = {}) => {
			requests.push({ input: String(input), init });
			if (String(input).endsWith('/api/tags')) {
				return {
					ok: true,
					async json() {
						return { models: [{ name: 'qwen3:27b', digest: 'sha256:exact-model-digest' }] };
					},
				};
			}
			return {
				ok: true,
				async json() {
					return { response: JSON.stringify({ locale: 'en', markdown: 'Draft', usedFactIds: ['fact'] }) };
				},
			};
		},
	});

	assert.deepEqual(await client.identity(), {
		model: 'qwen3:27b',
		digest: 'sha256:exact-model-digest',
	});
	const result = await client.generateJson({ system: 'Closed facts.', prompt: '{"facts":[]}' });
	assert.equal(result.markdown, 'Draft');
	const generationRequest = requests.find((request) => request.input.endsWith('/api/generate'));
	const body = JSON.parse(generationRequest.init.body);
	assert.equal(body.model, 'qwen3:27b');
	assert.equal(body.stream, false);
	assert.equal(body.format, 'json');
	assert.equal(body.options.temperature, 0.1);
	assert.equal(body.options.seed, 0);
	assert.equal(requests.filter((request) => request.input.endsWith('/api/tags')).length, 1);
});

test('Ollama identity resolution refuses an inventory entry without an exact digest', async () => {
	const client = createOllamaClient({
		role: 'translate',
		model: 'qwen3:27b',
		url: 'http://ollama.test:11434',
		fetchImpl: async () => ({
			ok: true,
			async json() {
				return { models: [{ name: 'qwen3:27b' }] };
			},
		}),
	});

	await assert.rejects(() => client.identity(), /exact digest/u);
});

test('invalid JSON emitted by a model is classified as retryable output', async () => {
	const client = createOllamaClient({
		role: 'draft',
		model: 'qwen3.8:latest',
		url: 'http://ollama.test:11434',
		fetchImpl: async (input) => String(input).endsWith('/api/tags')
			? {
				ok: true,
				async json() {
					return { models: [{ name: 'qwen3.8:latest', digest: 'sha256:exact-model-digest' }] };
				},
			}
			: {
				ok: true,
				async json() {
					return { response: 'not json' };
				},
			},
	});

	await assert.rejects(
		() => client.generateJson({ system: 'System', prompt: 'Prompt' }),
		(error) => error instanceof InvalidModelOutputError,
	);
});
