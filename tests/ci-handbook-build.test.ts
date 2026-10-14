/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { recordCiHandbookBuild, verifyCiHandbookBuild } from '../scripts/lib/ci-handbook-build.ts';

function fixture(context: TestContext) {
	const root = mkdtempSync(join(tmpdir(), 'checked-ci-handbook-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const buildRoot = join(root, 'dist');
	mkdirSync(buildRoot);
	const document = '<link rel="canonical" href="https://soundscaper.org/docs/"><link href="/docs/_astro/style.css">';
	writeFileSync(join(buildRoot, 'index.html'), document);
	return { buildRoot, receipt: join(root, 'receipt.json'), document };
}

test('checked handbook artifacts preserve bytes and inventory while tolerating uploaded file modes', context => {
	const scope = fixture(context);
	recordCiHandbookBuild(scope);
	assert.doesNotThrow(() => verifyCiHandbookBuild(scope));
	chmodSync(join(scope.buildRoot, 'index.html'), 0o600);
	assert.doesNotThrow(() => verifyCiHandbookBuild(scope));
	writeFileSync(join(scope.buildRoot, 'index.html'), 'corrupt handbook');
	assert.throws(() => verifyCiHandbookBuild(scope), /handbook artifact/u);
	writeFileSync(join(scope.buildRoot, 'index.html'), scope.document);
	writeFileSync(join(scope.buildRoot, 'extra.html'), 'unrecorded');
	assert.throws(() => verifyCiHandbookBuild(scope), /handbook artifact/u);
});

test('handbook reuse refuses other source revisions, missing receipts and wrong product routing', context => {
	const scope = fixture(context);
	recordCiHandbookBuild(scope);
	assert.throws(() => verifyCiHandbookBuild({ ...scope, sourceRevision: '0'.repeat(40) }), /handbook artifact/u);
	rmSync(scope.receipt);
	assert.throws(() => verifyCiHandbookBuild(scope), /handbook artifact/u);
	writeFileSync(join(scope.buildRoot, 'index.html'), scope.document.replace('soundscaper.org', 'framescaper.org'));
	assert.throws(() => recordCiHandbookBuild(scope), /another product or routing/u);
});
