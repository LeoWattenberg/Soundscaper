import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { checkTranslation, draftDocument, translateDocument } from '../scripts/docs-ai/workflows.mjs';

function fakeClient(responses) {
	let requestCount = 0;
	const requests = [];
	return {
		get requestCount() {
			return requestCount;
		},
		requests,
		async identity() {
			return { model: 'qwen3:27b', digest: 'sha256:model' };
		},
		async generateJson(request) {
			requests.push(request);
			const response = responses[requestCount];
			requestCount += 1;
			if (!response) throw new Error('Unexpected model request');
			return response;
		},
	};
}

test('drafting writes a grounded Markdown file by default and then reuses its cache', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-docs-ai-'));
	const factsPath = join(directory, 'facts.json');
	const outputPath = join(directory, 'draft.md');
	const facts = {
		locale: 'en',
		frontmatter: { title: 'First project', description: 'Create a first project.' },
		facts: [
			{ id: 'local-first', claim: 'Project editing occurs locally in the browser.' },
		],
		outline: ['Introduction'],
	};
	await writeFile(factsPath, `${JSON.stringify(facts)}\n`);
	const client = fakeClient([{ locale: 'en', markdown: '# First project\n\nEditing occurs locally.', usedFactIds: ['local-first'] }]);

	await draftDocument({ factsPath, outputPath, client, cacheDirectory: join(directory, 'cache') });
	const firstOutput = await readFile(outputPath, 'utf8');
	assert.match(firstOutput, /^---\ntitle: "First project"/u);
	assert.match(firstOutput, /docs-ai-provenance/u);
	assert.match(firstOutput, /Editing occurs locally/u);

	await draftDocument({ factsPath, outputPath, client, cacheDirectory: join(directory, 'cache') });
	assert.equal(client.requestCount, 1);
	assert.equal(await readFile(outputPath, 'utf8'), firstOutput);
});

test('translation writes by default, preserves protected structures, and reports staleness', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-docs-ai-'));
	const sourcePath = join(directory, 'source.md');
	const targetPath = join(directory, 'target.md');
	const source = `---
title: Source title
description: Export a local project as .scape.
sidebar:
  order: 4
---

# Export \`.scape\`

The project is stored locally and the file uses command \`file.export\`.
`;
	await writeFile(sourcePath, source);
	const client = fakeClient([{
		locale: 'de',
		title: 'Quelltitel',
		description: 'Ein lokales Projekt als <docs-ai-token id="0001"/> exportieren.',
	}, {
		locale: 'de',
		markdown: '# Export <docs-ai-token id="0001"/>\n\nDas Projekt wird lokal gespeichert und die Datei verwendet den Befehl <docs-ai-token id="0002"/>.\n',
	}]);

	await translateDocument({
		sourcePath,
		targetPath,
		targetLocale: 'de',
		client,
		cacheDirectory: join(directory, 'cache'),
		maxChunkChars: 2_000,
	});
	const target = await readFile(targetPath, 'utf8');
	assert.match(target, /title: "Quelltitel"/u);
	assert.match(target, /description: "Ein lokales Projekt als \.scape exportieren\."/u);
	assert.match(target, /sidebar:\n[ ]{2}order: 4/u);
	assert.match(target, /`\.scape`/u);
	assert.match(target, /`file\.export`/u);
	assert.deepEqual(await checkTranslation({ sourcePath, targetPath }), { status: 'current' });

	await writeFile(sourcePath, `${source}\nA new source claim.\n`);
	assert.deepEqual(await checkTranslation({ sourcePath, targetPath }), { status: 'stale-source' });
});

test('drafting rejects model claims that cite facts outside the packet', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-docs-ai-'));
	const factsPath = join(directory, 'facts.json');
	await writeFile(factsPath, JSON.stringify({
		locale: 'en',
		frontmatter: { title: 'Guide' },
		facts: [{ id: 'known', claim: 'Known claim.' }],
	}));
	const invalid = { locale: 'en', markdown: '# Guide\n\nAn unsupported claim.', usedFactIds: ['invented'] };
	const client = fakeClient([invalid, invalid, invalid]);

	await assert.rejects(
		() => draftDocument({
			factsPath,
			outputPath: join(directory, 'draft.md'),
			client,
			cacheDirectory: join(directory, 'cache'),
		}),
		/unknown fact ID/u,
	);
	assert.equal(client.requestCount, 3);
});

