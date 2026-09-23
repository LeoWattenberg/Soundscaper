/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { createPackage } from '@electron/asar';
import appImageUtil from 'app-builder-lib/out/targets/appimage/appImageUtil.js';

import assistanceNativeRuntimeManifest from '../../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import { assistanceNativeRuntimeStageSummary } from '../../desktop/assistance-native-runtime-payload.mjs';
import { DESKTOP_CODEC_POLICY } from '../../scripts/lib/desktop-codec-policy.mjs';
import {
	typedUnavailableSoundscaperProfessionalNativeNotices,
} from '../../scripts/lib/soundscaper-professional-native-notices.mjs';
import { createPngFixture } from './png-fixture.mjs';
import { writeDesktopPackageContentManifest } from '../../scripts/lib/desktop-package-content-manifest.mjs';
import {
	nativeAddonPayloadStageSummary,
	verifyNativeAddonPayloadManifest,
} from '../../scripts/lib/native-addon-payload-manifest.mjs';
import {
	professionalNativePayloadOutputRoot,
	professionalNativePayloadStageSummary,
	stageVerifiedSoundscaperProfessionalNativePayload,
	verifySoundscaperProfessionalNativePayload,
} from '../../scripts/lib/soundscaper-professional-native-payload.mjs';

const executeFile = promisify(execFile);
const TARGET_ID = 'linux-x64';
// Audacity's reviewed strings are compiled into the renderer bundle inside
// app.asar, so the package stages no translation tree; the runtime manifest
// records which upstream artifact and reviewed mapping they came from.
const TRANSLATIONS = Object.freeze({
	headSha: 'b'.repeat(40),
	artifactId: 4321,
	mappingSha256: 'c'.repeat(64),
	locales: Object.freeze(['de', 'fr']),
});

export async function createSoundscaperLinuxPackageFixture({
	applicationVersion,
	context,
	packageRoot,
	repositoryRoot,
	sourceRevision,
}) {
	if (process.platform !== 'linux') {
		throw new Error('The Milestone 5 Linux package fixture requires Linux.');
	}
	const workRoot = await mkdtemp(join(tmpdir(), 'soundscaper-m5-linux-package-'));
	context.after(() => rm(workRoot, { recursive: true, force: true }));
	await mkdir(packageRoot, { recursive: true });
	const nativeRelease = await verifyNativeAddonPayloadManifest({
		repositoryRoot,
		target: TARGET_ID,
		targetSource: 'declared',
	});
	const professionalRelease = await verifySoundscaperProfessionalNativePayload({
		repositoryRoot,
		target: TARGET_ID,
		 targetSource: 'declared',
	});
	const applicationRoot = join(workRoot, 'tree/opt/Soundscaper');
	const resourcesRoot = join(applicationRoot, 'resources');
	const assistanceRuntimeDistribution = await stageAssistanceDistributionFixture(
		workRoot, resourcesRoot,
	);
	const runtimeManifest = {
		schemaVersion: 1,
		productId: 'soundscaper',
		applicationVersion,
		sourceRevision,
		target: { platform: 'linux', arch: 'x64' },
		desktopRuntime: { schemaVersion: 1 },
		assistanceNativeRuntime: assistanceNativeRuntimeStageSummary(
			assistanceNativeRuntimeManifest,
			TARGET_ID,
		),
		assistanceRuntimeDistribution,
		desktopCodecPolicy: DESKTOP_CODEC_POLICY,
		desktopNotices: {
			professionalNative: typedUnavailableSoundscaperProfessionalNativeNotices(TARGET_ID),
		},
		nativeAddons: nativeAddonPayloadStageSummary(nativeRelease),
		osAudioCodecNative: null,
		soundscaperProfessionalNative: professionalNativePayloadStageSummary(professionalRelease),
		framescaperNativeHosts: null,
		translations: TRANSLATIONS,
	};
	const manifestName = 'runtime-manifest-soundscaper-linux-x64.json';
	const runtimeManifestPath = join(packageRoot, manifestName);
	await writeJson(runtimeManifestPath, runtimeManifest);

	const nativeRoot = join(resourcesRoot, `runtime/native/${TARGET_ID}`);
	await writeBytes(
		join(nativeRoot, releaseNativeManifestName(nativeRelease)),
		nativeRelease.manifestBytes,
	);
	if (nativeRelease.payload !== null) {
		await writeBytes(join(nativeRoot, nativeRelease.payload.name), nativeRelease.payload.bytes);
	}
	await stageVerifiedSoundscaperProfessionalNativePayload({
		release: professionalRelease,
		outputRoot: professionalNativePayloadOutputRoot(join(resourcesRoot, 'runtime'), professionalRelease),
	});
	const executable = linuxExecutableHeader();
	await writeBytes(join(applicationRoot, 'soundscaper'), executable);
	await chmod(join(applicationRoot, 'soundscaper'), 0o755);
	await writeDesktopPackageContentManifest({
		resourcesRoot,
		runtimeManifestPath,
		productId: 'soundscaper',
		targetId: TARGET_ID,
	});

	const appImageName = `Soundscaper-${applicationVersion}-linux-x64.AppImage`;
	const debianName = `Soundscaper-${applicationVersion}-linux-amd64.deb`;
	// electron-builder places the installed application itself at the AppImage
	// SquashFS root; only the Debian package wraps it in /opt or /usr/lib.
	const appImageRoot = join(workRoot, 'appimage-root');
	await cp(applicationRoot, appImageRoot, { recursive: true });
	const appImageCompatibilityLibraryAuthority = await stageAppImageWrapper(
		appImageRoot, applicationVersion,
	);
	await buildAppImage(appImageRoot, join(packageRoot, appImageName), workRoot);
	await writeBytes(
		join(applicationRoot, 'resources/apparmor-profile'),
		Buffer.from(`abi <abi/4.0>,\ninclude <tunables/global>\n\nprofile "soundscaper" "/opt/Soundscaper/soundscaper" flags=(unconfined) {\n  userns,\n\n  # Site-specific additions and overrides. See local/README for details.\n  include if exists <local/soundscaper>\n}`),
	);
	await buildDebian(join(workRoot, 'tree'), join(packageRoot, debianName), applicationVersion);
	return {
		appImageName,
		appImageCompatibilityLibraryAuthority,
		debianName,
		manifestName,
		runtimeManifest,
		runtimeManifestPath,
	};
}

