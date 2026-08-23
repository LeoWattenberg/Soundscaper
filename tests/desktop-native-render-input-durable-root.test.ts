/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, rmdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	createNativeRenderInputOwnedStage,
	createNativeRenderInputStageOwnership,
	nativeRenderInputStageDirectory,
	readNativeRenderInputOwnedStage,
	requireNativeRenderInputRoot,
} from '../desktop/native-services-render-input-durable-store.ts';

const STAGE_ID = 'a1'.repeat(20);

async function temporaryRoot(context: { after: (fn: () => unknown) => void }): Promise<string> {
	const base = await realpath(await mkdtemp(join(tmpdir(), 'framescaper-render-input-root-')));
	context.after(() => rm(base, { recursive: true, force: true }));
	return base;
}

function ownership() {
	return createNativeRenderInputStageOwnership(STAGE_ID, 1_000, 4, 'b2'.repeat(32), 'c3'.repeat(32));
}

/**
 * The root is whatever path the OS hands the desktop app, and that spelling is routinely a
 * legitimate alias of the canonical one: a `/var` symlink on macOS, an 8.3 short name such
 * as `C:\\Users\\RUNNER~1\\...` on Windows. Chromium resolves the former when it absolutizes
 * `--user-data-dir` and leaves the latter alone, so a Windows desktop start was refused for
 * a path that was never redirected at all.
 */
test('a root reached through an aliased ancestor is admitted and reported canonically', async (context) => {
	const base = await temporaryRoot(context);
	const real = join(base, 'real');
	await mkdir(join(real, 'render-inputs'), { recursive: true });
	await symlink(real, join(base, 'alias'), 'dir');

	const admitted = await requireNativeRenderInputRoot(join(base, 'alias/render-inputs'), false);
	assert.equal(admitted, join(real, 'render-inputs'));
	assert.equal(admitted, await realpath(admitted));
});

test('a root whose own entry is a link is refused', async (context) => {
	const base = await temporaryRoot(context);
	const real = join(base, 'real');
	await mkdir(real, { recursive: true });
	await symlink(real, join(base, 'linked-root'), 'dir');

	await assert.rejects(
		() => requireNativeRenderInputRoot(join(base, 'linked-root'), false),
		/changed filesystem identity/u,
	);
});

test('a stage directory replaced by a link is refused', async (context) => {
	const base = await temporaryRoot(context);
	const root = join(base, 'render-inputs');
	const stage = await createNativeRenderInputOwnedStage(root, ownership());
	assert.equal(stage.root, root);
	assert.equal(stage.directory, nativeRenderInputStageDirectory(root, STAGE_ID));

	const elsewhere = join(base, 'elsewhere');
	await mkdir(elsewhere, { recursive: true });
	await rmdir(stage.directory);
	await symlink(elsewhere, stage.directory, 'dir');

	await assert.rejects(
		() => readNativeRenderInputOwnedStage(root, STAGE_ID),
		/changed filesystem identity/u,
	);
});
