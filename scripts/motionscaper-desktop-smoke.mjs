#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertMotionscaperPackagedSmoke, runMotionscaperSmokeProcess } from '../desktop/motionscaper-packaged-smoke.ts';
import { resolvePackagedProductExecutable } from './lib/desktop-packaged-product-executable.mjs';
import { readProductReleaseLinesSync, resolveProductApplicationVersion } from './lib/product-release-lines.mjs';

if (process.argv.slice(2).some(argument => argument !== '--require-native-prores')) throw new Error('Unsupported Motionscaper smoke argument.');
const nativeProres = process.argv.includes('--require-native-prores');
const root = resolve(import.meta.dirname, '..');
const arch = process.env.SOUNDSCAPER_DESKTOP_TARGET_ARCH || process.arch;
const executable = resolvePackagedProductExecutable({
	productRoot: resolve(root, 'release/desktop-nightly-products'), productId: 'motionscaper', platform: process.platform, arch,
});
await access(executable);
const profile = await mkdtemp(join(tmpdir(), 'motionscaper-packaged-smoke-'));
try {
	const output = await runMotionscaperSmokeProcess({ command: executable,
		args: ['--motionscaper-shell-smoke', '--disable-gpu', `--user-data-dir=${profile}`], cwd: root, environment: process.env });
	const evidence = assertMotionscaperPackagedSmoke(output, { platform: process.platform, arch, nativeProres,
		version: resolveProductApplicationVersion('motionscaper', readProductReleaseLinesSync(root)) });
	console.log(`MOTIONSCAPER_PACKAGED_QUALIFIED ${JSON.stringify(evidence)}`);
} finally { await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }); }
