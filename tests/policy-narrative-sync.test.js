/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
	POLICY_NARRATIVE_BINDINGS,
	renderPolicyNarrative,
	syncPolicyNarratives,
} from '../scripts/lib/policy-narratives.mjs';

const HANDOFF_BINDING = POLICY_NARRATIVE_BINDINGS.find(
	({ marker }) => marker === 'packaged-source-bearing-handoff',
);

test('the checked-in policy narratives are in sync with their registers', async () => {
	const { stale, narrativeCount } = await syncPolicyNarratives(join(import.meta.dirname, '..'), { write: false });
	assert.deepEqual(stale, []);
	assert.equal(narrativeCount, POLICY_NARRATIVE_BINDINGS.length);
});

test('rendering arrows product orders without touching ordinary prose', () => {
	assert.equal(
		renderPolicyNarrative('Soundscaper to Framescaper to Soundscaper and Framescaper to Soundscaper to Framescaper.', { intro: null }),
		'Soundscaper → Framescaper → Soundscaper and Framescaper → Soundscaper → Framescaper.',
	);
	assert.equal(
		renderPolicyNarrative('then returns to its origin profile before Soundscaper to disk writes', { intro: null }),
		'then returns to its origin profile before Soundscaper to disk writes',
	);
});

test('rendering backticks qualification IDs exactly once', () => {
	const once = renderPolicyNarrative('covers project-audio-mix-v1 and audio-track-render-v1.', { intro: null });
	assert.equal(once, 'covers `project-audio-mix-v1` and `audio-track-render-v1`.');
	assert.equal(renderPolicyNarrative(once, { intro: null }), once, 'already-backticked IDs are untouched');
});

test('rendering swaps the register intro for the document intro and rejects a mismatch', () => {
	assert.equal(HANDOFF_BINDING.intro, null, 'historical handoff prose no longer needs an active-CI alias');
	const binding = {
		intro: ['Register intro', 'Document intro'],
	};
	assert.equal(
		renderPolicyNarrative('Register intro for the workflows.', binding),
		'Document intro for the workflows.',
	);
	assert.throws(
		() => renderPolicyNarrative('Something else entirely.', binding),
		/must start with/u,
	);
});

test('rendering wraps bound blocks at the requested width', () => {
	const words = Array.from({ length: 40 }, (_, index) => `word${index}`).join(' ');
	const wrapped = renderPolicyNarrative(words, { intro: null, wrap: 30 });
	for (const line of wrapped.split('\n')) assert.ok(line.length <= 30, line);
	assert.equal(wrapped.replaceAll('\n', ' '), words, 'unwrapping restores the text');
	assert.deepEqual(
		renderPolicyNarrative('tiny overlong-token-wider-than-the-requested-width tail', { intro: null, wrap: 10 }).split('\n'),
		['tiny', 'overlong-token-wider-than-the-requested-width', 'tail'],
		'tokens wider than the width stand alone without being broken',
	);
});

async function createFixture(context, { summary, block }) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-narrative-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const registers = new Map();
	for (const binding of POLICY_NARRATIVE_BINDINGS) {
		if (!registers.has(binding.register)) registers.set(binding.register, { risks: [], rules: [] });
		const register = registers.get(binding.register);
		if (binding.jsonPath) {
			let carrier = register;
			for (const segment of binding.jsonPath.slice(0, -1)) carrier = carrier[segment] ??= {};
			carrier[binding.jsonPath.at(-1)] = summary;
			continue;
		}
		if (binding.ruleId) {
			register.rules.push({ id: binding.ruleId, [binding.field]: summary });
			continue;
		}
		let risk = register.risks.find(({ id }) => id === binding.riskId);
		if (!risk) {
			risk = { id: binding.riskId, currentControls: [] };
			register.risks.push(risk);
		}
		risk.currentControls.push({ id: binding.controlId, [binding.field]: summary });
	}
	const documents = new Map();
	for (const { marker, document } of POLICY_NARRATIVE_BINDINGS) {
		documents.set(document, `${documents.get(document) ?? 'Preamble.\n'}\n<!-- policy-narrative:${marker} -->\n${block}\n<!-- /policy-narrative:${marker} -->\n`);
	}
	for (const [path, text] of [
		...[...registers].map(([path, register]) => [path, `${JSON.stringify(register, null, '\t')}\n`]),
		...documents,
	]) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), text);
	}
	return { root, documentPaths: [...documents.keys()].map((path) => join(root, path)) };
}

test('sync reports and rewrites stale narrative blocks, then converges', async (context) => {
	const summary = 'A maintained Linux x64 CI job runs Soundscaper to Framescaper covering project-audio-mix-v1.';
	const { root, documentPaths } = await createFixture(context, { summary, block: 'stale text' });

	const checked = await syncPolicyNarratives(root, { write: false });
	assert.deepEqual(checked.stale.map(String).sort(), POLICY_NARRATIVE_BINDINGS.map(({ marker }) => marker).sort());
	for (const documentPath of documentPaths) {
		assert.match(await readFile(documentPath, 'utf8'), /stale text/u, 'check mode does not write');
	}

	const written = await syncPolicyNarratives(root, { write: true });
	assert.equal(written.stale.length, POLICY_NARRATIVE_BINDINGS.length);
	for (const documentPath of documentPaths) {
		const updated = await readFile(documentPath, 'utf8');
		assert.doesNotMatch(updated, /stale text/u);
		assert.match(
			updated.replaceAll('\n', ' '),
			/maintained Linux x64 CI job runs Soundscaper → Framescaper covering `project-audio-mix-v1`\./u,
			'derived blocks may be line-wrapped',
		);
		assert.match(updated, /Preamble\./u, 'unbound prose is preserved');
	}

	const converged = await syncPolicyNarratives(root, { write: false });
	assert.deepEqual(converged.stale, []);
});

test('sync rejects documents with missing narrative markers', async (context) => {
	const summary = 'A maintained Linux x64 CI job runs the workflows.';
	const { root, documentPaths } = await createFixture(context, { summary, block: 'body' });
	await writeFile(documentPaths[0], 'no markers here\n');
	await assert.rejects(syncPolicyNarratives(root), /missing the .* narrative marker/u);
});
