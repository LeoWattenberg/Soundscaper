/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMotionscaperStageInventory, verifyMotionscaperDesktopStage, verifyMotionscaperPackagedResources } from '../scripts/lib/motionscaper-desktop-package.mjs';

import { createPackage } from '@electron/asar';
import { DESKTOP_CODEC_POLICY } from '../scripts/lib/desktop-codec-policy.mjs';

interface BuilderConfiguration {
	appId: string; productName: string; beforePack: string; fileAssociations: { ext: string | string[] }[];
	mac: { entitlements: string; extendInfo: Record<string, string> }; linux: { executableName: string };
}

test('Motionscaper packaging selects an independent shell, native policy, and project association', () => {
	const config = JSON.parse(execFileSync(process.execPath, ['-e', 'console.log(JSON.stringify(require("./electron-builder.config.cjs")))'], {
		cwd: new URL('../', import.meta.url), env: { ...process.env, SCAPE_PRODUCT: 'motionscaper' }, encoding: 'utf8',
	})) as BuilderConfiguration;
	assert.equal(config.appId, 'org.motionscaper.desktop');
	assert.equal(config.productName, 'Motionscaper');
	assert.equal(config.linux.executableName, 'motionscaper');
	assert.equal(config.beforePack, './scripts/motionscaper-desktop-before-pack.mjs');
	assert.equal(config.mac.entitlements, 'desktop/motionscaper-entitlements.mac.plist');
	assert.deepEqual(config.mac.extendInfo, {});
	assert.deepEqual(config.fileAssociations.map((entry) => entry.ext), ['mscape', 'scape']);
});

test('Motionscaper shell stage authenticates bytes and rejects undeclared native payloads', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-stage-'));
	try {
		for (const directory of ['app/desktop', 'renderer', 'runtime', 'licenses']) await mkdir(join(root, directory), { recursive: true });
		for (const file of ['app/desktop/main.mjs', 'app/desktop/preload.cjs', 'app/desktop/product.json', 'app/package.json', 'renderer/index.html']) {
			await writeFile(join(root, file), file);
		}
		await writeFile(join(root, 'app/desktop/native-payload.json'), JSON.stringify({ schemaVersion: 1, productId: 'motionscaper', helperContractVersion: 1, carrierVersion: 1, target: 'linux-x64', helper: null }));
		await writeFile(join(root, 'app/desktop/native-notices.md'), '');
		const files = await createMotionscaperStageInventory(root);
		const stage = { schemaVersion: 1, productId: 'motionscaper', nativeServiceProfile: 'motionscaper-desktop-v1', target: { platform: 'linux', arch: 'x64' }, nativeCapabilities: ['project-files-v1'], desktopCodecPolicy: DESKTOP_CODEC_POLICY, files };
		await writeFile(join(root, 'stage-manifest.json'), JSON.stringify(stage));
		const resources = join(root, 'resources');
		await mkdir(resources);
		await createPackage(join(root, 'app'), join(resources, 'app.asar'));
		await cp(join(root, 'renderer'), join(resources, 'renderer'), { recursive: true });
		await verifyMotionscaperPackagedResources(resources, stage);
		await mkdir(join(resources, 'runtime'));
		await writeFile(join(resources, 'runtime/foreign.node'), 'unadmitted');
		await assert.rejects(verifyMotionscaperPackagedResources(resources, stage), /inventory/u);
		await rm(join(resources, 'runtime'), { recursive: true });
		assert.equal((await verifyMotionscaperDesktopStage(root, 'linux-x64')).productId, 'motionscaper');
		await assert.rejects(verifyMotionscaperDesktopStage(root, 'win-x64'), /target/u);
		await writeFile(join(root, 'runtime/foreign.node'), 'unadmitted');
		await assert.rejects(verifyMotionscaperDesktopStage(root, 'linux-x64'), /native|inventory/u);
		await rm(join(root, 'runtime/foreign.node'));
		await writeFile(join(root, 'app/desktop/main.mjs'), 'modified');
		await assert.rejects(verifyMotionscaperDesktopStage(root, 'linux-x64'), /digest|inventory/u);
	} finally { await rm(root, { recursive: true, force: true }); }
});
