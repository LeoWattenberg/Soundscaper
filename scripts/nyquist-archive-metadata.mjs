#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');
const REVISION = 'ed168a19631ec48d0029dfb5c17d16c339a174c1';
const CATALOG_ORIGIN = 'https://plugins.audacityteam.org/';
const OUTPUT = resolve(ROOT, `evidence/nyquist-plugin-publication/catalog-metadata-${REVISION}.json`);
const MANIFEST = JSON.parse(gunzipSync(readFileSync(resolve(ROOT, 'tests/fixtures/nyquist-archive/manifest.json.gz'))));

function cleanMarkdown(value) {
	return value
		.replace(/\[([^\]]+)\]\((?:\\.|[^)\\])*\)/gu, '$1')
		.replace(/&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|(amp|quot|nbsp));/gu, (_, hex, decimal, named) => {
			if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));
			if (decimal !== undefined) return String.fromCodePoint(Number(decimal));
			return named === 'amp' ? '&' : named === 'quot' ? '"' : ' ';
		})
		.replace(/<[^>]+>/gu, ' ')
		.replace(/\\([^\s])/gu, '$1')
		.replace(/[*_]/gu, '')
		.replace(/\s+/gu, ' ')
		.trim();
}

function introFromSection(section) {
	const beforeDownload = section.split('{% file')[0]
		.replace(/\{% hint[^%]*%\}[\s\S]*?\{% endhint %\}/gu, '')
		.replace(/^!\[[^\]]*\]\([^)]*\)\s*$/gmu, '');
	return cleanMarkdown(beforeDownload.split(/\n\s*\n/u).find((paragraph) => paragraph.trim()) ?? '');
}

/** Extract the title and short description attached to each GitBook file block. */
export function extractNyquistCatalogRows(markdown, sourcePath) {
	const headings = [...markdown.matchAll(/^#{2,3}\s+(.+?)\s*$/gmu)];
	const sourcePage = new URL(sourcePath.replace(/\.md$/u, ''), CATALOG_ORIGIN).href;
	const rows = [];
	for (const [index, heading] of headings.entries()) {
		const section = markdown.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? markdown.length);
		const title = cleanMarkdown(heading[1]);
		const description = introFromSection(section);
		for (const match of section.matchAll(/\.gitbook\/assets\/([^"'<>]+?\.ny)(?=["'<>])/giu)) {
			const fileName = match[1] === 'dtmfrand (1).ny' ? 'dtmfrand.ny' : match[1];
			rows.push({ fileName, title, description, sourcePage });
		}
	}
	return rows;
}

function markdownFiles(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith('.md') ? [path] : [];
	});
}

function loudnessRows(markdown) {
	const sourcePage = `${CATALOG_ORIGIN}analyzers/loudness-compliance-checks`;
	const description = cleanMarkdown(markdown.split(/\n\s*\n/u)
		.find((paragraph) => paragraph.includes('These plugins provide the relevant checks')) ?? '');
	if (!description) throw new Error('Missing loudness check description.');
	const rows = [];
	const pattern = /<tr><td><a href="[^"]*\/([^"/]+\.ny)">[^<]*<\/a><\/td><td>([^<]+)<\/td><\/tr>/gu;
	for (const match of markdown.matchAll(pattern)) {
		const [, fileName, rawService] = match;
		const service = cleanMarkdown(rawService).replace(/^\((.*)\)$/u, '$1');
		const title = fileName === 'spotify-loud.ny' ? 'Spotify Loudness Check (loud preset)'
			: `${service} Loudness Check`;
		rows.push({ fileName, title, description, sourcePage });
	}
	return rows;
}

const DESCRIPTION_FALLBACKS = Object.freeze({
	'lfohp.ny': 'An alternative high-pass filter whose low-frequency oscillator sweeps the cutoff frequency.',
	'lfolp.ny': 'An alternative low-pass filter whose low-frequency oscillator sweeps the cutoff frequency.',
});

export function buildNyquistArchiveMetadata(upstreamRoot) {
	const revision = execFileSync('git', ['-C', upstreamRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
	if (revision !== REVISION) throw new Error(`Expected Audacity support revision ${REVISION}, got ${revision}.`);
	const rows = [];
	for (const directory of ['nyquist-plugins', 'analyzers']) {
		for (const file of markdownFiles(join(upstreamRoot, directory))) {
			rows.push(...extractNyquistCatalogRows(readFileSync(file, 'utf8'), relative(upstreamRoot, file)));
		}
	}
	rows.push(...loudnessRows(readFileSync(join(upstreamRoot, 'analyzers/loudness-compliance-checks.md'), 'utf8')));
	const byFile = new Map();
	for (const row of rows) {
		if (!MANIFEST.artifacts.some((artifact) => artifact.fileName === row.fileName)) continue;
		if (byFile.has(row.fileName)) {
			// ACX Check has a dedicated description as well as a service-table row.
			if (row.fileName === 'ACX-Check.ny' && row.sourcePage.endsWith('loudness-compliance-checks')) continue;
			throw new Error(`Duplicate catalog title for ${row.fileName}.`);
		}
		byFile.set(row.fileName, row);
	}
	const entries = MANIFEST.artifacts.map((artifact) => {
		const row = byFile.get(artifact.fileName);
		if (!row) throw new Error(`No catalog title for ${artifact.fileName}.`);
		const description = row.description || DESCRIPTION_FALLBACKS[artifact.fileName];
		if (!description || description.length > 700 || row.title.length > 160
			|| !artifact.sourcePages.includes(row.sourcePage)) {
			throw new Error(`Invalid catalog description or source for ${artifact.fileName}.`);
		}
		return { fileName: artifact.fileName, title: row.title, description, sourcePage: row.sourcePage };
	});
	return {
		schemaVersion: 1,
		archiveId: MANIFEST.archiveId,
		upstream: { repository: MANIFEST.upstream.repository, revision: REVISION },
		catalogUrl: CATALOG_ORIGIN + 'nyquist-plugins',
		entries,
	};
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
	const args = process.argv.slice(2);
	const sourceIndex = args.indexOf('--source-root');
	if (sourceIndex < 0 || !args[sourceIndex + 1] || args.some((arg) => !['--source-root', '--check', args[sourceIndex + 1]].includes(arg))) {
		throw new Error('Usage: node scripts/nyquist-archive-metadata.mjs --source-root <pinned audacity-support checkout> [--check]');
	}
	const contents = `${JSON.stringify(buildNyquistArchiveMetadata(resolve(args[sourceIndex + 1])), null, '\t')}\n`;
	if (args.includes('--check')) {
		if (readFileSync(OUTPUT, 'utf8') !== contents) throw new Error('Nyquist catalog metadata differs from its pinned source.');
	} else {
		writeFileSync(OUTPUT, contents);
	}
	process.stdout.write(`${OUTPUT}\n`);
}
