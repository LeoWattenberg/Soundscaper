/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { promisify } from 'node:util';

import { createPackageFromStreams } from '@electron/asar';

import { buildDesktopFlatpak, parseDesktopFlatpakArguments } from '../scripts/desktop-flatpak.mjs';
import { readProductReleaseLines, resolveProductApplicationVersion } from '../scripts/lib/product-release-lines.mjs';

const executeFile = promisify(execFile);
const canBuildDeb = process.platform === 'linux' && spawnSync('dpkg-deb', ['--version']).status === 0;
const requiresDeb = { skip: !canBuildDeb && 'Debian package tools require Linux' };

test('Flatpak arguments require explicit product, packages, and supported Linux architecture', () => {
	assert.deepEqual(parseDesktopFlatpakArguments([
		'--packages', 'release/desktop', '--product', 'soundscaper', '--arch', 'x64',
	]), { packages: 'release/desktop', product: 'soundscaper', arch: 'x64', branch: 'nightly' });
	assert.deepEqual(parseDesktopFlatpakArguments([
		'--packages', 'packages', '--product', 'framescaper', '--arch', 'arm64',
		'--output', 'bundles', '--branch', 'candidate',
	]), { packages: 'packages', product: 'framescaper', arch: 'arm64', output: 'bundles', branch: 'candidate' });
	for (const args of [[], ['--product', 'soundscaper'], ['--unexpected', 'value'], ['--packages']]) {
		assert.throws(() => parseDesktopFlatpakArguments(args), /Flatpak/iu);
	}
	for (const [option, value] of [['--product', 'lightscaper'], ['--arch', 'ia32'], ['--branch', '../escape']]) {
		const args = ['--packages', 'packages', '--product', 'soundscaper', '--arch', 'x64'];
		if (option === '--branch') args.push(option, value);
		else args[args.indexOf(option) + 1] = value;
		assert.throws(() => parseDesktopFlatpakArguments(args), /Flatpak/iu);
	}
});

for (const [product, arch] of [['soundscaper', 'x64'], ['framescaper', 'arm64']]) {
	test(`Flatpak repackages ${product} ${arch} without changing application or notices`, requiresDeb, async (context) => {
		const fixture = await createFixture(context, { product, arch });
		const calls = [];
		const result = await buildDesktopFlatpak(fixture.options, { runCommand: fakeBuilder(calls) });
		assert.equal(basename(result.bundlePath), `${fixture.productName}-${fixture.version}-linux-${arch}.flatpak`);
		const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'));
		assert.equal(manifest.id, `org.${product}.desktop`);
		assert.equal(manifest.branch, 'nightly');
		assert.equal(manifest.runtime, 'org.freedesktop.Platform');
		assert.equal(manifest.sdk, 'org.freedesktop.Sdk');
		assert.equal(manifest['runtime-version'], '25.08');
		assert.equal(manifest.base, 'org.electronjs.Electron2.BaseApp');
		assert.equal(manifest['base-version'], '25.08');
		assert.deepEqual(manifest['build-options'], { strip: false, 'no-debuginfo': true });
		for (const permission of ['--socket=pulseaudio', '--socket=x11',
			'--device=dri', '--share=network', '--filesystem=host']) {
			assert.ok(manifest['finish-args'].includes(permission), permission);
		}
		assert.ok(!manifest['finish-args'].includes('--socket=wayland'));
		const stage = join(fixture.root, '.desktop-build/flatpak', `${product}-${arch}`);
		const installed = join(stage, 'build/files', fixture.productName);
		assert.deepEqual(await readFile(join(installed, 'resources/app.asar')), fixture.asarBytes);
		assert.equal(await readFile(join(installed, 'resources/licenses/NOTICE.txt'), 'utf8'), 'Pinned third-party notice\n');
		assert.equal(await readFile(join(installed, product), 'utf8'), '#!/bin/sh\nexit 0\n');
		const launcher = await readFile(join(stage, 'integration', product), 'utf8');
		assert.match(launcher, new RegExp(`exec zypak-wrapper /app/${fixture.productName}/${product} --ozone-platform=x11`, 'u'));
		assert.doesNotMatch(launcher, /no-sandbox|patch-desktop-filename/u);
		const desktop = await readFile(join(stage, 'integration', `org.${product}.desktop.desktop`), 'utf8');
		assert.match(desktop, new RegExp(`Exec=${product} %U`, 'u'));
		assert.match(desktop, new RegExp(`StartupWMClass=org\\.${product}`, 'u'));
		assert.match(desktop, /application\/vnd\.soundscaper\.scape\+zip/u);
		assert.equal(desktop.includes('application/x-audacity-project'), product === 'soundscaper');
		assert.equal(await readFile(join(stage, 'integration', `org.${product}.desktop.xml`), 'utf8'), fixture.mime);
		assert.deepEqual(await readFile(join(stage, 'integration', `org.${product}.desktop.png`)), fixture.icon);
		const builder = calls.find(({ command }) => command === 'flatpak-builder');
		assert.ok(builder);
		for (const argument of ['--user', '--force-clean', '--disable-rofiles-fuse', '--disable-cache',
			`--state-dir=${join(stage, 'state')}`,
			`--arch=${arch === 'x64' ? 'x86_64' : 'aarch64'}`]) assert.ok(builder.args.includes(argument), argument);
		const bundle = calls.find(({ command }) => command === 'flatpak');
		assert.equal(bundle.args[0], 'build-bundle');
		assert.ok(bundle.args.includes('--runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo'));
		assert.equal(bundle.args.at(-2), `org.${product}.desktop`);
		assert.equal(bundle.args.at(-1), 'nightly');
		const bytes = await readFile(result.bundlePath);
		assert.equal(await readFile(result.checksumPath, 'utf8'),
			`${sha256(bytes)}  ${basename(result.bundlePath)}\n`);
	});
}

