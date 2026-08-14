/* SPDX-License-Identifier: AGPL-3.0-only */

import { lstat, readdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';

const FRAMEWORK_HEADER_NAMES = Object.freeze(new Set(['Headers', 'PrivateHeaders']));

/**
 * Playwright's macOS browsers ship raw framework build output, so every bundled
 * `*.framework` carries the C/C++/Objective-C headers the WebKit build emitted.
 * Nothing loads a header at runtime, but they dominate the file count, and the
 * macOS packaging walk signs the bundle under the runner's 256-descriptor soft
 * limit and dies with EMFILE part-way through them. Drop them before packaging
 * ever sees them; `pruneUnpackableSymlinks` then clears the framework links that
 * aimed at them.
 */
export async function pruneFrameworkDevelopmentHeaders(root) {
	const doomed = [];
	await visit(root, false);
	for (const path of doomed) await rm(path, { recursive: true });

	async function visit(path, insideFramework) {
		const metadata = await lstat(path);
		if (metadata.isSymbolicLink() || !metadata.isDirectory()) return;
		for (const entry of await readdir(path, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const child = join(path, entry.name);
			if (insideFramework && FRAMEWORK_HEADER_NAMES.has(entry.name)) doomed.push(child);
			else await visit(child, insideFramework || entry.name.endsWith('.framework'));
		}
	}
}

/**
 * The same raw build output ships text-based dylib stubs beside the framework
 * binary — `JavaScriptCore.framework/Versions/A/JavaScriptCore.tbd`. A `.tbd` is a
 * YAML description of exported symbols that only the linker reads, but `codesign`
 * walking the framework treats one named after the framework as a subcomponent of
 * it, finds a text file carrying no signature, and fails the whole bundle with
 * "code object is not signed at all". Nothing loads a stub at runtime, so drop
 * them here rather than teaching the signing walk to skip the browsers wholesale.
 */
export async function pruneFrameworkLinkerStubs(root) {
	const doomed = [];
	await visit(root, false);
	for (const path of doomed) await rm(path);

	async function visit(path, insideFramework) {
		const metadata = await lstat(path);
		if (metadata.isSymbolicLink() || !metadata.isDirectory()) return;
		for (const entry of await readdir(path, { withFileTypes: true })) {
			const child = join(path, entry.name);
			if (entry.isDirectory()) {
				await visit(child, insideFramework || entry.name.endsWith('.framework'));
			} else if (insideFramework && entry.isFile() && entry.name.endsWith('.tbd')) {
				doomed.push(child);
			}
		}
	}
}

/**
 * electron-builder copies only files and symbolic links, creating destination
 * directories on demand as the parents of what it copies, so a directory whose
 * subtree holds nothing copyable never reaches the packaged application. Playwright's
 * macOS WebKit.framework aims its `Frameworks` link at exactly such an empty
 * directory; packaged as-is the link dangles and the macOS signing walk stats it and
 * fails. Drop those links here, where nothing can resolve through them anyway. A link
 * that no longer resolves at all — a header directory this staging already dropped —
 * is unpackable for the same reason.
 */
export async function pruneUnpackableSymlinks(root) {
	const doomed = [];
	await visit(root);
	for (const path of doomed) await rm(path);

	async function visit(path) {
		const metadata = await lstat(path);
		if (metadata.isSymbolicLink()) {
			if (!(await resolvesToPackableEntry(path))) doomed.push(path);
			return;
		}
		if (!metadata.isDirectory()) return;
		for (const entry of await readdir(path)) await visit(join(path, entry));
	}
}

async function resolvesToPackableEntry(path) {
	let target;
	try {
		target = await realpath(path);
	} catch (error) {
		if (error?.code === 'ENOENT' || error?.code === 'ELOOP') return false;
		throw error;
	}
	return holdsPackableEntry(target);
}

async function holdsPackableEntry(path) {
	if (!(await lstat(path)).isDirectory()) return true;
	for (const entry of await readdir(path, { withFileTypes: true })) {
		if (!entry.isDirectory()) return true;
		if (await holdsPackableEntry(join(path, entry.name))) return true;
	}
	return false;
}

