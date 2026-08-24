/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	isAuthenticatedFramescaperOpenFxPluginSnapshot,
	reauthenticateFramescaperOpenFxPluginSnapshot,
	snapshotFramescaperOpenFxPluginCandidate,
} from '../desktop/openfx-plugin-bundle-custody.ts';
import { stageOpenFxPluginBinary } from '../desktop/openfx-helper-plugin-staging.ts';
import { NativeMediaHelperFilesystem } from '../desktop/native-media-helper-filesystem.ts';

test('OpenFX custody snapshots the exact target bundle, resources, and native closure', async (context) => {
	const root = await fixture(context);
	const bundle = await bundleFixture(root);
	const admitted = await snapshotFramescaperOpenFxPluginCandidate(bundle, 'linux-x64');
	context.after(() => admitted.dispose());
	assert.equal(isAuthenticatedFramescaperOpenFxPluginSnapshot(admitted), true);
	assert.equal(isAuthenticatedFramescaperOpenFxPluginSnapshot(structuredClone({
		executable: admitted.executable, custody: admitted.custody,
	})), false);
	assert.equal(admitted.custody.kind, 'bundle');
	assert.equal(admitted.custody.fileCount, 3);
	assert.equal(admitted.custody.executableRelativePath,
		'Contents/Linux-x86-64/Effect.ofx');
	assert.equal(admitted.custody.runtimeClosure.length, 1);
	assert.match(admitted.custody.runtimeClosure[0]!.path, /libEffectSupport\.so$/u);
	assert.equal(admitted.custody.resources.length, 1);
	assert.match(admitted.custody.resources[0]!.path, /preset\.json$/u);
	assert.equal(String(await readFile(join(admitted.custody.rootPath, 'Contents/Resources/preset.json'))),
		'{"gain":1}\n');
	await reauthenticateFramescaperOpenFxPluginSnapshot(admitted);
});

test('OpenFX custody remains exact after the user bundle mutates', async (context) => {
	const root = await fixture(context);
	const bundle = await bundleFixture(root);
	const admitted = await snapshotFramescaperOpenFxPluginCandidate(
		join(bundle, 'Contents/Linux-x86-64/Effect.ofx'), 'linux-x64',
	);
	context.after(() => admitted.dispose());
	await writeFile(join(bundle, 'Contents/Resources/preset.json'), '{"gain":999}\n');
	await writeFile(join(bundle, 'Contents/Linux-x86-64/Effect.ofx'), elf('changed'));
	await reauthenticateFramescaperOpenFxPluginSnapshot(admitted);
	assert.notDeepEqual(await readFile(admitted.executable.path), await readFile(
		join(bundle, 'Contents/Linux-x86-64/Effect.ofx'),
	));
});

test('OpenFX custody rejects hostile mutation between copy and final source authentication', async (context) => {
	const root = await fixture(context);
	const bundle = await bundleFixture(root);
	await assert.rejects(() => snapshotFramescaperOpenFxPluginCandidate(bundle, 'linux-x64', {
		copy: async (...arguments_) => {
			await cp(...arguments_);
			await writeFile(join(bundle, 'Contents/Resources/preset.json'), '{"raced":true}\n');
		},
	}), /changed before immutable isolated custody/iu);
});

test('OpenFX custody rejects noncanonical bundle selections and snapshot tampering', async (context) => {
	const root = await fixture(context);
	const bundle = await bundleFixture(root);
	await assert.rejects(() => snapshotFramescaperOpenFxPluginCandidate(
		join(bundle, 'Contents/Resources/preset.json'), 'linux-x64',
	), /canonical executable/iu);
	const admitted = await snapshotFramescaperOpenFxPluginCandidate(bundle, 'linux-x64');
	context.after(() => admitted.dispose());
	await chmod(admitted.executable.path, 0o600);
	await writeFile(admitted.executable.path, elf('tampered'));
	await assert.rejects(
		() => reauthenticateFramescaperOpenFxPluginSnapshot(admitted),
		/changed after admission/iu,
	);
});

test('helper reopening grants resources read-only and only native bundle code read-execute', async (context) => {
	const root = await fixture(context);
	const bundle = await bundleFixture(root);
	const admitted = await snapshotFramescaperOpenFxPluginCandidate(bundle, 'linux-x64');
	context.after(() => admitted.dispose());
	const filesystem = new NativeMediaHelperFilesystem();
	context.after(() => filesystem.abort().catch(() => undefined));
	const staged = await stageOpenFxPluginBinary(
		filesystem, join(root, 'unused'), admitted.executable, new AbortController().signal,
	);
	assert.equal(staged.path, admitted.executable.path);
	assert.deepEqual(staged.resources.map(({ path, kind }) => ({ path, kind })), [{
		path: admitted.custody.resources[0]!.path, kind: 'file',
	}]);
	assert.deepEqual(staged.runtimeClosure.map(({ path, kind }) => ({ path, kind })), [{
		path: admitted.custody.runtimeClosure[0]!.path, kind: 'file',
	}]);
	await staged.revalidate();
	const cloned = structuredClone(admitted.executable);
	const resource = cloned.custody!.resources[0]!;
	const runtime = cloned.custody!.runtimeClosure[0]!;
	const forged = { ...cloned, custody: {
		...cloned.custody!, resources: [runtime], runtimeClosure: [resource],
	} };
	const forgedFilesystem = new NativeMediaHelperFilesystem();
	context.after(() => forgedFilesystem.abort().catch(() => undefined));
	await assert.rejects(() => stageOpenFxPluginBinary(
		forgedFilesystem, join(root, 'unused-forged'), forged,
		new AbortController().signal,
	), /masquerade|executable-mappable code/iu);
});

async function bundleFixture(root: string): Promise<string> {
	const bundle = join(root, 'Effect.ofx.bundle');
	await mkdir(join(bundle, 'Contents/Linux-x86-64'), { recursive: true });
	await mkdir(join(bundle, 'Contents/Resources'), { recursive: true });
	await writeFile(join(bundle, 'Contents/Linux-x86-64/Effect.ofx'), elf('module'));
	await writeFile(join(bundle, 'Contents/Linux-x86-64/libEffectSupport.so'), elf('library'));
	await writeFile(join(bundle, 'Contents/Resources/preset.json'), '{"gain":1}\n');
	return bundle;
}

function elf(value: string): Buffer {
	return Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from(value)]);
}

async function fixture(context: TestContext): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-openfx-custody-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}
