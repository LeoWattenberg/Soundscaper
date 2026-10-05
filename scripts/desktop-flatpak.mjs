#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Repackage an audited Linux Debian application without rewriting its closure. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, readdir, readlink, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { extractFile } from '@electron/asar';

import { readProductReleaseLines, resolveProductApplicationVersion } from './lib/product-release-lines.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const executeFile = promisify(execFile);
const PRODUCTS = ['soundscaper', 'framescaper'];
const ARCHITECTURES = { x64: { deb: 'amd64', flatpak: 'x86_64' }, arm64: { deb: 'arm64', flatpak: 'aarch64' } };
const RUNTIME_VERSION = '25.08';
const RUNTIME_REPOSITORY = 'https://dl.flathub.org/repo/flathub.flatpakrepo';

export function parseDesktopFlatpakArguments(args) {
	const options = { branch: 'nightly' };
	const seen = new Set();
	for (let index = 0; index < args.length; index += 2) {
		const option = args[index];
		const value = args[index + 1];
		if (!['--packages', '--product', '--arch', '--output', '--branch'].includes(option)
			|| typeof value !== 'string' || value.length === 0 || value.startsWith('--') || seen.has(option)) {
			throw new Error(`Invalid Flatpak argument ${String(option)}.`);
		}
		seen.add(option);
		options[option.slice(2)] = value;
	}
	validateOptions(options);
	return options;
}

