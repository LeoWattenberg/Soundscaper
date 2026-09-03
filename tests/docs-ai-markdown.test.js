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

test('restoration treats dollar replacement sequences as literal protected Markdown', () => {
	const literal = "```sh\npid=$$ whole=$& prefix=$` suffix=$'\n```\n";
	const protectedDocument = protectMarkdown(literal);
	assert.equal(restoreMarkdown(protectedDocument.markdown, protectedDocument.tokens), literal);
});

test('restoration resolves protection tokens nested inside a protected link destination', () => {
	const nested = 'See [the guide](<https://example.test/a b>) for details.';
	const protectedDocument = protectMarkdown(nested);

	assert.equal(restoreMarkdown(protectedDocument.markdown, protectedDocument.tokens), nested);
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

/**
 * The link-destination scan once kept "\\." and a bare character in overlapping
 * alternatives, so a run of backslashes that no ")" ever closed could be split
 * exponentially many ways. Thirty-two backslashes already cost twelve
 * milliseconds and each further pair multiplied that by about two and a half,
 * which put a single malformed link in a handbook page hours away from
 * returning. The budget below is far looser than the microseconds the disjoint
 * alternatives take, and still unreachable if the ambiguity comes back.
 */
test('an unterminated link destination cannot stall the protection pass', () => {
	const hostile = `[label](${'\\'.repeat(64)}`;
	const started = process.hrtime.bigint();
	const state = protectMarkdown(hostile);
	const elapsedMilliseconds = Number(process.hrtime.bigint() - started) / 1e6;
	assert.ok(
		elapsedMilliseconds < 2_000,
		`protecting an unterminated link destination took ${elapsedMilliseconds.toFixed(0)}ms`,
	);
	assert.equal(restoreMarkdown(state.markdown, state.tokens), hostile);
});

test('link protection still round-trips every destination form', () => {
	for (const sample of [
		'[guide](/guide/index.md)',
		'![shot](../media/shot.png)',
		'[guide][reference]',
		'[spaced](<a b.md>)',
		'[escaped](a\\(b\\).md)',
	]) {
		const state = protectMarkdown(sample);
		assert.equal(restoreMarkdown(state.markdown, state.tokens), sample);
	}
});