test('Flatpak rejects missing, duplicate, or other-product Debian packages', requiresDeb, async (context) => {
	const fixture = await createFixture(context);
	const calls = [];
	await assert.rejects(buildDesktopFlatpak({ ...fixture.options, product: 'framescaper' },
		{ runCommand: fakeBuilder(calls) }), /exactly one.*Debian/iu);
	await cp(fixture.debPath, join(fixture.options.packages, basename(fixture.debPath).replace('amd64', 'x64')));
	await assert.rejects(buildDesktopFlatpak(fixture.options, { runCommand: fakeBuilder(calls) }), /exactly one.*Debian/iu);
	assert.equal(calls.length, 0);
});

for (const [field, value] of [['Package', 'framescaper-desktop'], ['Architecture', 'arm64'], ['Version', '2.0.0']]) {
	test(`Flatpak rejects mismatched Debian ${field} metadata`, requiresDeb, async (context) => {
		const fixture = await createFixture(context, { metadata: { [field]: value } });
		await assert.rejects(buildDesktopFlatpak(fixture.options, { runCommand: fakeBuilder([]) }), /Debian.*metadata/iu);
	});
}

test('Flatpak rejects wrong application identity inside an otherwise matching Debian package', requiresDeb, async (context) => {
	const fixture = await createFixture(context, { archiveProduct: 'framescaper' });
	await assert.rejects(buildDesktopFlatpak(fixture.options, { runCommand: fakeBuilder([]) }), /application metadata/iu);
});

test('Flatpak propagates tool failure and does not publish a checksum', requiresDeb, async (context) => {
	const fixture = await createFixture(context);
	const failure = new Error('flatpak-builder failed');
	await assert.rejects(buildDesktopFlatpak(fixture.options, { runCommand: async (command, args) => {
		if (command === 'dpkg-deb') return await executeFile(command, args, { encoding: 'utf8' });
		throw failure;
	} }), (error) => error === failure);
	await assert.rejects(readFile(join(fixture.options.output,
		`${fixture.productName}-${fixture.version}-linux-x64.flatpak.sha256`)), { code: 'ENOENT' });
});

test('Flatpak refuses a builder that changes authenticated application bytes', requiresDeb, async (context) => {
	const fixture = await createFixture(context);
	await assert.rejects(buildDesktopFlatpak(fixture.options, {
		runCommand: fakeBuilder([], { mutate: true }),
	}), /application closure/iu);
});

