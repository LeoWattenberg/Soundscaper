import assert from 'node:assert/strict';
import test from 'node:test';

import {
	InvalidModelOutputError,
	generateValidated,
} from '../scripts/docs-ai/generation.mjs';

function sequencedClient(sequence) {
	const prompts = [];
	return {
		prompts,
		async generateJson(request) {
			prompts.push(request.prompt);
			const next = sequence.shift();
			if (next instanceof Error) throw next;
			return next;
		},
	};
}

test('invalid model output receives concise feedback and succeeds within three attempts', async () => {
	const client = sequencedClient([{ value: 'wrong' }, { value: 'still wrong' }, { value: 'valid' }]);
	const result = await generateValidated({
		client,
		system: 'System',
		prompt: 'Original bounded request',
		validate(response) {
			if (response.value !== 'valid') throw new InvalidModelOutputError('Expected the required schema.');
			return response.value;
		},
	});

	assert.equal(result.value, 'valid');
	assert.equal(result.attempts, 3);
	assert.equal(client.prompts[0], 'Original bounded request');
	assert.match(client.prompts[1], /Previous response failed validation: Expected the required schema\./u);
	assert.ok(client.prompts[1].length < 400);
});

test('invalid model output stops after exactly three attempts', async () => {
	const client = sequencedClient([{}, {}, {}, {}]);
	await assert.rejects(() => generateValidated({
		client,
		system: 'System',
		prompt: 'Request',
		validate() {
			throw new InvalidModelOutputError('Invalid Markdown structure.');
		},
	}), /Invalid Markdown structure/u);
	assert.equal(client.prompts.length, 3);
});

test('transport and HTTP failures are never retried', async () => {
	for (const failure of [
		new Error('Ollama generation returned HTTP 503.'),
		new DOMException('The operation timed out.', 'TimeoutError'),
	]) {
		const client = sequencedClient([failure, { value: 'would hide the failure' }]);
		await assert.rejects(() => generateValidated({
			client,
			system: 'System',
			prompt: 'Request',
			validate: (response) => response,
		}), (error) => error === failure);
		assert.equal(client.prompts.length, 1);
	}
});
