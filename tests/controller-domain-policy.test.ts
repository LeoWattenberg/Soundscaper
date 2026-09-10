/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	CONTROLLER_DOMAINS,
	inspectControllerDomainTree,
} from '../scripts/lib/controller-domain-policy.mjs';

const FIXTURE_DOMAINS = ['alpha', 'beta'] as const;

function fixture(context: test.TestContext) {
	const root = mkdtempSync(join(tmpdir(), 'soundscaper-controller-domains-'));
	context.after(() => rmSync(root, { force: true, recursive: true }));
	for (const domain of FIXTURE_DOMAINS) mkdirSync(join(root, domain, 'internal'), { recursive: true });
	writeFileSync(join(root, 'alpha', 'alpha-api.ts'), 'export const alpha = true;\n');
	writeFileSync(join(root, 'alpha', 'internal', 'alpha-service.ts'), 'export const service = true;\n');
	writeFileSync(join(root, 'beta', 'beta-api.ts'), 'export interface Beta {}\n');
	return root;
}

function manifest(modules: readonly string[] = ['alpha/alpha-api.ts', 'beta/beta-api.ts']) {
	return { schemaVersion: 1 as const, modules };
}

test('the controller taxonomy stays explicit and stable', () => {
	assert.deepEqual(CONTROLLER_DOMAINS, [
		'analysis', 'assistance', 'capture', 'clip-video', 'composition', 'document', 'edit',
		'effects', 'export', 'import', 'preferences', 'recording', 'shared', 'source',
		'track-audio', 'transport',
	]);
});

test('a declared public surface and same-domain internals pass the structural policy', (context) => {
	assert.deepEqual(inspectControllerDomainTree({
		controllerRoot: fixture(context),
		domains: FIXTURE_DOMAINS,
		manifest: manifest(),
	}), []);
});

test('root source files and unknown or missing domains fail the structural policy', (context) => {
	const root = fixture(context);
	writeFileSync(join(root, 'stray.ts'), 'export {};\n');
	mkdirSync(join(root, 'misc'));
	rmSync(join(root, 'beta'), { recursive: true });
	const findings = inspectControllerDomainTree({
		controllerRoot: root,
		domains: FIXTURE_DOMAINS,
		manifest: manifest(['alpha/alpha-api.ts']),
	});
	assert.ok(findings.some((finding) => /root source.*stray\.ts/u.test(finding)));
	assert.ok(findings.some((finding) => /unknown controller domain.*misc/u.test(finding)));
	assert.ok(findings.some((finding) => /missing controller domain.*beta/u.test(finding)));
});

test('nested private modules must live under the domain internal directory', (context) => {
	const root = fixture(context);
	mkdirSync(join(root, 'alpha', 'helpers'));
	writeFileSync(join(root, 'alpha', 'helpers', 'hidden.ts'), 'export const hidden = true;\n');
	const findings = inspectControllerDomainTree({
		controllerRoot: root,
		domains: FIXTURE_DOMAINS,
		manifest: manifest(),
	});
	assert.ok(findings.some((finding) => /private controller module must live under internal.*alpha\/helpers\/hidden\.ts/u.test(finding)));
});

test('symlinks cannot bypass the controller inventory or private layout', (context) => {
	const root = fixture(context);
	symlinkSync(
		join(root, 'alpha', 'internal', 'alpha-service.ts'),
		join(root, 'alpha', 'linked-api.ts'),
	);
	const findings = inspectControllerDomainTree({
		controllerRoot: root,
		domains: FIXTURE_DOMAINS,
		manifest: manifest(),
	});
	assert.ok(findings.some((finding) => /controller symlink is forbidden.*alpha\/linked-api\.ts/u.test(finding)));
});

test('the checked-in inventory exactly matches direct public domain files', (context) => {
	const root = fixture(context);
	writeFileSync(join(root, 'alpha', 'undeclared.ts'), 'export {};\n');
	const findings = inspectControllerDomainTree({
		controllerRoot: root,
		domains: FIXTURE_DOMAINS,
		manifest: manifest(['alpha/alpha-api.ts', 'beta/beta-api.ts', 'beta/stale.ts']),
	});
	assert.ok(findings.some((finding) => /undeclared public controller module.*alpha\/undeclared\.ts/u.test(finding)));
	assert.ok(findings.some((finding) => /declared public controller module does not exist.*beta\/stale\.ts/u.test(finding)));
});

test('barrel names and value wildcard barrels fail without blocking narrow or type-only exports', (context) => {
	const root = fixture(context);
	writeFileSync(join(root, 'alpha', 'internal', 'index.ts'), 'export const indexed = true;\n');
	writeFileSync(join(root, 'alpha', 'forward.ts'), "export { service } from './internal/alpha-service.ts';\n");
	writeFileSync(join(root, 'beta', 'types.ts'), "export type * from './beta-api.ts';\n");
	writeFileSync(join(root, 'beta', 'wildcard.ts'), "export * from './beta-api.ts';\n");
	writeFileSync(join(root, 'beta', 'namespace.ts'), "export * as api from './beta-api.ts';\n");
	const findings = inspectControllerDomainTree({
		controllerRoot: root,
		domains: FIXTURE_DOMAINS,
		manifest: manifest([
			'alpha/alpha-api.ts', 'alpha/forward.ts', 'beta/beta-api.ts', 'beta/namespace.ts',
			'beta/types.ts', 'beta/wildcard.ts',
		]),
	});
	assert.ok(findings.some((finding) => /barrel filename.*alpha\/internal\/index\.ts/u.test(finding)));
	assert.deepEqual(findings.filter((finding) => /value wildcard export/u.test(finding)), [
		'controller value wildcard export is forbidden: beta/namespace.ts:1',
		'controller value wildcard export is forbidden: beta/wildcard.ts:1',
	]);
});

test('the public inventory must be versioned, sorted, unique, and contain direct source paths', (context) => {
	const root = fixture(context);
	const findings = inspectControllerDomainTree({
		controllerRoot: root,
		domains: FIXTURE_DOMAINS,
		manifest: {
			schemaVersion: 2 as 1,
			modules: ['beta/beta-api.ts', 'alpha/alpha-api.ts', 'alpha/alpha-api.ts', 'alpha/internal/no.ts'],
		},
	});
	assert.ok(findings.some((finding) => /schemaVersion must be 1/u.test(finding)));
	assert.ok(findings.some((finding) => /sorted and unique/u.test(finding)));
	assert.ok(findings.some((finding) => /must name a direct public source file.*alpha\/internal\/no\.ts/u.test(finding)));
});