async function stageAppImageWrapper(root, applicationVersion) {
	const icon = 'usr/share/icons/hicolor/512x512/apps/soundscaper.png';
	await writeBytes(
		join(root, 'AppRun'),
		Buffer.from(appImageUtil.generateAppRunScript({ ExecutableName: 'soundscaper' })),
	);
	await chmod(join(root, 'AppRun'), 0o755);
	await writeBytes(
		join(root, 'org.soundscaper.desktop'),
		Buffer.from(`${[
			'[Desktop Entry]',
			'Name=Soundscaper',
			'Exec=AppRun --no-sandbox %U',
			'Terminal=false',
			'Type=Application',
			'Icon=soundscaper',
			'StartupWMClass=org.soundscaper',
			`X-AppImage-Version=${applicationVersion}`,
			'Comment=Soundscaper is a local-first multitrack audio editor with offline project and media export support.',
			'MimeType=application/vnd.soundscaper.scape+zip;application/vnd.soundscaper.scape+zip;application/x-audacity-project;',
			'Categories=AudioVideo;Audio;',
		].join('\n')}\n`),
	);
	for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
		await writeBytes(
			join(root, `usr/share/icons/hicolor/${size}x${size}/apps/soundscaper.png`),
			createPngFixture(size),
		);
	}
	const libraries = {};
	for (const name of [
		'libXss.so.1', 'libXtst.so.6', 'libappindicator.so.1',
		'libgconf-2.so.4', 'libindicator.so.7', 'libnotify.so.4',
	]) {
		const bytes = linuxSharedLibraryHeader();
		await writeBytes(join(root, `usr/lib/${name}`), bytes);
		libraries[name] = descriptor(bytes);
	}
	await writeBytes(
		join(root, 'usr/share/mime/packages/soundscaper.xml'),
		Buffer.from([
			'<?xml version="1.0"?>',
			'<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">',
			'<mime-type type="application/vnd.soundscaper.scape+zip">',
			'  <comment>Soundscaper document</comment>',
			'  <glob pattern="*.sscape"/>',
			'  <generic-icon name="x-office-document"/>',
			'</mime-type>',
			'<mime-type type="application/vnd.soundscaper.scape+zip">',
			'  <comment>Soundscaper document</comment>',
			'  <glob pattern="*.scape"/>',
			'  <generic-icon name="x-office-document"/>',
			'</mime-type>',
			'<mime-type type="application/x-audacity-project">',
			'  <comment>Soundscaper document</comment>',
			'  <glob pattern="*.aup3"/>',
			'  <glob pattern="*.aup4"/>',
			'  <generic-icon name="x-office-document"/>',
			'</mime-type>',
			'</mime-info>',
		].join('\n')),
	);
	await symlink(icon, join(root, '.DirIcon'));
	await symlink(icon, join(root, 'soundscaper.png'));
	return { 'linux-x64': libraries, 'linux-arm64': {} };
}

function linuxSharedLibraryHeader() {
	const bytes = linuxExecutableHeader();
	bytes.writeUInt16LE(3, 16);
	return bytes;
}

