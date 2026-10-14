/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { recordVerifiedInputTree, verifyInputTree } from '../scripts/lib/verified-ci-input-tree.ts';

test('a verified input tree binds identity, every byte, executable mode and the exact inventory', t => {
	const root = mkdtempSync(join(tmpdir(), 'verified-input-tree-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const tree = join(root, 'tree');
	mkdirSync(join(tree, 'empty'), { recursive: true });
	writeFileSync(join(tree, 'tool'), 'authenticated output', { mode: 0o755 });
	const receipt = join(root, 'receipt.json');
	recordVerifiedInputTree({ root: tree, receipt, identity: 'pinned-v1' });
	assert.equal(verifyInputTree({ root: tree, receipt, identity: 'pinned-v1' }), true);
	assert.equal(verifyInputTree({ root: tree, receipt, identity: 'changed-inputs' }), false);
	writeFileSync(join(tree, 'tool'), 'corrupted output');
	assert.equal(verifyInputTree({ root: tree, receipt, identity: 'pinned-v1' }), false);
	writeFileSync(join(tree, 'tool'), 'authenticated output');
	if (process.platform !== 'win32') {
		chmodSync(join(tree, 'tool'), 0o644);
		assert.equal(verifyInputTree({ root: tree, receipt, identity: 'pinned-v1' }), false);
		chmodSync(join(tree, 'tool'), 0o755);
	}
	writeFileSync(join(tree, 'extra'), 'extra');
	assert.equal(verifyInputTree({ root: tree, receipt, identity: 'pinned-v1' }), false);
	rmSync(join(tree, 'extra'));
	rmSync(join(tree, 'empty'), { recursive: true });
	assert.equal(verifyInputTree({ root: tree, receipt, identity: 'pinned-v1' }), false);
});

test('tree receipts admit exact workspace links but refuse escaping, replaced and symbolic roots', { skip: process.platform === 'win32' }, t => {
	const root = mkdtempSync(join(tmpdir(), 'verified-input-links-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const tree = join(root, 'tree');
	const workspace = join(root, 'workspace');
	mkdirSync(tree); mkdirSync(workspace);
	writeFileSync(join(tree, 'tool'), 'tool');
	symlinkSync('tool', join(tree, 'bin'));
	symlinkSync('../workspace', join(tree, 'workspace'));
	const options = { root: tree, receipt: join(root, 'receipt.json'), identity: 'pinned', allowedLinkRoots: [workspace] };
	recordVerifiedInputTree(options);
	assert.equal(verifyInputTree(options), true);
	rmSync(join(tree, 'workspace')); symlinkSync('../unbound', join(tree, 'workspace'));
	assert.equal(verifyInputTree(options), false);
	assert.throws(() => recordVerifiedInputTree(options), /escapes/u);
	symlinkSync(tree, join(root, 'alias'));
	assert.throws(() => recordVerifiedInputTree({ ...options, root: join(root, 'alias') }), /regular directory/u);
});

test('bad or missing receipts fall back without admitting a stale tree; receipts stay outside the tree', t => {
	const root = mkdtempSync(join(tmpdir(), 'verified-input-recovery-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const options = { root, receipt: join(root, '../missing-receipt.json'), identity: 'pinned' };
	assert.equal(verifyInputTree(options), false);
	assert.throws(() => recordVerifiedInputTree({ ...options, receipt: join(root, 'receipt.json') }), /outside/u);
	writeFileSync(join(root, 'input'), 'fresh');
	const receipt = join(root, '../receipt-' + process.pid + '.json');
	t.after(() => rmSync(receipt, { force: true }));
	recordVerifiedInputTree({ ...options, receipt });
	writeFileSync(receipt, '{broken');
	assert.equal(verifyInputTree({ ...options, receipt }), false);
	recordVerifiedInputTree({ ...options, receipt });
	assert.equal(verifyInputTree({ ...options, receipt }), true);
});
