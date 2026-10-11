/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPackage } from '@electron/asar';
import { createFramescaperSuccessorStageInventory, verifyFramescaperSuccessorDesktopStage, verifyFramescaperSuccessorPackagedResources } from '../scripts/lib/framescaper-successor-desktop-package.ts';
import { DESKTOP_CODEC_POLICY } from '../scripts/lib/desktop-codec-policy.mjs';
test('Motion consumer successor stage authenticates its complete isolated package and rejects baseline/native inventory', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-successor-stage-')); try {
		for (const directory of ['app/desktop', 'renderer', 'runtime']) await mkdir(join(root, directory), { recursive: true });
		for (const file of ['app/desktop/main.mjs', 'app/desktop/preload.cjs', 'renderer/index.html']) await writeFile(join(root, file), file);
		const metadata = { schemaVersion: 1, id: 'framescaper', line: 'successor', desktopProfile: 'framescaper-successor-v2', applicationVersion: '1.1.0-dev.1', projectSchemaVersion: 2, releaseEligible: false };
		await writeFile(join(root, 'app/desktop/product.json'), JSON.stringify(metadata)); await writeFile(join(root, 'app/package.json'), JSON.stringify({ name: 'framescaper-successor-desktop', version: metadata.applicationVersion, main: 'desktop/main.mjs', type: 'module' }));
		const stage = { schemaVersion: 1, productId: 'framescaper', line: 'successor', nativeServiceProfile: 'framescaper-successor-v2', applicationVersion: metadata.applicationVersion,
			releaseEligible: false, target: { platform: 'linux', arch: 'x64' }, nativeCapabilities: ['motion-saved-files-v1'], desktopCodecPolicy: DESKTOP_CODEC_POLICY, files: await createFramescaperSuccessorStageInventory(root) } as const;
		await writeFile(join(root, 'stage-manifest.json'), JSON.stringify(stage)); assert.equal((await verifyFramescaperSuccessorDesktopStage(root, 'linux-x64')).line, 'successor');
		await assert.rejects(verifyFramescaperSuccessorDesktopStage(root, 'win-x64'), /identity|target/iu);
		const resources = join(root, 'resources'); await mkdir(resources); await createPackage(join(root, 'app'), join(resources, 'app.asar')); await cp(join(root, 'renderer'), join(resources, 'renderer'), { recursive: true });
		await verifyFramescaperSuccessorPackagedResources(resources, stage);
		await mkdir(join(resources, 'runtime')); await writeFile(join(resources, 'runtime/foreign.node'), 'unadmitted'); await assert.rejects(verifyFramescaperSuccessorPackagedResources(resources, stage), /inventory|runtime/iu);
		await writeFile(join(root, 'runtime/foreign.node'), 'unadmitted'); await assert.rejects(verifyFramescaperSuccessorDesktopStage(root, 'linux-x64'), /native|runtime/iu); await rm(join(root, 'runtime/foreign.node'));
		await writeFile(join(root, 'app/desktop/product.json'), JSON.stringify({ ...metadata, line: 'baseline' })); await assert.rejects(verifyFramescaperSuccessorDesktopStage(root, 'linux-x64'), /identity/iu);
	} finally { await rm(root, { force: true, recursive: true }); }
});
