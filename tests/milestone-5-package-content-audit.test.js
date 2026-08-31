/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
	auditMilestone5PackageContent,
	isAuditedMilestone5PackageContent,
} from '../scripts/lib/milestone-5-package-content-audit.mjs';
import { auditDesktopPackageArtifactContent } from '../scripts/lib/desktop-package-artifact-extractor.mjs';
import { createFixture } from './helpers/ffmpeg-runtime-fixture.mjs';
import { createSoundscaperLinuxPackageFixture } from './helpers/milestone-5-linux-package-fixture.mjs';

const VERSION = '1.0.0-rc.1';
const APPIMAGE = `Soundscaper-${VERSION}-linux-x64.AppImage`;
const DEBIAN = `Soundscaper-${VERSION}-linux-amd64.deb`;
const MANIFEST = 'runtime-manifest-soundscaper-linux-x64.json';
const SOURCE_REVISION = 'a'.repeat(40);

test('a genuine package audit binds one exact target manifest and every packaged byte', {
	skip: process.platform !== 'linux',
}, async (context) => {
	const fixture = await createPackageFixture(context);
	let extractionCalls = 0;
	const auditFixtureArtifact = (options) => auditDesktopPackageArtifactContent(options, {
		appImageCompatibilityLibraryAuthority: fixture.appImageCompatibilityLibraryAuthority,
	});
	const audit = await withAliasedTemporaryDirectory(context, () => (
		auditMilestone5PackageContent({
			repositoryRoot: fixture.root,
			packageRoot: fixture.packageRoot,
			productId: 'soundscaper',
			targetId: 'linux-x64',
		}, {
			auditPackageArtifactContent: async (options) => {
				extractionCalls += 1;
				return auditFixtureArtifact(options);
			},
		})
	));

	assert.equal(isAuditedMilestone5PackageContent(audit), true);
	assert.equal(isAuditedMilestone5PackageContent(structuredClone(audit)), false);
	assert.equal(isAuditedMilestone5PackageContent({ ...audit }), false);
	assert.equal(Object.isFrozen(audit), true);
	assert.equal(audit.status, 'installed-application-closure-audited');
	assert.equal(Object.hasOwn(audit, 'automatedStatus'), false);
	assert.equal(Object.hasOwn(audit, 'automatedEvidenceSha256'), false);
	assert.equal(extractionCalls, 2);
	assert.equal('releaseAuthentication' in audit, false);
	assert.deepEqual({
		productId: audit.productId,
		targetId: audit.targetId,
		applicationVersion: audit.applicationVersion,
		sourceRevision: audit.sourceRevision,
		packageCount: audit.packageCount,
	}, {
		productId: 'soundscaper',
		targetId: 'linux-x64',
		applicationVersion: VERSION,
		sourceRevision: SOURCE_REVISION,
		packageCount: 2,
	});
	const appImageBytes = await readFile(join(fixture.packageRoot, APPIMAGE));
	const debianBytes = await readFile(join(fixture.packageRoot, DEBIAN));
	assert.deepEqual(audit.packages.map(({ label, name, byteLength, sha256 }) => ({
		label, name, byteLength, sha256,
	})), [
		{
			label: 'Linux x64 AppImage', name: APPIMAGE,
			byteLength: appImageBytes.byteLength, sha256: digest(appImageBytes),
		},
		{
			label: 'Linux x64 Debian package', name: DEBIAN,
			byteLength: debianBytes.byteLength, sha256: digest(debianBytes),
		},
	]);
	assert.ok(audit.packages.every(({ content }) => (
		content.status === 'installed-resource-closure-audited'
	)));
	const manifestBytes = await readFile(join(fixture.packageRoot, MANIFEST));
	assert.deepEqual({
		name: audit.runtimeManifest.name,
		byteLength: audit.runtimeManifest.byteLength,
		sha256: audit.runtimeManifest.sha256,
	}, {
		name: MANIFEST,
		byteLength: manifestBytes.byteLength,
		sha256: digest(manifestBytes),
	});
	assert.deepEqual(audit.desktopCodecPolicy, {
		schemaVersion: 1,
		bundledFfmpeg: false,
		providerOrder: ['bundled-reviewed-codecs', 'os', 'external-user-install'],
	});
	assert.equal(audit.totalPackageBytes, appImageBytes.byteLength + debianBytes.byteLength);

	assert.ok(audit.packages.every(({ content }) => (
		content.status === 'installed-resource-closure-audited'
		&& /^[a-f\d]{64}$/u.test(content.installedClosureSha256)
	)));
	assert.equal(
		audit.packages[0].content.installedClosureSha256,
		audit.packages[1].content.installedClosureSha256,
	);
});

