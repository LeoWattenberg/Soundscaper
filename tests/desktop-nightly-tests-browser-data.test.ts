/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, matchesGlob, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import { NIGHTLY_TEST_PAYLOAD_INPUTS } from '../scripts/lib/desktop-nightly-tests-staging.mjs';
import {
	collectBrowserMediaReferenceSpecifiers, needsBrowserMediaReferenceSyntaxTree,
} from './helpers/browser-media-source-references.ts';

const repositoryRoot = resolve(import.meta.dirname, '..');

test('nightly packaging retains media data opened by browser specs and helpers', async () => {
	const { default: config } = await import('../electron-builder.nightly-tests.config.cjs');
	assert.ok(Array.isArray(config.extraResources));
	const payload = config.extraResources.find(entry => typeof entry !== 'string' && entry.to === 'nightly-tests');
	assert.ok(payload && typeof payload !== 'string' && Array.isArray(payload.filter));
	const filter = payload.filter;
	const browserRoot = join(repositoryRoot, 'tests/browser');
	const references = new Map<string, Set<string>>();
	for (const entry of await readdir(browserRoot, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile() || !/\.[cm]?[jt]sx?$/u.test(entry.name)) continue;
		const importer = join(entry.parentPath, entry.name);
		const source = await readFile(importer, 'utf8');
		for (const specifier of collectBrowserMediaReferenceSpecifiers(importer, source)) {
			const path = resolve(dirname(importer), specifier);
			const input = relative(repositoryRoot, path).split(sep).join('/');
			const importers = references.get(input) ?? new Set<string>();
			importers.add(relative(repositoryRoot, importer));
			references.set(input, importers);
		}
	}
	assert.ok(references.size > 0, 'the audit must reach the browser media fixtures');
	const failures: string[] = [];
	for (const [input, importers] of references) {
		await readFile(join(repositoryRoot, input));
		const staged = NIGHTLY_TEST_PAYLOAD_INPUTS.find(entry => {
			const { source, kind } = entry;
			if (kind === 'file') return source === input;
			return input.startsWith(`${source}/`)
				&& !('exclude' in entry && entry.exclude.has(input.slice(source.length + 1).split('/')[0]));
		});
		if (!staged) {
			failures.push(`Missing ${input} (opened by ${[...importers].join(', ')})`);
			continue;
		}
		const packaged = staged.destination + input.slice(staged.source.length);
		assert.equal(resolve(repositoryRoot, packaged), resolve(repositoryRoot, input),
			`The browser fixture URL must resolve to its staged destination: ${input}`);
		if (!filter.some(pattern => matchesGlob(packaged, pattern))) {
			failures.push(`Packaging drops ${packaged}`);
		}
	}
	assert.deepEqual(failures, [], failures.join('\n'));
});

test('ordinary browser source can skip media-reference parsing', () => {
	const source = 'const view = <span>{`nested ${value}`}</span>; import "./fixture.js";';
	assert.equal(needsBrowserMediaReferenceSyntaxTree(source), false);
	assert.deepEqual(collectBrowserMediaReferenceSpecifiers('fixture.tsx', source), []);
});

test('browser media discovery reaches nested URL expressions and both literal forms', () => {
	const source = [
		'export const view = <span>{wrap({ image: new URL("../fixtures/one.base64", import.meta.url) })}</span>;',
		'const load = () => [new URL(`./two.base64`, import.meta.url), new URL("./two.base64", import.meta.url)];',
	].join('\n');
	assert.equal(needsBrowserMediaReferenceSyntaxTree(source), true);
	assert.deepEqual(collectBrowserMediaReferenceSpecifiers('fixture.tsx', source),
		['../fixtures/one.base64', './two.base64', './two.base64']);
});

test('escaped media suffixes, URL identifiers and string continuations still reach the syntax tree', () => {
	for (const source of [
		String.raw`new URL("./fixture\x2ebase64", import.meta.url);`,
		String.raw`new URL("./fixture.ba\u0073e64", import.meta.url);`,
		String.raw`new U\u0052L("./fixture.ba\se64", import.meta.url);`,
		'new URL("./fixture.ba\\\nse64", import.meta.url);',
		'new URL(`./fixture.ba\\u{73}e64`, import.meta.url);',
	]) {
		assert.equal(needsBrowserMediaReferenceSyntaxTree(source), true, source);
		assert.deepEqual(collectBrowserMediaReferenceSpecifiers('fixture.tsx', source), ['./fixture.base64'], source);
	}
});

test('browser media discovery retains the exact URL-constructor and import-meta admission', () => {
	const source = [
		'// new URL("./comment.base64", import.meta.url);',
		'const text = \'new URL("./text.base64", import.meta.url)\';',
		String.raw`const regular = /new URL\(".\/regexp.base64", import\.meta\.url\)/;`,
		'URL("./call.base64", import.meta.url);',
		'new globalThis.URL("./member.base64", import.meta.url);',
		'new OtherURL("./alias.base64", import.meta.url);',
		'new URL("./single.base64");',
		'new URL("./extra.base64", import.meta.url, "extra");',
		'new URL("./base.base64", window.location.href);',
		'new URL("./computed.base64", import.meta["url"]);',
		'new URL("https://example.test/remote.base64", import.meta.url);',
		'new URL("/absolute.base64", import.meta.url);',
		'new URL("./joined" + ".base64", import.meta.url);',
		'new URL(`./${name}.base64`, import.meta.url);',
		'new URL("./query.base64?raw", import.meta.url);',
		'new URL("./admitted.base64", import.meta.url);',
	].join('\n');
	assert.deepEqual(collectBrowserMediaReferenceSpecifiers('fixture.tsx', source), ['./admitted.base64']);
});
