/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed target-native command plan for the media host and its static codec closure. */

import { readFileSync, readdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export const FRAMESCAPER_FFMPEG_CONFIGURE_FLAGS = Object.freeze([
	'--disable-everything', '--disable-autodetect', '--disable-doc', '--disable-debug',
	'--disable-x86asm', '--disable-programs', '--disable-shared', '--disable-network',
	'--enable-static', '--enable-pic', '--enable-gpl', '--enable-avcodec',
	'--enable-avfilter', '--enable-avformat', '--enable-swresample', '--enable-swscale',
	'--pkg-config-flags=--static',
	'--enable-libx264', '--enable-libx265', '--enable-libvpx', '--enable-libopus',
	'--enable-zlib',
	...values('decoder', [
		'h264', 'hevc', 'vp9', 'av1', 'prores', 'dnxhd', 'pcm_f32le', 'png', 'tiff', 'exr',
	]),
	...values('encoder', [
		'libx264', 'libx265', 'libvpx_vp9', 'prores_ks', 'dnxhd', 'ffv1', 'png', 'tiff',
		'exr', 'aac', 'libopus', 'pcm_s16le', 'flac',
	]),
	...values('demuxer', ['mov', 'wav', 'matroska', 'mxf', 'image2']),
	...values('muxer', ['mp4', 'webm', 'mov', 'mxf', 'matroska', 'image2']),
	...values('filter', ['scale', 'format', 'aresample']),
	...values('parser', ['h264', 'hevc', 'vp9', 'av1', 'png']),
	...values('protocol', ['file', 'pipe']),
]);

export const FRAMESCAPER_FFMPEG_POLICY = deepFreeze({
	rawFfmpegArguments: false,
	network: false,
	externalLibraries: ['x264', 'x265', 'libvpx', 'libopus', 'zlib'],
	enabledDecoders: [
		'h264', 'hevc', 'vp9', 'av1', 'prores', 'dnxhd', 'pcm_f32le', 'png', 'tiff', 'exr',
	],
	enabledEncoders: [
		'libx264', 'libx265', 'libvpx-vp9', 'prores_ks', 'dnxhd', 'ffv1', 'png', 'tiff',
		'exr', 'aac', 'libopus', 'pcm_s16le', 'flac',
	],
	enabledDemuxers: ['mov', 'wav', 'matroska', 'mxf', 'image2'],
	enabledMuxers: ['mp4', 'webm', 'mov', 'mxf', 'matroska', 'image2'],
	enabledFilters: ['scale', 'format', 'aresample'],
	enabledParsers: ['h264', 'hevc', 'vp9', 'av1', 'png'],
	enabledProtocols: ['file', 'pipe'],
	blockedComponents: [],
	payloadPublicationRequiresVerifiedBuildResult: true,
});

export const FRAMESCAPER_FFMPEG_REQUIRED_CONFIGURATION = Object.freeze([
	'CONFIG_LIBX264', 'CONFIG_LIBX265', 'CONFIG_LIBVPX', 'CONFIG_LIBOPUS', 'CONFIG_ZLIB',
	...configNames('DECODER', FRAMESCAPER_FFMPEG_POLICY.enabledDecoders),
	...configNames('ENCODER', FRAMESCAPER_FFMPEG_POLICY.enabledEncoders, { 'libvpx-vp9': 'libvpx_vp9' }),
	...configNames('DEMUXER', FRAMESCAPER_FFMPEG_POLICY.enabledDemuxers),
	...configNames('MUXER', FRAMESCAPER_FFMPEG_POLICY.enabledMuxers),
	...configNames('FILTER', FRAMESCAPER_FFMPEG_POLICY.enabledFilters),
	...configNames('PARSER', FRAMESCAPER_FFMPEG_POLICY.enabledParsers),
	...configNames('PROTOCOL', FRAMESCAPER_FFMPEG_POLICY.enabledProtocols),
]);

export function framescaperMediaHostBuildPaths(outputRoot) {
	return Object.freeze(Object.fromEntries([
		'x264-build', 'x264-install', 'x265-build', 'x265-install',
		'libvpx-build', 'libvpx-install', 'libopus-build', 'libopus-install',
		'zlib-source', 'zlib-build', 'zlib-install', 'ffmpeg-build', 'ffmpeg-install',
		'host-build', 'host-install',
	].map((name) => [camel(name), join(outputRoot, name)])));
}

export function framescaperMediaHostLocalSourceInventory(root) {
	const paths = [];
	const visit = (directory, prefix = '') => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (prefix === '' && (entry.name === 'source-manifest.json' || entry.name === 'prebuilt')) continue;
			const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
			if (entry.isSymbolicLink()) throw new Error(`Local media-host build input ${path} is a symlink.`);
			if (entry.isDirectory()) visit(join(directory, entry.name), path);
			else if (entry.isFile()) paths.push(path);
			else throw new Error(`Local media-host build input ${path} is not a regular file.`);
		}
	};
	visit(root);
	return Object.freeze(paths.sort());
}