test('package audit binds the selected product release line, not the root package version', {
	skip: process.platform !== 'linux',
}, async (context) => {
	const fixture = await createPackageFixture(context, { rootPackageVersion: '9.9.9-rc.9' });
	const audit = await auditMilestone5PackageContent({
		repositoryRoot: fixture.root,
		packageRoot: fixture.packageRoot,
		productId: 'soundscaper',
		targetId: 'linux-x64',
	}, {
		auditPackageArtifactContent: (options) => auditDesktopPackageArtifactContent(options, {
			appImageCompatibilityLibraryAuthority: fixture.appImageCompatibilityLibraryAuthority,
		}),
	});
	assert.equal(audit.applicationVersion, VERSION);
});

test('package audit rejects missing, unexpected, wrong-version, source-revision, and wrong-target names', {
	skip: process.platform !== 'linux',
}, async (context) => {
	const base = await createPackageFixture(context);
	for (const failure of [
		'missing', 'ffmpeg-sidecar', 'unexpected',
		'version', 'source-version', 'source-revision', 'target',
	]) {
		const fixture = await clonePackageFixture(base, `names-${failure}`);
		if (failure === 'missing') await rm(join(fixture.packageRoot, DEBIAN));
		if (failure === 'ffmpeg-sidecar') {
			await writeFile(join(fixture.packageRoot, 'ffmpeg-corresponding-source.json'), 'forbidden source evidence');
		}
		if (failure === 'unexpected') {
			await writeFile(join(fixture.packageRoot, `Soundscaper-${VERSION}-win-x64.zip`), 'extra');
		}
		if (failure === 'version') {
			await rename(
				join(fixture.packageRoot, APPIMAGE),
				join(fixture.packageRoot, 'Soundscaper-0.1.0-linux-x64.AppImage'),
			);
		}
		if (failure === 'source-version') {
			const manifestPath = join(fixture.packageRoot, MANIFEST);
			const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
			manifest.applicationVersion = '0.1.0';
			await writeJson(manifestPath, manifest);
			await rename(join(fixture.packageRoot, APPIMAGE),
				join(fixture.packageRoot, 'Soundscaper-0.1.0-linux-x64.AppImage'));
			await rename(join(fixture.packageRoot, DEBIAN),
				join(fixture.packageRoot, 'Soundscaper-0.1.0-linux-amd64.deb'));
		}
		if (failure === 'source-revision') {
			const manifestPath = join(fixture.packageRoot, MANIFEST);
			const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
			manifest.sourceRevision = `${SOURCE_REVISION}-dirty`;
			await writeJson(manifestPath, manifest);
		}
		const targetId = failure === 'target' ? 'win-x64' : 'linux-x64';
		try {
			await assert.rejects(auditMilestone5PackageContent({
				repositoryRoot: fixture.root,
				packageRoot: fixture.packageRoot,
				productId: 'soundscaper',
				targetId,
			}), /package|manifest|expected|unexpected|target|source/iu, failure);
		} finally {
			await rm(fixture.packageRoot, { recursive: true, force: true });
		}
	}
});