test('drafting retries invalid schema with concise corrective feedback', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-docs-ai-'));
	const factsPath = join(directory, 'facts.json');
	const outputPath = join(directory, 'draft.md');
	await writeFile(factsPath, JSON.stringify({
		locale: 'en',
		frontmatter: { title: 'Guide' },
		facts: [{ id: 'known', claim: 'Editing occurs locally.' }],
	}));
	const client = fakeClient([
		{ locale: 'en', markdown: '# Guide\n\nEditing occurs locally.', usedFactIds: ['invented'] },
		{ locale: 'en', markdown: '# Guide\n\nEditing occurs locally.', usedFactIds: ['known'] },
	]);

	await draftDocument({ factsPath, outputPath, client, cacheDirectory: join(directory, 'cache') });
	assert.equal(client.requestCount, 2);
	assert.match(client.requests[1].prompt, /Previous response failed validation: Draft response cited an unknown fact ID/u);
	assert.match(await readFile(outputPath, 'utf8'), /Editing occurs locally/u);
});

test('drafting retries invalid Markdown before writing its target', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-docs-ai-'));
	const factsPath = join(directory, 'facts.json');
	const outputPath = join(directory, 'draft.md');
	await writeFile(factsPath, JSON.stringify({
		locale: 'en',
		frontmatter: { title: 'Guide' },
		facts: [{ id: 'known', claim: 'Editing occurs locally.' }],
	}));
	const client = fakeClient([
		{ locale: 'en', markdown: '# Guide\n\n```sh\ncommand\n', usedFactIds: ['known'] },
		{ locale: 'en', markdown: '# Guide\n\nEditing occurs locally.', usedFactIds: ['known'] },
	]);

	await draftDocument({ factsPath, outputPath, client, cacheDirectory: join(directory, 'cache') });
	assert.equal(client.requestCount, 2);
	assert.match(client.requests[1].prompt, /unclosed fenced code block/u);
	assert.doesNotMatch(await readFile(outputPath, 'utf8'), /```sh/u);
});

test('translation retries invalid frontmatter schema and protected Markdown tokens', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-docs-ai-'));
	const sourcePath = join(directory, 'source.md');
	const targetPath = join(directory, 'target.md');
	await writeFile(sourcePath, `---
title: Export .scape
description: Export a local project.
sidebar:
  order: 3
---

# Export \`.scape\`

The project is stored locally and the file remains available.
`);
	const client = fakeClient([
		{ locale: 'de', title: 'Export <docs-ai-token id="0001"/>', description: 'Ein lokales Projekt exportieren.', extra: true },
		{ locale: 'de', title: 'Export <docs-ai-token id="0001"/>', description: 'Ein lokales Projekt exportieren.' },
		{ locale: 'de', markdown: '# Export\n\nDas Projekt wird lokal gespeichert und die Datei bleibt verfügbar.\n' },
		{ locale: 'de', markdown: '# Export <docs-ai-token id="0001"/>\n\nDas Projekt wird lokal gespeichert und die Datei bleibt verfügbar.\n' },
	]);

	await translateDocument({
		sourcePath,
		targetPath,
		targetLocale: 'de',
		client,
		cacheDirectory: join(directory, 'cache'),
		maxChunkChars: 2_000,
	});
	assert.equal(client.requestCount, 4);
	assert.match(client.requests[1].prompt, /Translated frontmatter response must contain exactly/u);
	assert.match(client.requests[3].prompt, /Model changed protected Markdown tokens/u);
	const target = await readFile(targetPath, 'utf8');
	assert.match(target, /title: "Export \.scape"/u);
	assert.match(target, /sidebar:\n[ ]{2}order: 3/u);
});
