import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
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

test('translation carries standalone protected blocks through without asking the model to repeat them', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-docs-ai-'));
	const sourcePath = join(directory, 'source.md');
	const targetPath = join(directory, 'target.md');
	const generatedComment = '<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->';
	await writeFile(sourcePath, `---
title: Guide
description: A generated guide.
---

${generatedComment}

Body.
`);
	const client = fakeClient([
		{ locale: 'de', title: 'Anleitung', description: 'Eine erzeugte Anleitung.' },
		{ locale: 'de', markdown: '\nDer Inhalt ist für Leser bestimmt und liegt in deutscher Sprache.\n' },
	]);

	await translateDocument({
		sourcePath,
		targetPath,
		targetLocale: 'de',
		client,
		cacheDirectory: join(directory, 'cache'),
		maxChunkChars: 2_000,
	});

	const bodyRequest = JSON.parse(client.requests[1].prompt.split('\n')[0]);
	assert.doesNotMatch(bodyRequest.markdown, /docs-ai-token/u);
	assert.match(await readFile(targetPath, 'utf8'), new RegExp(generatedComment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
});

test('translation preserves Markdown structure when a model trims chunk boundary whitespace', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-docs-ai-'));
	const sourcePath = join(directory, 'source.md');
	const targetPath = join(directory, 'target.md');
	await writeFile(sourcePath, `---
title: Chunk boundaries
description: A table split across model requests.
---

# First heading

The first section is here and the text is complete.

| Name | Description |
| --- | --- |
| One | The first item is here and it is useful. |
| Two | The second item is here and it is useful. |
`);
	let requestCount = 0;
	const client = {
		async identity() {
			return { model: 'qwen3:27b', digest: 'sha256:model' };
		},
		async generateJson({ prompt }) {
			requestCount += 1;
			const request = JSON.parse(prompt);
			if (!Object.hasOwn(request, 'markdown')) {
				return {
					locale: 'de',
					title: 'Abschnittsgrenzen',
					description: 'Eine über Modellanfragen aufgeteilte Tabelle.',
				};
			}
			return {
				locale: 'de',
				markdown: request.markdown
					.replaceAll('First', 'Erste')
					.replaceAll('The', 'Der')
					.replaceAll('first', 'erste')
					.replaceAll('second', 'zweite')
					.replaceAll('heading', 'Überschrift')
					.replaceAll('section', 'Abschnitt')
					.replaceAll(' is ', ' ist ')
					.replaceAll(' and ', ' und ')
					.replaceAll('here', 'hier')
					.replaceAll('text', 'Text')
					.replaceAll('complete', 'vollständig')
					.replaceAll('Description', 'Beschreibung')
					.replaceAll('One', 'Eins')
					.replaceAll('Two', 'Zwei')
					.replaceAll('item', 'Eintrag')
					.replaceAll('useful', 'nützlich')
					.trim(),
			};
		},
	};

	await translateDocument({
		sourcePath,
		targetPath,
		targetLocale: 'de',
		client,
		maxChunkChars: 80,
	});

	assert.ok(requestCount > 2, 'the body crossed at least one model-request boundary');
	const target = await readFile(targetPath, 'utf8');
	assert.match(target, /vollständig\.\n\n\| Name \| Beschreibung \|/u);
	assert.match(target, /nützlich\. \|\n\| Zwei/u);
});

function finalLinkFailureClient({ recover = false } = {}) {
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
		async generateJson({ prompt }) {
			requestCount += 1;
			requests.push(prompt);
			const request = JSON.parse(prompt.split('\n\nPrevious complete document failed final validation:')[0]);
			if (!Object.hasOwn(request, 'markdown')) {
				return { locale: 'de', title: 'Anleitung', description: 'Eine kurze Anleitung.' };
			}
			const retryingDocument = prompt.includes('Previous complete document failed final validation:');
			return {
				locale: 'de',
				markdown: request.markdown.replace(
					'[Read guide]',
					recover && retryingDocument ? '[Anleitung lesen]' : 'Anleitung lesen',
				),
			};
		},
	};
}

async function writeLinkedTranslationSource(directory) {
	const sourcePath = join(directory, 'source.md');
	await writeFile(sourcePath, `---
title: Guide
description: A short guide.
---

[Read guide](https://example.test/guide).
`);
	return sourcePath;
}

test('translation retries the complete document when individually valid chunks fail final validation', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-docs-ai-'));
	const sourcePath = await writeLinkedTranslationSource(directory);
	const cacheDirectory = join(directory, 'cache');
	const client = finalLinkFailureClient({ recover: true });

	await translateDocument({
		sourcePath,
		targetPath: join(directory, 'target.md'),
		targetLocale: 'de',
		client,
		cacheDirectory,
		maxChunkChars: 2_000,
	});

	assert.equal(client.requestCount, 3);
	assert.match(client.requests[2], /Previous complete document failed final validation/u);
	assert.match(await readFile(join(directory, 'target.md'), 'utf8'), /\[Anleitung lesen\]\(https:\/\/example\.test\/guide\)/u);
	const entries = await Promise.all((await readdir(cacheDirectory)).map(async (name) => (
		JSON.parse(await readFile(join(cacheDirectory, name), 'utf8'))
	)));
	assert.equal(entries.length, 2);
	assert.ok(entries.every((entry) => !entry.value.markdown || entry.value.markdown.includes('[Anleitung lesen]')));
});

test('translation does not cache any part of a document that exhausts final validation retries', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-docs-ai-'));
	const sourcePath = await writeLinkedTranslationSource(directory);
	const cacheDirectory = join(directory, 'cache');
	const client = finalLinkFailureClient();

	await assert.rejects(() => translateDocument({
		sourcePath,
		targetPath: join(directory, 'target.md'),
		targetLocale: 'de',
		client,
		cacheDirectory,
		maxChunkChars: 2_000,
	}), /changed protected content or document structure/u);

	assert.equal(client.requestCount, 4);
	await assert.rejects(() => readdir(cacheDirectory), { code: 'ENOENT' });
});