async function createFixture(context, { product = 'soundscaper', arch = 'x64', metadata = {}, archiveProduct = product } = {}) {
	const root = await mkdtemp(join(tmpdir(), 'desktop-flatpak-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const productName = product === 'framescaper' ? 'Framescaper' : 'Soundscaper';
	const releaseLines = await readProductReleaseLines();
	const version = resolveProductApplicationVersion(product, releaseLines);
	await mkdir(join(root, 'config'), { recursive: true });
	await writeFile(join(root, 'config/product-release-lines.json'), JSON.stringify(releaseLines));
	const packageRoot = join(root, 'fixture');
	const appRoot = join(packageRoot, 'opt', productName);
	await mkdir(join(appRoot, 'resources/licenses'), { recursive: true });
	await writeFile(join(appRoot, product), '#!/bin/sh\nexit 0\n');
	await chmod(join(appRoot, product), 0o755);
	await writeFile(join(appRoot, 'resources/licenses/NOTICE.txt'), 'Pinned third-party notice\n');
	const asarPath = join(appRoot, 'resources/app.asar');
	const archiveMetadata = Buffer.from(JSON.stringify({
		name: `${archiveProduct}-desktop`, productName,
		version, desktopName: `org.${archiveProduct}.desktop`,
	}));
	await createPackageFromStreams(asarPath, [{ path: 'package.json', type: 'file',
		streamGenerator: () => Readable.from([archiveMetadata]), unpacked: false,
		stat: { mode: 0o100644, size: archiveMetadata.byteLength } }]);
	const icon = Buffer.from('fixture-icon');
	const iconRoot = join(packageRoot, 'usr/share/icons/hicolor/512x512/apps');
	await mkdir(iconRoot, { recursive: true });
	await writeFile(join(iconRoot, `${product}.png`), icon);
	const mime = '<?xml version="1.0"?><mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info"><mime-type type="application/vnd.soundscaper.scape+zip"/></mime-info>\n';
	await mkdir(join(packageRoot, 'usr/share/mime/packages'), { recursive: true });
	await writeFile(join(packageRoot, 'usr/share/mime/packages', `${product}.xml`), mime);
	await mkdir(join(packageRoot, 'DEBIAN'), { recursive: true });
	const fields = { Package: `${product}-desktop`, Version: version.replaceAll('-', '~'),
		Architecture: arch === 'x64' ? 'amd64' : 'arm64', Maintainer: 'Fixture <fixture@example.org>',
		Description: 'Flatpak fixture', ...metadata };
	await writeFile(join(packageRoot, 'DEBIAN/control'),
		`${Object.entries(fields).map(([name, value]) => `${name}: ${value}`).join('\n')}\n`);
	const packages = join(root, 'packages');
	await mkdir(packages);
	const debPath = join(packages, `${productName}-${version}-linux-${arch === 'x64' ? 'amd64' : arch}.deb`);
	await executeFile('dpkg-deb', ['--build', '--root-owner-group', packageRoot, debPath]);
	return { root, productName, version, debPath, icon, mime, asarBytes: await readFile(asarPath),
		options: { repositoryRoot: root, packages, product, arch, output: join(root, 'output') } };
}

function fakeBuilder(calls, { mutate = false } = {}) {
	return async (command, args) => {
		calls.push({ command, args });
		if (command === 'dpkg-deb') return await executeFile(command, args, { encoding: 'utf8' });
		if (command === 'flatpak-builder') {
			const manifestPath = args.at(-1);
			const buildRoot = args.at(-2);
			const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
			const appRoot = join(buildRoot, 'files', manifest.id.includes('framescaper') ? 'Framescaper' : 'Soundscaper');
			await mkdir(join(buildRoot, 'files'), { recursive: true });
			await cp(join(manifestPath, '..', manifest.modules[0].sources[0].path), appRoot, { recursive: true });
			if (mutate) await writeFile(join(appRoot, 'resources/app.asar'), 'rewritten archive');
			return { stdout: '', stderr: '' };
		}
		assert.equal(command, 'flatpak');
		await writeFile(args.at(-3), 'fixture-flatpak-bundle');
		return { stdout: '', stderr: '' };
	};
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
