#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { execFile } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { assertFramescaperSuccessorSmoke } from '../desktop/framescaper-successor-smoke-evidence.ts';
import { verifyFramescaperSuccessorDesktopStage } from './lib/framescaper-successor-desktop-package.ts';
import { framescaperBuildApplicationVersion } from './lib/product-build-line.mjs';
if (process.argv.length !== 2) throw new Error('Successor packaged smoke accepts no arguments.');
const root = resolve(import.meta.dirname, '..'), arch = process.env.SOUNDSCAPER_DESKTOP_TARGET_ARCH || process.arch;
if (!['x64', 'arm64'].includes(arch)) throw new Error('Unsupported successor smoke architecture.');
const directories = { linux: `linux${arch === 'x64' ? '' : `-${arch}`}-unpacked/framescaper-successor`, win32: `win${arch === 'x64' ? '' : `-${arch}`}-unpacked/Framescaper Development.exe`, darwin: `mac${arch === 'x64' ? '' : `-${arch}`}/Framescaper Development.app/Contents/MacOS/Framescaper Development` };
const relativeExecutable = directories[process.platform]; if (!relativeExecutable) throw new Error('Unsupported successor smoke platform.');
const executable = join(root, 'release/framescaper-successor', relativeExecutable); await access(executable);
const stage = await verifyFramescaperSuccessorDesktopStage(join(root, '.desktop-build/framescaper-successor'), `${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform}-${arch}`);
const profile = await mkdtemp(join(tmpdir(), 'framescaper-successor-packaged-'));
const env = { ...process.env, SCAPE_PRODUCT: 'framescaper', SCAPE_FRAMESCAPER_LINE: 'successor', SCAPE_FRAMESCAPER_DESKTOP_PROFILE: 'framescaper-successor-v2' }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
try {
	const result = await promisify(execFile)(executable, ['--framescaper-successor-shell-smoke', '--disable-gpu', `--user-data-dir=${profile}`], { cwd: root, env, timeout: 120_000, maxBuffer: 1024 * 1024, killSignal: 'SIGKILL' });
	const evidence = assertFramescaperSuccessorSmoke(`${result.stdout}\n${result.stderr}`, { version: framescaperBuildApplicationVersion(root, 'successor', ''), platform: process.platform, arch, nativeDelivery: stage.nativeCapabilities.includes('frame-sequence-prores-v1') });
	console.log(`FRAMESCAPER_SUCCESSOR_PACKAGED_QUALIFIED ${JSON.stringify(evidence)}`);
} finally { await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }); }