export async function buildDesktopFlatpak(options, { runCommand = run } = {}) {
	validateOptions(options);
	const repositoryRoot = resolve(options.repositoryRoot ?? ROOT);
	const packagesRoot = resolve(options.packages);
	const outputRoot = resolve(options.output ?? resolve(repositoryRoot, 'release/flatpak'));
	const { product, arch } = options;
	const branch = options.branch ?? 'nightly';
	const productName = product === 'framescaper' ? 'Framescaper' : 'Soundscaper';
	const applicationId = `org.${product}.desktop`;
	const architecture = ARCHITECTURES[arch];
	const version = resolveProductApplicationVersion(product, await readProductReleaseLines(repositoryRoot));
	const pattern = new RegExp(`^${productName}-${escapeRegex(version)}-linux-${arch === 'x64' ? '(?:x64|amd64)' : 'arm64'}\\.deb$`, 'u');
	const matches = (await readdir(packagesRoot, { withFileTypes: true }))
		.filter((entry) => pattern.test(entry.name));
	if (matches.length !== 1 || !matches[0].isFile() || matches[0].isSymbolicLink()) {
		throw new Error(`Flatpak requires exactly one regular matching ${product} ${arch} Debian package.`);
	}
	const debPath = resolve(packagesRoot, matches[0].name);
	const { stdout } = await runCommand('dpkg-deb', ['--field', debPath, 'Package', 'Version', 'Architecture']);
	const metadata = Object.fromEntries(String(stdout).trim().split('\n')
		.map((line) => line.split(/:\s*/u, 2)));
	if (metadata.Package !== `${product}-desktop` || metadata.Architecture !== architecture.deb
		|| metadata.Version !== version.replaceAll('-', '~')) {
		throw new Error('Flatpak Debian package metadata does not match its selected product, version, and architecture.');
	}
	const stageRoot = resolve(repositoryRoot, '.desktop-build/flatpak', `${product}-${arch}`);
	if (contained(stageRoot, packagesRoot) || contained(stageRoot, outputRoot)) {
		throw new Error('Flatpak input and output directories must be outside its staging directory.');
	}
	await rm(stageRoot, { recursive: true, force: true });
	const extractedRoot = resolve(stageRoot, 'package');
	await mkdir(extractedRoot, { recursive: true });
	await runCommand('dpkg-deb', ['--extract', debPath, extractedRoot]);
	const applicationRoot = resolve(extractedRoot, 'opt', productName);
	await requireRegularDirectory(applicationRoot, 'application');
	await requireRegularFile(resolve(applicationRoot, product), 'executable');
	const archivePath = resolve(applicationRoot, 'resources/app.asar');
	await requireRegularFile(archivePath, 'ASAR archive');
	const applicationMetadata = JSON.parse(extractFile(archivePath, 'package.json').toString('utf8'));
	if (applicationMetadata.name !== `${product}-desktop` || applicationMetadata.productName !== productName
		|| applicationMetadata.version !== version || applicationMetadata.desktopName !== `org.${product}.desktop`) {
		throw new Error('Flatpak application metadata does not match its selected product and version.');
	}
	const applicationClosure = await describeApplicationClosure(applicationRoot);
	const integrationRoot = resolve(stageRoot, 'integration');
	await mkdir(integrationRoot);
	await writeFile(resolve(integrationRoot, product),
		`#!/bin/sh\nexec zypak-wrapper /app/${productName}/${product} --ozone-platform=x11 "$@"\n`, { mode: 0o755 });
	await writeFile(resolve(integrationRoot, `${applicationId}.desktop`), desktopEntry(product, productName, applicationId));
	const mimePath = resolve(extractedRoot, 'usr/share/mime/packages', `${product}.xml`);
	await requireRegularFile(mimePath, 'project MIME definitions');
	await cp(mimePath, resolve(integrationRoot, `${applicationId}.xml`));
	const iconPath = await packageIcon(extractedRoot, product);
	await cp(iconPath.path, resolve(integrationRoot, `${applicationId}.png`));
	const manifest = flatpakManifest({ product, productName, applicationId, branch, iconSize: iconPath.size });
	const stagedManifest = resolve(stageRoot, `${applicationId}.json`);
	await writeFile(stagedManifest, `${JSON.stringify(manifest, null, 2)}\n`);
	const repository = resolve(stageRoot, 'repo');
	const buildRoot = resolve(stageRoot, 'build');
	await runCommand('flatpak-builder', [
		'--user', '--force-clean', '--disable-rofiles-fuse', '--disable-cache',
		`--state-dir=${resolve(stageRoot, 'state')}`, `--repo=${repository}`,
		`--arch=${architecture.flatpak}`, buildRoot, stagedManifest,
	]);
	const installedClosure = await describeApplicationClosure(resolve(buildRoot, 'files', productName));
	if (JSON.stringify(installedClosure) !== JSON.stringify(applicationClosure)) {
		throw new Error('Flatpak builder changed the authenticated application closure.');
	}
	await mkdir(outputRoot, { recursive: true });
	const bundlePath = resolve(outputRoot, `${productName}-${version}-linux-${arch}.flatpak`);
	const checksumPath = `${bundlePath}.sha256`;
	await rm(bundlePath, { force: true });
	await rm(checksumPath, { force: true });
	await runCommand('flatpak', [
		'build-bundle', `--arch=${architecture.flatpak}`, `--runtime-repo=${RUNTIME_REPOSITORY}`,
		repository, bundlePath, applicationId, branch,
	]);
	await requireRegularFile(bundlePath, 'bundle');
	await writeFile(checksumPath, `${await fileSha256(bundlePath)}  ${basename(bundlePath)}\n`);
	const manifestPath = resolve(outputRoot, `${product}-${arch}-manifest.json`);
	await cp(stagedManifest, manifestPath);
	return { bundlePath, checksumPath, manifestPath, applicationId, branch };
}

function flatpakManifest({ product, productName, applicationId, branch, iconSize }) {
	return {
		id: applicationId,
		branch,
		runtime: 'org.freedesktop.Platform',
		'runtime-version': RUNTIME_VERSION,
		sdk: 'org.freedesktop.Sdk',
		base: 'org.electronjs.Electron2.BaseApp',
		'base-version': RUNTIME_VERSION,
		command: product,
		// Default debuginfo extraction rewrites ELF bytes pinned by runtime manifests.
		'build-options': { strip: false, 'no-debuginfo': true },
		'finish-args': [
			'--share=ipc', '--socket=x11', '--socket=pulseaudio',
			'--device=dri', '--share=network', '--filesystem=host',
		],
		modules: [{
			name: product,
			buildsystem: 'simple',
			'build-commands': [
				`cp -a application /app/${productName}`,
				`install -Dm755 integration/${product} /app/bin/${product}`,
				`install -Dm644 integration/${applicationId}.desktop /app/share/applications/${applicationId}.desktop`,
				`install -Dm644 integration/${applicationId}.xml /app/share/mime/packages/${applicationId}.xml`,
				`install -Dm644 integration/${applicationId}.png /app/share/icons/hicolor/${iconSize}x${iconSize}/apps/${applicationId}.png`,
			],
			sources: [
				{ type: 'dir', path: `package/opt/${productName}`, dest: 'application' },
				{ type: 'dir', path: 'integration', dest: 'integration' },
			],
		}],
	};
}