test('package audit delegates staged runtime identity and policy to the shared validator', {
	skip: process.platform !== 'linux',
}, async (context) => {
	const base = await createPackageFixture(context);
	for (const failure of ['product', 'codec-policy', 'legacy-ffmpeg', 'canonical']) {
		const fixture = await clonePackageFixture(base, `policy-${failure}`);
		const path = join(fixture.packageRoot, MANIFEST);
		const manifest = JSON.parse(await readFile(path, 'utf8'));
		if (failure === 'product') manifest.productId = 'framescaper';
		if (failure === 'codec-policy') manifest.desktopCodecPolicy.bundledFfmpeg = true;
		if (failure === 'legacy-ffmpeg') manifest.ffmpeg = {};
		if (failure === 'canonical') await writeFile(path, JSON.stringify(manifest));
		else await writeJson(path, manifest);
		try {
			await assert.rejects(auditMilestone5PackageContent({
				repositoryRoot: fixture.root,
				packageRoot: fixture.packageRoot,
				productId: 'soundscaper',
				targetId: 'linux-x64',
			}), /runtime manifest|canonical|product|target|codec policy|legacy bundled FFmpeg/iu, failure);
		} finally {
			await rm(fixture.packageRoot, { recursive: true, force: true });
		}
	}
});

test('package audit rejects symbolic files, symbolic roots, and non-regular package entries', {
	skip: process.platform !== 'linux',
}, async (context) => {
	const base = await createPackageFixture(context);
	for (const failure of ['package-link', 'manifest-link', 'root-link', 'directory']) {
		const fixture = await clonePackageFixture(base, `entries-${failure}`);
		let packageRoot = fixture.packageRoot;
		let linkedRoot = null;
		if (failure === 'package-link') {
			const path = join(packageRoot, APPIMAGE);
			const target = join(fixture.root, 'outside.AppImage');
			await writeFile(target, await readFile(path));
			await rm(path);
			await symlink(target, path);
		}
		if (failure === 'manifest-link') {
			const path = join(packageRoot, MANIFEST);
			const target = join(fixture.root, 'outside-manifest.json');
			await writeFile(target, await readFile(path));
			await rm(path);
			await symlink(target, path);
		}
		if (failure === 'root-link') {
			packageRoot = join(fixture.root, 'linked-package-root');
			linkedRoot = packageRoot;
			await symlink(fixture.packageRoot, packageRoot, 'dir');
		}
		if (failure === 'directory') {
			await rm(join(packageRoot, DEBIAN));
			await mkdir(join(packageRoot, DEBIAN));
		}
		try {
			await assert.rejects(auditMilestone5PackageContent({
				repositoryRoot: fixture.root,
				packageRoot,
				productId: 'soundscaper',
				targetId: 'linux-x64',
			}), /regular|symbolic|contain|package root/iu, failure);
		} finally {
			if (linkedRoot !== null) await rm(linkedRoot, { force: true });
			await rm(fixture.packageRoot, { recursive: true, force: true });
		}
	}
});

async function createPackageFixture(context, { rootPackageVersion = VERSION } = {}) {
	const fixture = await createFixture(context);
	await cp(
		new URL('../config/product-release-lines.json', import.meta.url),
		join(fixture.root, 'config/product-release-lines.json'),
	);
	const projectPackagePath = join(fixture.root, 'package.json');
	const projectPackage = JSON.parse(await readFile(projectPackagePath, 'utf8'));
	projectPackage.version = rootPackageVersion;
	await writeJson(projectPackagePath, projectPackage);
	const packageRoot = join(fixture.root, 'release/desktop');
	const packageFixture = await createSoundscaperLinuxPackageFixture({
		applicationVersion: VERSION,
		context,
		packageRoot,
		repositoryRoot: fixture.root,
		sourceRevision: SOURCE_REVISION,
	});
	return { ...fixture, ...packageFixture, packageRoot };
}

async function clonePackageFixture(fixture, label) {
	const packageRoot = join(fixture.root, 'release', label);
	await cp(fixture.packageRoot, packageRoot, { recursive: true, errorOnExist: true });
	return { ...fixture, packageRoot };
}

async function withAliasedTemporaryDirectory(context, operation) {
	const target = await mkdtemp(join(tmpdir(), 'm5-canonical-temp-target-'));
	const alias = `${target}-alias`;
	await symlink(target, alias, 'dir');
	context.after(async () => {
		await rm(alias, { force: true });
		await rm(target, { recursive: true, force: true });
	});
	const previous = process.env.TMPDIR;
	process.env.TMPDIR = alias;
	try {
		return await operation();
	} finally {
		if (previous === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = previous;
	}
}

async function writeJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
