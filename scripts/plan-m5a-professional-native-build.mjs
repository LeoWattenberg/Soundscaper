#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

import { createSoundscaperProfessionalNativeBuildPlan } from './lib/soundscaper-professional-native-build.mjs';
import { readMilestone5NativeSourceAcquisitions } from './lib/milestone-5-native-source-acquisitions.mjs';

const argumentsByName = Object.fromEntries(process.argv.slice(2).map((argument) => {
	const [key, ...rest] = argument.replace(/^--/u, '').split('=');
	return [key, rest.join('=')];
}));
const repositoryRoot = resolve(argumentsByName.root || process.cwd());
const sourcesRoot = resolve(argumentsByName.sources || 'native-sources');
const target = argumentsByName.target || `${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'}-${process.arch}`;
const register = readMilestone5NativeSourceAcquisitions(repositoryRoot);
const sourceIds = ['electron-node-api-headers', 'juce', 'clap', 'vst3-sdk', 'asio-sdk', 'lv2'];
const snapshotRoot = resolve(argumentsByName.snapshots || `.native-build/soundscaper-${target}-source-snapshots`);
mkdirSync(snapshotRoot, { recursive: false, mode: 0o700 });
const plan = createSoundscaperProfessionalNativeBuildPlan({
	repositoryRoot,
	target,
	buildRoot: resolve(argumentsByName.output || `.native-build/soundscaper-${target}`),
	sourceSnapshotRoot: snapshotRoot,
	sourceRoots: Object.fromEntries(sourceIds.map((id) => [
		id, resolve(sourcesRoot, id, 'source'),
	])),
	sourceArchives: Object.fromEntries(sourceIds.map((id) => [
		id,
		resolve(sourcesRoot, id, register.sources.find((source) => source.id === id).archive.fileName),
	])),
	...(argumentsByName['macos-sdk'] ? { macosSdkPath: argumentsByName['macos-sdk'] } : {}),
});
process.stdout.write(`${JSON.stringify(plan, null, '\t')}\n`);
