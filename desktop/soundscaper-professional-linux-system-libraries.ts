/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed Linux operating-system runtime policy for the professional peer. */

export type SoundscaperProfessionalLinuxTarget = 'linux-x64' | 'linux-arm64';

const LOADERS: Readonly<Record<SoundscaperProfessionalLinuxTarget, Readonly<{
	name: string;
	interpreter: string;
}>>> = Object.freeze({
	'linux-x64': Object.freeze({
		name: 'ld-linux-x86-64.so.2', interpreter: '/lib64/ld-linux-x86-64.so.2',
	}),
	'linux-arm64': Object.freeze({
		name: 'ld-linux-aarch64.so.1', interpreter: '/lib/ld-linux-aarch64.so.1',
	}),
});

const SYSTEM_LIBRARIES = new Set([
	'libasound.so.2', 'libbrotlicommon.so.1', 'libbrotlidec.so.1', 'libbz2.so.1.0',
	'libc.so.6', 'libdl.so.2', 'libexpat.so.1', 'libfontconfig.so.1',
	'libfreetype.so.6', 'libgcc_s.so.1', 'libm.so.6', 'libpng16.so.16',
	'libpthread.so.0', 'librt.so.1', 'libstdc++.so.6', 'libX11.so.6',
	'libXcursor.so.1', 'libXext.so.6', 'libXinerama.so.1', 'libXrandr.so.2',
	'libXrender.so.1', 'libz.so.1',
]);

export function soundscaperProfessionalLinuxLoaderName(
	target: SoundscaperProfessionalLinuxTarget,
): string {
	return loader(target).name;
}

export function soundscaperProfessionalLinuxInterpreter(
	target: SoundscaperProfessionalLinuxTarget,
): string {
	return loader(target).interpreter;
}

export function isSoundscaperProfessionalLinuxSystemLibrary(value: unknown): value is string {
	return typeof value === 'string' && !value.includes('\0') && !value.includes('/')
		&& !value.includes('\\') && SYSTEM_LIBRARIES.has(value);
}

export function isSoundscaperProfessionalLinuxRuntimeLibrary(
	value: unknown,
	target: SoundscaperProfessionalLinuxTarget,
): value is string {
	return value === soundscaperProfessionalLinuxLoaderName(target)
		|| isSoundscaperProfessionalLinuxSystemLibrary(value);
}

function loader(target: SoundscaperProfessionalLinuxTarget): Readonly<{
	name: string;
	interpreter: string;
}> {
	const value = LOADERS[target];
	if (value === undefined) {
		throw new TypeError('A professional ELF loader exists only for linux-x64 and linux-arm64.');
	}
	return value;
}
