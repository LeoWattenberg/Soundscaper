import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertLocale,
	assertModelMarkdown,
	assertProtectionTokenParity,
	assertStructuralParity,
	chunkProtectedMarkdown,
	protectMarkdown,
	restoreMarkdown,
} from '../scripts/docs-ai/markdown.mjs';

const source = `---
title: Export a project
description: Keep this frontmatter byte-for-byte.
---

# Export \`.scape\` projects

Use [Export audio](https://docs.example.test/export?q=wav) with command \`file.export\`.
Keep command ID audio.export-selection and the .wav extension unchanged.

\`\`\`sh
soundscaper --output demo.wav
\`\`\`

<!-- authored-note -->
`;

test('Markdown protection keeps syntax-bearing content opaque to the model', () => {
	const protectedDocument = protectMarkdown(source);
	assert.doesNotMatch(protectedDocument.markdown, /https:\/\/docs\.example/u);
	assert.doesNotMatch(protectedDocument.markdown, /file\.export/u);
	assert.doesNotMatch(protectedDocument.markdown, /audio\.export-selection/u);

	const translated = protectedDocument.markdown
		.replace('Export', 'Exportieren')
		.replace('Use', 'Verwenden')
		.replace('Keep command ID', 'Befehls-ID beibehalten');
	const restored = restoreMarkdown(translated, protectedDocument.tokens);

	assert.match(restored, /title: Export a project/u);
	assert.match(restored, /\[Export audio\]\(https:\/\/docs\.example\.test\/export\?q=wav\)/u);
	assert.match(restored, /`file\.export`/u);
	assert.match(restored, /audio\.export-selection/u);
	assert.match(restored, /\.wav extension/u);
	assert.match(restored, /```sh\nsoundscaper --output demo\.wav\n```/u);
	assert.doesNotThrow(() => assertStructuralParity(source, restored));
});

test('restoration rejects dropped, duplicated, or invented protection tokens', () => {
	const protectedDocument = protectMarkdown(source);
	const firstToken = protectedDocument.tokens.keys().next().value;
	assert.throws(
		() => restoreMarkdown(protectedDocument.markdown.replace(firstToken, ''), protectedDocument.tokens),
		/missing or duplicated/u,
	);
	assert.throws(
		() => restoreMarkdown(`${protectedDocument.markdown}\n<docs-ai-token id="9999"/>`, protectedDocument.tokens),
		/unknown protection token/u,
	);
});

test('chunk validation rejects reordered protection tokens before caching', () => {
	const protectedDocument = protectMarkdown(source);
	const [first, second] = [...protectedDocument.tokens.keys()];
	const reordered = protectedDocument.markdown
		.replace(first, '<docs-ai-swap/>')
		.replace(second, first)
		.replace('<docs-ai-swap/>', second);

	assert.throws(() => assertProtectionTokenParity(protectedDocument.markdown, reordered), /changed protected/u);
});

test('protected Markdown is split into bounded paragraph-aware chunks', () => {
	const protectedDocument = protectMarkdown(`${source}\n${'A sentence. '.repeat(80)}`);
	const chunks = chunkProtectedMarkdown(protectedDocument.markdown, 180);

	assert.ok(chunks.length > 2);
	assert.ok(chunks.every((chunk) => chunk.length <= 180));
	assert.equal(chunks.join(''), protectedDocument.markdown);
});

test('locale checks accept German prose and reject an English response', () => {
	assert.doesNotThrow(() => assertLocale(
		'Dies ist eine deutsche Anleitung für das Projekt und die Datei wird lokal gespeichert.',
		'de',
	));
	assert.throws(
		() => assertLocale('This is an English guide and the project is stored locally with the file.', 'de'),
		/expected German/u,
	);
	assert.throws(() => assertLocale('Text', 'fr'), /unsupported locale/iu);
});

test('model Markdown validation rejects frontmatter, control bytes, and unclosed fences', () => {
	assert.doesNotThrow(() => assertModelMarkdown('# Guide\n\n```sh\ncommand\n```\n', { forbidFrontmatter: true }));
	assert.throws(
		() => assertModelMarkdown('---\ntitle: Invented\n---\n\nBody\n', { forbidFrontmatter: true }),
		/must not add frontmatter/u,
	);
	assert.throws(() => assertModelMarkdown('# Guide\n\n```sh\ncommand\n'), /unclosed fenced/u);
	assert.throws(() => assertModelMarkdown('Text\u0000'), /control characters/u);
});
