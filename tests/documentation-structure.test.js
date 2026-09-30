/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const DOCUMENTATION_ROOT = resolve(REPOSITORY_ROOT, 'docs');
const DOCUMENTATION_SECTIONS = new Set([
	'architecture',
	'decisions',
	'development',
	'features',
	'operations',
	'policies',
	'reference',
	'research',
]);
const LINKED_DOCUMENTS = [
	resolve(REPOSITORY_ROOT, 'CONTRIBUTING.md'),
	resolve(REPOSITORY_ROOT, 'README.md'),
	resolve(REPOSITORY_ROOT, 'Technical_README.md'),
	resolve(REPOSITORY_ROOT, 'roadmap-lightscaper.md'),
	resolve(REPOSITORY_ROOT, 'roadmap.md'),
];

test('engineering documentation is organized by reader task and indexed', async () => {
	const files = await markdownFiles(DOCUMENTATION_ROOT);
	const relativeFiles = files.map((path) => relative(DOCUMENTATION_ROOT, path));
	assert.deepEqual(
		relativeFiles.filter((path) => !path.includes(sep)),
		['README.md'],
		'docs/ should have one entry point instead of another flat document list',
	);
	for (const path of relativeFiles.filter((candidate) => candidate !== 'README.md')) {
		assert.ok(DOCUMENTATION_SECTIONS.has(path.split(sep)[0]), `unknown documentation section: ${path}`);
		assert.doesNotMatch(
			path,
			/(?:^|[/.-])(?:milestones?|work-packets?|wp-?\d)(?:[/.-]|$)|(?:^|[/.-])plan\.md$/iu,
			`implementation chronology belongs in a roadmap or Git history: ${path}`,
		);
	}

	const indexPath = resolve(DOCUMENTATION_ROOT, 'README.md');
	const indexedDocuments = markdownLinks(await readFile(indexPath, 'utf8'))
		.map((target) => resolveMarkdownTarget(indexPath, target))
		.filter((target) => target?.startsWith(`${DOCUMENTATION_ROOT}${sep}`))
		.map((target) => relative(DOCUMENTATION_ROOT, target));
	const indexed = new Set(indexedDocuments);
	assert.deepEqual(
		[...indexed].sort(),
		relativeFiles.filter((path) => path !== 'README.md').sort(),
		'docs/README.md should link every maintained engineering document',
	);
	for (const path of indexed) {
		assert.equal(
			indexedDocuments.filter((candidate) => candidate === path).length,
			1,
			`docs/README.md should link ${path} exactly once`,
		);
	}
});

test('local links in engineering documentation and its entry points resolve', async () => {
	const files = [...await markdownFiles(DOCUMENTATION_ROOT), ...LINKED_DOCUMENTS];
	const missing = [];
	const missingFragments = [];
	const machineLocal = [];
	for (const path of files) {
		const source = await readFile(path, 'utf8');
		for (const target of markdownLinks(source)) {
			if (/^(?:file:\/\/|\/(?:home|Users)\/)/u.test(target)) {
				machineLocal.push(`${relative(REPOSITORY_ROOT, path)} -> ${target}`);
				continue;
			}
			const resolved = resolveMarkdownTarget(path, target) ?? (target.startsWith('#') ? path : null);
			if (!resolved) continue;
			try {
				await access(resolved);
			} catch {
				missing.push(`${relative(REPOSITORY_ROOT, path)} -> ${target}`);
				continue;
			}
			const fragment = target.includes('#') ? decodeURIComponent(target.split('#')[1]) : '';
			if (fragment && !markdownAnchors(await readFile(resolved, 'utf8')).has(fragment)) {
				missingFragments.push(`${relative(REPOSITORY_ROOT, path)} -> ${target}`);
			}
		}
	}
	assert.deepEqual(missing, []);
	assert.deepEqual(missingFragments, [], 'documentation section links must resolve');
	assert.deepEqual(machineLocal, [], 'documentation links must work outside one developer machine');
});

async function markdownFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const paths = await Promise.all(entries.map(async (entry) => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory() ? markdownFiles(path) : path.endsWith('.md') ? [path] : [];
	}));
	return paths.flat().sort();
}

function markdownLinks(source) {
	const prose = source
		.replace(/^(?:```|~~~)[\s\S]*?^(?:```|~~~)[ \t]*$/gmu, '')
		.replace(/`[^`\n]*`/gu, '');
	return [...prose.matchAll(/(?<!!)\[[^\]]*\]\((?<target><[^>\n]+>|[^\s)]+)(?:\s+[^)]*)?\)/gu)]
		.map(({ groups }) => groups.target.replace(/^<|>$/gu, ''));
}

function markdownAnchors(source) {
	const anchors = new Set(
		[...source.matchAll(/<a\s+[^>]*id=["'](?<id>[^"']+)["'][^>]*>/giu)]
			.map(({ groups }) => groups.id),
	);
	const occurrences = new Map();
	for (const { groups } of source.matchAll(/^#{1,6}[ \t]+(?<heading>.+?)[ \t]*#*[ \t]*$/gmu)) {
		const explicitId = groups.heading.match(/[ \t]+\{#(?<id>[^}]+)\}[ \t]*$/u)?.groups.id;
		const base = explicitId ?? groups.heading
			.replace(/[ \t]+\{#[^}]+\}[ \t]*$/u, '')
			.replace(/!??\[(?<label>[^\]]*)\]\([^)]*\)/gu, '$<label>')
			.replace(/<[^>]+>/gu, '')
			.replace(/[\x60*_~]/gu, '')
			.toLocaleLowerCase('en-US')
			.replace(/[^\p{Letter}\p{Number}\s_-]/gu, '')
			.trim()
			.replace(/\s+/gu, '-');
		const occurrence = occurrences.get(base) ?? 0;
		anchors.add(occurrence === 0 ? base : base + '-' + occurrence);
		occurrences.set(base, occurrence + 1);
	}
	return anchors;
}

function resolveMarkdownTarget(sourcePath, target) {
	if (!target || target.startsWith('#') || target.startsWith('/')
		|| /^[a-z][a-z\d+.-]*:/iu.test(target)) return null;
	const path = decodeURIComponent(target.split('#')[0]);
	return path ? resolve(dirname(sourcePath), path) : null;
}
