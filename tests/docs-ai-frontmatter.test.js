import assert from 'node:assert/strict';
import test from 'node:test';

import {
	parseTranslatableFrontmatter,
	replaceTranslatableFrontmatter,
} from '../scripts/docs-ai/frontmatter.mjs';

const frontmatter = `---
title: Source title
description: "A source description with .scape."
editUrl: false
sidebar:
  order: 7
  badge:
    text: Keep exactly
---
`;

test('frontmatter translation changes only title and description lines', () => {
	assert.deepEqual(parseTranslatableFrontmatter(frontmatter), {
		title: 'Source title',
		description: 'A source description with .scape.',
	});
	assert.equal(replaceTranslatableFrontmatter(frontmatter, {
		title: 'Quelltitel',
		description: 'Eine Quellbeschreibung mit .scape.',
	}), `---
title: "Quelltitel"
description: "Eine Quellbeschreibung mit .scape."
editUrl: false
sidebar:
  order: 7
  badge:
    text: Keep exactly
---
`);
});

test('frontmatter translation refuses missing, multiline, duplicate, and invented metadata', () => {
	assert.throws(() => parseTranslatableFrontmatter('---\ndescription: Missing title\n---\n'), /title/u);
	assert.throws(() => parseTranslatableFrontmatter('---\ntitle: One\ntitle: Two\n---\n'), /duplicate/u);
	assert.throws(() => parseTranslatableFrontmatter('---\ntitle: |\n  Multiline\n---\n'), /single-line/u);
	assert.throws(
		() => replaceTranslatableFrontmatter('---\ntitle: Source\n---\n', { title: 'Ziel', description: 'Invented' }),
		/added a frontmatter description/u,
	);
});
