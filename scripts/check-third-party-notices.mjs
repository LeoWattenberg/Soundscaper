#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { thirdPartyNoticeRecordsVersion } from './lib/third-party-notice-version.mjs';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
const notices = readFileSync(resolve(root, 'THIRD_PARTY_LICENSES.md'), 'utf8');
const declared = { ...packageJson.dependencies, ...packageJson.devDependencies };

const trackedVersions = [
	'@axe-core/playwright',
	'@echogarden/pffft-wasm',
	'@electron/fuses',
	'@ffmpeg/core',
	'@ffmpeg/ffmpeg',
	'@ffmpeg/types',
	'@fontsource/inter',
	'@fontsource/ubuntu',
	'@noble/hashes',
	'@playwright/test',
	'@resvg/resvg-js',
	'@sqlite.org/sqlite-wasm',
	'@types/dom-mediacapture-transform',
	'@types/dom-webcodecs',
	'@zip.js/zip.js',
	'axe-core',
	'electron',
	'fflate',
	'mediabunny',
	'playwright',
	'playwright-core',
	'react',
	'react-dom',
	'saxes',
	'scheduler',
	'sql.js',
	'wawoff2',
	'xmlchars',
];

const findings = [];
for (const dependency of trackedVersions) {
	const expected = exactInstalledVersion(dependency);
	if (!expected) findings.push(`${dependency}: missing exact lockfile version.`);
	else if (!thirdPartyNoticeRecordsVersion(notices, dependency, expected)) {
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

const upstream = readFileSync(resolve(root, 'vendor/audacity-design-system/UPSTREAM'), 'utf8');
const upstreamTag = upstream.match(/^tag: (\S+)$/mu)?.[1];
const upstreamCommit = upstream.match(/^commit: ([0-9a-f]{40})$/mu)?.[1];
if (!upstreamTag || !upstreamCommit) {
	findings.push('vendored design system: UPSTREAM is missing its tag or commit record.');
} else {
	if (!notices.includes(`\`${upstreamTag}\``)) findings.push(`vendored design system: THIRD_PARTY_LICENSES.md does not record upstream tag ${upstreamTag}.`);
	if (!notices.includes(`\`${upstreamCommit}\``)) findings.push(`vendored design system: THIRD_PARTY_LICENSES.md does not record upstream commit ${upstreamCommit}.`);
}

if (findings.length) throw new Error(`Third-party notice audit failed:\n${findings.join('\n')}`);
console.log(`Verified ${trackedVersions.length + 1} dependency notice records against package-lock.json and the vendored design-system provenance.`);

function exactInstalledVersion(dependency) {
	return packageLock.packages[`node_modules/${dependency}`]?.version || null;
}
