#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
const notices = readFileSync(resolve(root, 'THIRD_PARTY_LICENSES.md'), 'utf8');
const declared = { ...packageJson.dependencies, ...packageJson.devDependencies };

const trackedVersions = [
	'@dilsonspickles/components',
	'@echogarden/pffft-wasm',
	'@electron/fuses',
	'@ffmpeg/core',
	'@ffmpeg/ffmpeg',
	'@noble/hashes',
	'@resvg/resvg-js',
	'@sqlite.org/sqlite-wasm',
	'@zip.js/zip.js',
	'electron',
	'fflate',
	'saxes',
	'sql.js',
];

const findings = [];
for (const dependency of trackedVersions) {
	const expected = exactInstalledVersion(dependency);
	const noticeMarker = dependency === 'electron'
		? `Electron ${expected}`
		: `\`${dependency}\` ${expected}`;
	if (!expected) findings.push(`${dependency}: missing exact lockfile version.`);
	else if (!notices.includes(noticeMarker)) {
		findings.push(`${dependency}: THIRD_PARTY_LICENSES.md does not record locked version ${expected}.`);
	}
}

const builder = packageLock.packages['node_modules/electron-builder'];
const builderNotice = notices.match(/electron-builder ([^\s]+).*?<([^>]+)> \(`([^`]+)`\)/u);
if (!builder) findings.push('electron-builder: exact lockfile entry is missing.');
else if (!builderNotice) findings.push('electron-builder: version, tarball, and integrity notice is missing.');
else {
	const [, version, resolved, integrity] = builderNotice;
	if (declared['electron-builder'] !== builder.version) findings.push('electron-builder: package.json and package-lock.json versions differ.');
	if (version !== builder.version) findings.push(`electron-builder: notice version ${version} does not match ${builder.version}.`);
	if (resolved !== builder.resolved) findings.push('electron-builder: notice tarball URL does not match package-lock.json.');
	if (integrity !== builder.integrity) findings.push('electron-builder: notice integrity does not match package-lock.json.');
}

if (findings.length) throw new Error(`Third-party notice audit failed:\n${findings.join('\n')}`);
console.log(`Verified ${trackedVersions.length + 1} dependency notice records against package-lock.json.`);

function exactInstalledVersion(dependency) {
	if (!declared[dependency]) return null;
	return packageLock.packages[`node_modules/${dependency}`]?.version || null;
}