export function createFramescaperMediaHostBuildCommands(input) {
	const {
		target, hostRoot, ffmpegSourceRoot, boostSourceRoot, externalSourceRoots,
		paths, tools, environment, configureFlags,
	} = input;
	const windows = target.id.startsWith('win-');
	const apple = target.id === 'mac-arm64';
	const cmakeCommon = [
		'-G', 'Ninja', `-DCMAKE_MAKE_PROGRAM=${tools.executables.ninja.path}`,
		`-DCMAKE_C_COMPILER=${tools.executables.c.path}`,
		`-DCMAKE_CXX_COMPILER=${tools.executables.cxx.path}`,
		'-DCMAKE_BUILD_TYPE=Release',
		...(apple ? ['-DCMAKE_OSX_ARCHITECTURES=arm64', '-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0'] : []),
		...(windows ? ['-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded'] : []),
	];
	const nativeEnvironment = Object.freeze({
		...environment,
		...(apple ? { MACOSX_DEPLOYMENT_TARGET: '13.0' } : {}),
	});
	const makeEnvironment = Object.freeze({
		...nativeEnvironment,
		CC: shellTool(tools.executables.c.path, windows),
		CXX: shellTool(tools.executables.cxx.path, windows),
		AR: shellTool(tools.executables.ar.path, windows),
		RANLIB: shellTool(tools.executables.ranlib.path, windows),
		...(windows ? { RC: shellTool(tools.executables.rc.path, true) } : {}),
	});
	const pkgConfigRoots = [
		paths.ffmpegInstall, paths.x264Install, paths.x265Install,
		paths.libvpxInstall, paths.libopusInstall, paths.zlibInstall,
	];
	const pkgConfigPath = pkgConfigRoots.flatMap((root) => [
		join(root, 'lib', 'pkgconfig'), join(root, 'share', 'pkgconfig'),
	]).join(delimiter);
	const dependencyEnvironment = Object.freeze({
		...makeEnvironment, PKG_CONFIG_PATH: pkgConfigPath, PKG_CONFIG_LIBDIR: pkgConfigPath,
	});
	const x264Args = [
		shellPath(join(externalSourceRoots.x264, 'configure'), windows),
		`--prefix=${shellPath(paths.x264Install, windows)}`,
		'--enable-static', '--disable-cli', '--disable-opencl',
		'--disable-asm', '--bit-depth=8', '--enable-pic',
		...(windows ? [
			`--host=${target.id === 'win-arm64' ? 'aarch64' : 'x86_64'}-pc-mingw32`,
			'--extra-cflags=-MT',
		] : apple ? ['--extra-cflags=-mmacosx-version-min=13.0'] : []),
	];
	const x265Args = [
		'-S', join(externalSourceRoots.x265, 'source'), '-B', paths.x265Build,
		...cmakeCommon, `-DCMAKE_INSTALL_PREFIX=${paths.x265Install}`,
		'-DENABLE_SHARED=OFF', '-DENABLE_CLI=OFF', '-DENABLE_ASSEMBLY=OFF',
		'-DENABLE_LIBNUMA=OFF', '-DHIGH_BIT_DEPTH=ON', '-DMAIN12=OFF',
		'-DEXPORT_C_API=ON', '-DENABLE_PIC=ON',
		...(windows ? ['-DSTATIC_LINK_CRT=ON'] : []),
	];
	const vpxArgs = [
		shellPath(join(externalSourceRoots.libvpx, 'configure'), windows),
		`--target=${vpxTarget(target.id)}`,
		`--prefix=${shellPath(paths.libvpxInstall, windows)}`,
		'--disable-examples', '--disable-tools', '--disable-docs', '--disable-unit-tests',
		'--disable-shared', '--enable-static', '--enable-pic', '--disable-vp8', '--enable-vp9',
		'--disable-webm-io', '--disable-libyuv', '--disable-runtime-cpu-detect',
		...vpxArchitectureDisables(target.id),
		...(windows ? ['--enable-static-msvcrt'] : []),
	];
	const opusArgs = [
		'-S', externalSourceRoots.libopus, '-B', paths.libopusBuild,
		...cmakeCommon, `-DCMAKE_INSTALL_PREFIX=${paths.libopusInstall}`,
		'-DBUILD_SHARED_LIBS=OFF', '-DOPUS_BUILD_SHARED_LIBRARY=OFF',
		'-DOPUS_BUILD_TESTING=OFF', '-DOPUS_BUILD_PROGRAMS=OFF',
		...(windows ? ['-DOPUS_STATIC_RUNTIME=ON'] : []),
	];
	const zlibArgs = [
		'-S', paths.zlibSource, '-B', paths.zlibBuild,
		...cmakeCommon, `-DCMAKE_INSTALL_PREFIX=${paths.zlibInstall}`,
		'-DSKIP_INSTALL_LIBRARIES=ON', '-DZLIB_BUILD_EXAMPLES=OFF',
	];
	const ffmpegArgs = [
		shellPath(join(ffmpegSourceRoot, 'configure'), windows), ...configureFlags,
		`--prefix=${shellPath(paths.ffmpegInstall, windows)}`, ...ffmpegTargetArguments(target),
		`--cc=${shellTool(tools.executables.c.path, windows)}`,
		`--cxx=${shellTool(tools.executables.cxx.path, windows)}`,
		`--ar=${shellTool(tools.executables.ar.path, windows)}`,
		`--ranlib=${shellTool(tools.executables.ranlib.path, windows)}`,
		`--pkg-config=${shellTool(tools.executables.pkgConfig.path, windows)}`,
		...(windows ? ['--extra-cflags=-MT'] : []),
	];
	const hostEnvironment = Object.freeze({
		...nativeEnvironment, PKG_CONFIG_PATH: pkgConfigPath, PKG_CONFIG_LIBDIR: pkgConfigPath,
	});
	const hostArgs = [
		'--preset', target.cmakePreset, '-S', hostRoot, '-B', paths.hostBuild, '--fresh',
		`-DCMAKE_MAKE_PROGRAM=${tools.executables.ninja.path}`,
		`-DFRAMESCAPER_C_COMPILER=${tools.executables.c.path}`,
		`-DFRAMESCAPER_CXX_COMPILER=${tools.executables.cxx.path}`,
		`-DCMAKE_INSTALL_PREFIX=${paths.hostInstall}`,
		`-DBOOST_ROOT=${boostSourceRoot}`, '-DBoost_NO_SYSTEM_PATHS=ON',
		`-DPKG_CONFIG_EXECUTABLE=${tools.executables.pkgConfig.path}`,
		`-DCMAKE_PREFIX_PATH=${pkgConfigRoots.join(';')}`,
	];
	const vpxMake = windows
		? [`MSBUILD_TOOL=${shellTool(tools.executables.msbuild.path, true)}`] : [];
	const zlibLibrary = windows ? 'zlibstatic.lib' : 'libz.a';
	const installedZlibLibrary = windows ? 'zlib.lib' : 'libz.a';
	return Object.freeze([
		command('zlib-configure', tools.executables.cmake.path, zlibArgs, paths.zlibSource, nativeEnvironment),
		command('zlib-build', tools.executables.cmake.path, ['--build', paths.zlibBuild, '--config', 'Release', '--target', 'zlibstatic', '--parallel', '1'], paths.zlibBuild, nativeEnvironment),
		command('zlib-install-metadata', tools.executables.cmake.path, ['--install', paths.zlibBuild, '--config', 'Release', '--prefix', paths.zlibInstall], paths.zlibBuild, nativeEnvironment),
		command('zlib-install-library-directory', tools.executables.cmake.path, ['-E', 'make_directory', join(paths.zlibInstall, 'lib')], paths.zlibBuild, nativeEnvironment),
		command('zlib-install-static-library', tools.executables.cmake.path, ['-E', 'copy', join(paths.zlibBuild, zlibLibrary), join(paths.zlibInstall, 'lib', installedZlibLibrary)], paths.zlibBuild, nativeEnvironment),
		command('x264-configure', tools.executables.shell.path, x264Args, paths.x264Build, makeEnvironment),
		command('x264-build', tools.executables.make.path, ['-C', paths.x264Build, '-j1'], paths.x264Build, makeEnvironment),
		command('x264-install', tools.executables.make.path, ['-C', paths.x264Build, 'install-lib-static'], paths.x264Build, makeEnvironment),
		command('x265-configure', tools.executables.cmake.path, x265Args, paths.x265Build, nativeEnvironment),
		command('x265-build', tools.executables.cmake.path, ['--build', paths.x265Build, '--config', 'Release', '--target', 'x265-static', '--parallel', '1'], paths.x265Build, nativeEnvironment),
		command('x265-install', tools.executables.cmake.path, ['--install', paths.x265Build, '--config', 'Release', '--prefix', paths.x265Install], paths.x265Build, nativeEnvironment),
		command('libvpx-configure', tools.executables.shell.path, vpxArgs, paths.libvpxBuild, makeEnvironment),
		command('libvpx-build', tools.executables.make.path, ['-C', paths.libvpxBuild, '-j1', ...vpxMake], paths.libvpxBuild, makeEnvironment),
		command('libvpx-install', tools.executables.make.path, ['-C', paths.libvpxBuild, 'install', ...vpxMake], paths.libvpxBuild, makeEnvironment),
		...(windows ? [
			command('libvpx-normalize-library', tools.executables.cmake.path, ['-E', 'copy',
				join(paths.libvpxInstall, 'lib', target.id === 'win-arm64' ? 'ARM64' : 'x64', 'vpxmt.lib'),
				join(paths.libvpxInstall, 'lib', 'vpx.lib')], paths.libvpxBuild, nativeEnvironment),
			command('libvpx-normalize-pkg-config', tools.executables.cmake.path, ['-E', 'copy',
				join(hostRoot, 'build', 'windows-vpx.pc'),
				join(paths.libvpxInstall, 'lib', 'pkgconfig', 'vpx.pc')], paths.libvpxBuild, nativeEnvironment),
		] : []),
		command('libopus-configure', tools.executables.cmake.path, opusArgs, paths.libopusBuild, nativeEnvironment),
		command('libopus-build', tools.executables.cmake.path, ['--build', paths.libopusBuild, '--config', 'Release', '--target', 'opus', '--parallel', '1'], paths.libopusBuild, nativeEnvironment),
		command('libopus-install', tools.executables.cmake.path, ['--install', paths.libopusBuild, '--config', 'Release', '--prefix', paths.libopusInstall], paths.libopusBuild, nativeEnvironment),
		command('ffmpeg-configure', tools.executables.shell.path, ffmpegArgs, paths.ffmpegBuild, dependencyEnvironment),
		command('ffmpeg-build', tools.executables.make.path, ['-C', paths.ffmpegBuild, '-j1'], paths.ffmpegBuild, dependencyEnvironment),
		command('ffmpeg-install', tools.executables.make.path, ['-C', paths.ffmpegBuild, 'install'], paths.ffmpegBuild, dependencyEnvironment),
		command('host-configure', tools.executables.cmake.path, hostArgs, hostRoot, hostEnvironment),
		command('host-build', tools.executables.cmake.path, ['--build', paths.hostBuild, '--config', 'Release', '--parallel', '1'], hostRoot, hostEnvironment),
		command('host-install', tools.executables.cmake.path, ['--install', paths.hostBuild, '--config', 'Release', '--prefix', paths.hostInstall], hostRoot, hostEnvironment),
	]);
}

