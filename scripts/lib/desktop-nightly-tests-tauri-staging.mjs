/* SPDX-License-Identifier: AGPL-3.0-only */

import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
	assertDirectory, assertRegularFile, assertSafeTree, copyTree, hashFile,
	isPathInside, readRequiredJson, resolveRequiredPath,
} from './desktop-nightly-tests-staging-filesystem.mjs';

/** @typedef {{ platform: 'win' | 'mac' | 'linux', arch: 'x64' | 'arm64' }} TauriTarget */
/** @typedef {{ root: string, executable: string, sourceRevision: string, target: TauriTarget }} ValidatedTauriPrototype */

const REQUIRED_FILES = Object.freeze([
	'LICENSE', 'THIRD_PARTY_LICENSES.md', 'README.md', 'SOURCE_REVISION', 'SOURCE_URL', 'TARGET.json',
	'prototypes/tauri/host/Cargo.toml', 'prototypes/tauri/host/Cargo.lock',
	'prototypes/tauri/host/rust-toolchain.toml', 'licenses/rust/inventory.json',
]);

/**
 * Admit a prebuilt host only when its source and native target match the runner.
 * All input checks happen before the caller replaces an existing payload.
 * @param {{ artifactRoot: string, outputRoot?: string, sourceRevision: string | null,
 * target: { platform: string | null, arch: string | null } }} options
 * @returns {Promise<ValidatedTauriPrototype>}
 */
export async function validateDesktopNightlyTestsTauriPrototype({ artifactRoot, outputRoot, sourceRevision, target }) {
	if (typeof sourceRevision !== 'string' || !/^[a-f0-9]{40}$/u.test(sourceRevision)) {
		throw new Error('Tauri prototype staging requires a full source revision.');
	}
	const root = resolveRequiredPath(artifactRoot, 'Tauri prototype artifact root');
	if (outputRoot && (root === outputRoot || isPathInside(root, outputRoot) || isPathInside(outputRoot, root))) {
		throw new Error('Tauri prototype artifact source must not overlap the nightly payload output.');
	}
	await assertDirectory(root, 'Tauri prototype artifact');
	await assertSafeTree(root, 'Tauri prototype artifact');
	for (const path of REQUIRED_FILES) await requireFile(join(root, path), `Tauri prototype ${path}`);
	await assertDirectory(join(root, 'LICENSES'), 'Tauri prototype browser notices');
	const revision = (await readFile(join(root, 'SOURCE_REVISION'), 'utf8')).trim();
	if (revision !== sourceRevision) throw new Error('Tauri prototype source revision does not match the nightly payload.');
	const sourceURL = (await readFile(join(root, 'SOURCE_URL'), 'utf8')).trim();
	if (sourceURL !== `https://github.com/LeoWattenberg/Soundscaper/tree/${revision}`) {
		throw new Error('Tauri prototype source revision URL is invalid.');
	}
	const identity = await readRequiredJson(join(root, 'TARGET.json'), 'Tauri prototype target');
	if (!identity || !['win', 'mac', 'linux'].includes(identity.platform) || !['x64', 'arm64'].includes(identity.arch)
		|| typeof identity.rustTarget !== 'string' || !/^[a-z0-9_][a-z0-9_.-]+$/u.test(identity.rustTarget)
		|| identity.platform !== target.platform || identity.arch !== target.arch) {
		throw new Error('Tauri prototype target does not match the nightly payload platform and architecture.');
	}
	const executable = `soundscaper-tauri-prototype${identity.platform === 'win' ? '.exe' : ''}`;
	await requireFile(join(root, executable), 'Tauri prototype executable');
	await validateRustNotices(root);
	return Object.freeze({ root, executable, sourceRevision: revision,
		target: Object.freeze({ platform: identity.platform, arch: identity.arch }) });
}

/** @param {ValidatedTauriPrototype} prototype @param {string} outputRoot */
export async function stageDesktopNightlyTestsTauriPrototype(prototype, outputRoot) {
	const destination = join(outputRoot, 'tauri-prototype');
	if (prototype.root === destination || isPathInside(prototype.root, destination) || isPathInside(destination, prototype.root)) {
		throw new Error('Tauri prototype artifact source must not overlap its staged destination.');
	}
	await copyTree(prototype.root, destination);
	const executable = join(destination, prototype.executable);
	const metadata = await lstat(executable);
	return Object.freeze({
		executable: `tauri-prototype/${prototype.executable}`,
		sourceRevision: prototype.sourceRevision,
		target: prototype.target,
		byteLength: metadata.size,
		sha256: await hashFile(executable),
	});
}

/** @param {string} path @param {string} label */
async function requireFile(path, label) {
	await assertRegularFile(path, label);
	if ((await lstat(path)).size === 0) throw new Error(`Required ${label} must be a nonempty file: ${path}`);
}

/** @param {string} root */
async function validateRustNotices(root) {
	const inventory = await readRequiredJson(join(root, 'licenses/rust/inventory.json'), 'Tauri prototype Rust notice inventory');
	if (!Array.isArray(inventory)) throw new Error('Tauri prototype Rust notice inventory must be an array.');
	for (const dependency of inventory) {
		if (!dependency || typeof dependency.name !== 'string' || typeof dependency.version !== 'string'
			|| !/^[A-Za-z0-9_.+-]+$/u.test(dependency.name) || !/^[A-Za-z0-9_.+-]+$/u.test(dependency.version)
			|| !Array.isArray(dependency.files)) throw new Error('Tauri prototype Rust notice identity is invalid.');
		for (const path of dependency.files) {
			if (typeof path !== 'string' || !path || path.split('/').some((part) => !part || part === '.' || part === '..')
				|| path.includes('\\') || path.includes(':')) throw new Error('Tauri prototype Rust notice path is invalid.');
			await requireFile(join(root, 'licenses/rust', `${dependency.name}-${dependency.version}`, path),
				`Tauri prototype Rust notice ${dependency.name}/${path}`);
		}
	}
}
