/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { staticRouteGeneratorArguments } from './helpers/static-route-generator-subprocess.ts';

interface V8Profile {
	readonly result: readonly {
		readonly url: string;
		readonly functions: readonly { readonly functionName: string }[];
	}[];
	readonly 'source-map-cache'?: Record<string, {
		readonly data?: { readonly sources?: readonly string[] };
	}>;
}

test('route generator test subprocess uses the same mapped TypeScript representation as Node tests', () => {
	const root = mkdtempSync(join(tmpdir(), 'scape-route-coverage-'));
	try {
		const outputRoot = join(root, 'site');
		const coverageRoot = join(root, 'coverage');
		mkdirSync(outputRoot);
		mkdirSync(coverageRoot);
		// A minimal standalone fixture is enough to run the real route generator.
		writeFileSync(join(outputRoot, 'index.html'), '<!doctype html><html><head><!-- route-head --></head><body><div id="app"></div></body></html>');
		writeFileSync(join(outputRoot, '_headers'), readFileSync('public/_headers', 'utf8'));
		execFileSync(process.execPath, staticRouteGeneratorArguments(outputRoot), {
			cwd: process.cwd(),
			env: { ...process.env, NODE_V8_COVERAGE: coverageRoot },
		});
		const profiles = readdirSync(coverageRoot).map((name) => JSON.parse(
			readFileSync(join(coverageRoot, name), 'utf8'),
		) as V8Profile);
		const path = '/src/common/project-file-extensions.ts';
		const observed = profiles.flatMap((profile) => profile.result
			.filter(({ url }) => url.endsWith(path))
			.map((script) => ({ script, sourceMap: profile['source-map-cache']?.[script.url] })));
		assert.equal(observed.length, 1);
		assert.ok(observed[0]?.sourceMap?.data?.sources?.some((source) => source.endsWith(path)));
		assert.equal(observed[0]?.script.functions.filter(
			({ functionName }) => functionName === 'projectFileExtensionForProduct',
		).length, 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