async function stageAssistanceDistributionFixture(workRoot, resourcesRoot) {
	const engine = { path: 'engine', byteLength: 6, sha256: 'a'.repeat(64), executable: true };
	const familyIds = ['onnxruntime-node', 'whisper-cpp', 'llama-cpp'];
	const family = { manifests: Object.fromEntries(familyIds.map((familyId) => [familyId, {
		runtimeVersion: '1.0.0', runtimePrefix: `assistance/${familyId}/1.0.0`,
		targets: [{ id: TARGET_ID, status: 'authenticated', files: [engine] }],
	}])) };
	const kokoro = { runtimeVersion: '0.9.4', runtimePrefix: 'assistance/kokoro-g2p/0.9.4',
		targetId: TARGET_ID, executable: 'engine', files: [{ path: engine.path,
			byteLength: engine.byteLength, sha256: engine.sha256 }] };
	const native = assistanceNativeRuntimeManifest;
	const sherpaFiles = [native.commonPackage, native.targets[TARGET_ID].package]
		.flatMap((descriptor) => Object.entries(descriptor.files).map(([name, file]) => ({
			path: `node_modules/${descriptor.name}/${name}`, ...file, executable: false,
		})));
	const bundles = ['sherpa-onnx-node', ...familyIds, 'kokoro-g2p'].map((familyId) => {
		const runtimeVersion = familyId === 'sherpa-onnx-node' ? native.version
			: familyId === 'kokoro-g2p' ? kokoro.runtimeVersion : '1.0.0';
		const runtimePrefix = familyId === 'sherpa-onnx-node' ? native.runtimePrefix
			: `assistance/${familyId}/${runtimeVersion}`;
		const archive = { byteLength: 42, sha256: 'b'.repeat(64) };
		return { familyId, runtimeVersion, runtimePrefix,
			installPath: familyId === 'sherpa-onnx-node'
				? runtimePrefix : `${runtimePrefix}/${TARGET_ID}`,
			archive: { ...archive,
				url: `https://assets.soundscaper.org/runtime/assistance/${familyId}/${runtimeVersion}/${TARGET_ID}/${archive.sha256}.tar.gz` },
			files: familyId === 'sherpa-onnx-node' ? sherpaFiles : [engine] };
	});
	const app = join(workRoot, 'assistance-fixture-app');
	const configs = {
		'assistance-native-runtime-manifest.json': native,
		'assistance-runtime-family-supply-candidates.json': family,
		'assistance-kokoro-g2p-runtime-manifest.json': kokoro,
		'assistance-runtime-distribution.json': { schemaVersion: 1, targetId: TARGET_ID, bundles },
	};
	for (const [name, value] of Object.entries(configs)) await writeJson(join(app, 'config', name), value);
	await mkdir(resourcesRoot, { recursive: true });
	await createPackage(app, join(resourcesRoot, 'app.asar'));
	const manifestBytes = await readFile(join(app, 'config/assistance-runtime-distribution.json'));
	return { targetId: TARGET_ID, signingFiles: [],
		manifest: { path: 'config/assistance-runtime-distribution.json', ...descriptor(manifestBytes) },
		bundles: bundles.map(({ familyId, archive }) => ({ familyId,
			byteLength: archive.byteLength, sha256: archive.sha256 })) };
}

async function buildAppImage(treeRoot, outputPath, workRoot) {
	const squashfsPath = join(workRoot, 'fixture.squashfs');
	await run('mksquashfs', [
		treeRoot, squashfsPath, '-noappend', '-processors', '1', '-quiet',
	]);
	const squashfs = await readFile(squashfsPath);
	const header = linuxExecutableHeader(4_096);
	header.set(Buffer.from('AI\x02', 'latin1'), 8);
	await writeFile(outputPath, Buffer.concat([header, squashfs]));
	await chmod(outputPath, 0o755);
}

async function buildDebian(treeRoot, outputPath, applicationVersion) {
	const control = [
		'Package: soundscaper',
		`Version: ${applicationVersion}`,
		'Architecture: amd64',
		'Maintainer: Soundscaper fixture <fixture@soundscaper.invalid>',
		'Description: authenticated Milestone 5 package fixture',
		'',
	].join('\n');
	await writeBytes(join(treeRoot, 'DEBIAN/control'), Buffer.from(control));
	await run('dpkg-deb', ['--build', '--root-owner-group', treeRoot, outputPath]);
}

function releaseNativeManifestName(release) {
	return release.manifest.staging?.manifestName ?? 'native-addon-payload-manifest.json';
}

function linuxExecutableHeader(byteLength = 64) {
	const bytes = Buffer.alloc(byteLength);
	bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
	bytes.writeUInt16LE(2, 16);
	bytes.writeUInt16LE(62, 18);
	bytes.writeUInt32LE(1, 20);
	bytes.writeUInt16LE(64, 52);
	if (byteLength >= 128) {
		bytes.writeBigUInt64LE(BigInt(byteLength - 64), 40);
		bytes.writeUInt16LE(64, 58);
		bytes.writeUInt16LE(1, 60);
	}
	return bytes;
}

async function run(command, args) {
	try {
		await executeFile(command, args, { maxBuffer: 1024 * 1024 });
	} catch (error) {
		throw new Error(`The package fixture command ${command} failed.`, { cause: error });
	}
}

async function writeJson(path, value) {
	await writeBytes(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

async function writeBytes(path, bytes) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, bytes);
}

function descriptor(bytes) {
	return { byteLength: bytes.byteLength, sha256: sha256(bytes) };
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