function desktopEntry(product, productName, applicationId) {
	const framescaper = product === 'framescaper';
	return [
		'[Desktop Entry]', `Name=${productName}`, `Exec=${product} %U`, 'Terminal=false', 'Type=Application',
		`Icon=${applicationId}`, `StartupWMClass=org.${product}`,
		`Comment=Local-first ${framescaper ? 'video' : 'multitrack audio'} editor`,
		`Categories=AudioVideo;${framescaper ? 'Video' : 'Audio'};`,
		`MimeType=application/vnd.soundscaper.scape+zip;${framescaper ? '' : 'application/x-audacity-project;'}`,
		'',
	].join('\n');
}

async function packageIcon(root, product) {
	for (const size of [512, 256, 1024, 128, 64]) {
		const path = resolve(root, `usr/share/icons/hicolor/${size}x${size}/apps/${product}.png`);
		const metadata = await lstat(path).catch((error) => {
			if (error.code === 'ENOENT') return null;
			throw error;
		});
		if (metadata?.isFile() && !metadata.isSymbolicLink() && metadata.size > 0) return { path, size };
	}
	throw new Error('Flatpak Debian package contains no regular product icon.');
}

async function describeApplicationClosure(root) {
	await requireRegularDirectory(root, 'installed application');
	const files = [];
	async function visit(directory) {
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
		for (const entry of entries) {
			const path = resolve(directory, entry.name);
			const metadata = await lstat(path);
			const name = relative(root, path);
			if (metadata.isDirectory()) await visit(path);
			else if (metadata.isFile()) files.push({ path: name, sha256: await fileSha256(path), mode: metadata.mode & 0o777 });
			else if (metadata.isSymbolicLink()) {
				const target = await readlink(path);
				if (isAbsolute(target) || !contained(root, resolve(dirname(path), target))) {
					throw new Error(`Flatpak application closure contains an unsafe symbolic link ${name}.`);
				}
				files.push({ path: name, target });
			} else throw new Error(`Flatpak application closure contains a non-regular entry ${name}.`);
		}
	}
	await visit(root);
	return files;
}

async function fileSha256(path) {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest('hex');
}

async function requireRegularFile(path, label) {
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1) {
		throw new Error(`Flatpak ${label} must be a regular nonempty file.`);
	}
}

async function requireRegularDirectory(path, label) {
	const metadata = await lstat(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
		throw new Error(`Flatpak ${label} must be a regular directory.`);
	}
}

function contained(root, path) {
	const segment = relative(root, path);
	return segment === '' || (!segment.startsWith('..') && !isAbsolute(segment));
}

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function validateOptions(options) {
	if (!PRODUCTS.includes(options.product) || !Object.hasOwn(ARCHITECTURES, options.arch)
		|| typeof options.packages !== 'string' || options.packages.length === 0
		|| (options.output !== undefined && (typeof options.output !== 'string' || options.output.length === 0))
		|| !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(options.branch ?? 'nightly')) {
		throw new Error('Flatpak requires --packages, --product soundscaper|framescaper, --arch x64|arm64, and a valid branch.');
	}
}

async function run(command, args) {
	const result = await executeFile(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
	if (result.stderr) process.stderr.write(result.stderr);
	return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const result = await buildDesktopFlatpak(parseDesktopFlatpakArguments(process.argv.slice(2)));
		console.log(`Built ${result.bundlePath}`);
	} catch (error) {
		console.error(`Desktop Flatpak build failed: ${error.message}`);
		process.exitCode = 1;
	}
}