export function verifyFramescaperFfmpegConfiguration(ffmpegBuildRoot) {
	const path = join(ffmpegBuildRoot, 'ffbuild', 'config.mak');
	const lines = new Set(readFileSync(path, 'utf8').split(/\r?\n/u));
	const missing = FRAMESCAPER_FFMPEG_REQUIRED_CONFIGURATION.filter(
		(name) => !lines.has(`${name}=yes`),
	);
	if (missing.length > 0) {
		throw new Error(`FFmpeg configuration omitted required components: ${missing.join(', ')}.`);
	}
	for (const forbidden of ['CONFIG_NETWORK', 'CONFIG_SHARED', 'CONFIG_PROGRAMS']) {
		if (lines.has(`${forbidden}=yes`)) throw new Error(`FFmpeg configuration enabled ${forbidden}.`);
	}
	return Object.freeze({ required: Object.freeze([
		...FRAMESCAPER_FFMPEG_REQUIRED_CONFIGURATION,
	]) });
}

function ffmpegTargetArguments(target) {
	if (target.id === 'linux-x64') return ['--target-os=linux', '--arch=x86_64'];
	if (target.id === 'linux-arm64') return ['--target-os=linux', '--arch=aarch64'];
	if (target.id === 'mac-arm64') return ['--target-os=darwin', '--arch=arm64'];
	if (target.id === 'win-x64') return ['--target-os=win64', '--arch=x86_64', '--toolchain=msvc'];
	return ['--target-os=win64', '--arch=arm64', '--toolchain=msvc'];
}

