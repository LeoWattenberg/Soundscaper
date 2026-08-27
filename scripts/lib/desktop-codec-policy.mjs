/* SPDX-License-Identifier: AGPL-3.0-only */

import { lstat, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const PROVIDER_ORDER = Object.freeze([
	'bundled-reviewed-codecs',
	'os',
	'external-user-install',
]);

/** Immutable policy recorded in every desktop stage and release manifest. */
export const DESKTOP_CODEC_POLICY = Object.freeze({
	schemaVersion: 1,
	bundledFfmpeg: false,
	providerOrder: PROVIDER_ORDER,
});

const FFMPEG_PROGRAM = /^ff(?:mpeg|probe|play)(?:-[0-9][A-Za-z0-9._-]*)?(?:\.exe)?$/iu;
const FFMPEG_CORE = /^ffmpeg-core(?:[.-][A-Za-z0-9._-]+)?$/iu;
const FFMPEG_SIDECAR = /^ffmpeg-(?:corresponding-source|runtime-manifest|build-source|source)(?:[.-][A-Za-z0-9._-]+)?$/iu;
const FFMPEG_ARCHIVE = /^ffmpeg(?:-[A-Za-z0-9._-]+)?\.(?:zip|tar|tar\.bz2|tar\.gz|tar\.xz|tbz2|tgz|txz)$/iu;
const LIBAV_PAYLOAD = /^(?:lib)?(?:avcodec|avdevice|avfilter|avformat|avresample|avutil|postproc|swresample|swscale)(?:[-.][A-Za-z0-9._-]+)?$/iu;

export function assertDesktopCodecPolicy(value, label = 'Desktop codec policy') {
	if (JSON.stringify(value) !== JSON.stringify(DESKTOP_CODEC_POLICY)) {
		throw new Error(`${label} does not match the immutable desktop codec policy.`);
	}
	return DESKTOP_CODEC_POLICY;
}

export function isForbiddenDesktopFfmpegPath(path) {
	const normalized = String(path).replaceAll('\\', '/').replace(/^\.\//u, '');
	const segments = normalized.split('/').filter(Boolean);
	for (let index = 0; index < segments.length - 1; index += 1) {
		if (segments[index].toLowerCase() === 'runtime'
			&& segments[index + 1].toLowerCase() === 'ffmpeg') return true;
	}
	const name = segments.at(-1) ?? '';
	return FFMPEG_PROGRAM.test(name)
		|| FFMPEG_CORE.test(name)
		|| FFMPEG_SIDECAR.test(name)
		|| FFMPEG_ARCHIVE.test(name)
		|| LIBAV_PAYLOAD.test(name);
}

/**
 * Audit a staged or packaged resource tree without following symbolic links.
 * This gate rejects general-purpose FFmpeg programs, Web runtimes, archives,
 * and loose libav payloads. The separately authenticated Framescaper media-host
 * subtree is admitted by its exact manifest verifier and therefore is not
 * rejected merely because of its directory name.
 */
export async function auditDesktopFfmpegAbsence({ root, label = 'Desktop resources' }) {
	const auditRoot = resolveRequiredRoot(root);
	const rootMetadata = await lstat(auditRoot).catch((error) => {
		throw new Error(`${label} root is unavailable: ${error.message}`, { cause: error });
	});
	if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
		throw new Error(`${label} root is not a regular directory.`);
	}
	let entryCount = 0;
	async function visit(directory) {
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
		for (const entry of entries) {
			const path = resolve(directory, entry.name);
			const name = relative(auditRoot, path).split(sep).join('/');
			entryCount += 1;
			if (isForbiddenDesktopFfmpegPath(name)) {
				throw new Error(`${label} contains forbidden unmanaged FFmpeg/libav content: ${name}.`);
			}
			const metadata = await lstat(path);
			if (metadata.isDirectory() && !metadata.isSymbolicLink()) await visit(path);
		}
	}
	await visit(auditRoot);
	return Object.freeze({ status: 'no-bundled-ffmpeg', entryCount });
}

function resolveRequiredRoot(value) {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new TypeError('Desktop FFmpeg absence audit requires a resource root.');
	}
	return resolve(value);
}