function vpxTarget(target) {
	if (target === 'win-x64') return 'x86_64-win64-vs17';
	if (target === 'win-arm64') return 'arm64-win64-vs17';
	return 'generic-gnu';
}

function vpxArchitectureDisables(target) {
	if (target === 'win-x64') return [
		'--disable-mmx', '--disable-sse', '--disable-sse2', '--disable-sse3', '--disable-ssse3',
		'--disable-sse4_1', '--disable-avx', '--disable-avx2', '--disable-avx512',
	];
	if (target === 'win-arm64') return [
		'--disable-neon-asm', '--disable-neon', '--disable-neon-dotprod', '--disable-neon-i8mm',
		'--disable-sve', '--disable-sve2',
	];
	return [];
}

function shellPath(value, windows) {
	if (!windows) return value;
	if (value.startsWith('/')) return value;
	const match = /^([A-Za-z]):[\\/](.*)$/u.exec(value);
	if (!match) throw new TypeError('A Windows media-host shell path has no drive root.');
	return `/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`;
}

function shellTool(value, windows) {
	return windows ? value.replaceAll('\\', '/').split('/').at(-1) : value;
}

function command(phase, executable, args, cwd, environment) {
	if (!Array.isArray(args) || args.some((value) => typeof value !== 'string' || value.includes('\0'))) {
		throw new TypeError(`Build phase ${phase} has unsafe arguments.`);
	}
	return Object.freeze({
		phase, executable, args: Object.freeze(args), cwd,
		environment: Object.freeze({ ...environment }),
	});
}

function values(kind, names) { return names.map((name) => `--enable-${kind}=${name}`); }
function configNames(kind, names, aliases = {}) {
	return names.map((name) => `CONFIG_${(aliases[name] ?? name).toUpperCase()}_${kind}`);
}
function camel(value) { return value.replaceAll(/-([a-z])/gu, (_match, letter) => letter.toUpperCase()); }
function deepFreeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}
