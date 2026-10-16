/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, readSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface VerifiedTreeOptions {
	readonly root: string;
	readonly receipt: string;
	readonly identity: string;
	readonly allowedLinkRoots?: readonly string[];
	readonly preserveModes?: boolean;
}
type TreeEntry = readonly [path: string, kind: 'directory' | 'file' | 'link', mode: number, content: string];
interface TreeReceipt {
	readonly schemaVersion: 1;
	readonly identity: string;
	readonly entries: readonly TreeEntry[];
}
const digestBuffer = Buffer.allocUnsafe(1024 * 1024);

/** Receipts are made after authenticated installation, and saved before tests can mutate the tree. */
export function recordVerifiedInputTree(options: VerifiedTreeOptions): void {
	if (inside(options.root, options.receipt)) throw new Error('A tree receipt must be outside its input tree.');
	const receipt: TreeReceipt = { schemaVersion: 1, identity: options.identity, entries: inventory(options) };
	mkdirSync(dirname(options.receipt), { recursive: true });
	writeFileSync(options.receipt, JSON.stringify(receipt));
}

/** A stale or damaged restored tree always falls back to a fresh authenticated installation. */
export function verifyInputTree(options: VerifiedTreeOptions): boolean {
	try {
		const metadata = lstatSync(options.receipt);
		if (!metadata.isFile() || metadata.size > 16 * 1024 * 1024) return false;
		const receipt: unknown = JSON.parse(readFileSync(options.receipt, 'utf8'));
		if (typeof receipt !== 'object' || receipt === null
			|| !('schemaVersion' in receipt) || receipt.schemaVersion !== 1
			|| !('identity' in receipt) || receipt.identity !== options.identity
			|| !('entries' in receipt) || !Array.isArray(receipt.entries)) return false;
		return JSON.stringify(receipt.entries) === JSON.stringify(inventory(options));
	} catch {
		return false;
	}
}

function inventory(options: VerifiedTreeOptions): readonly TreeEntry[] {
	const root = resolve(options.root);
	if (!lstatSync(root).isDirectory()) throw new Error('Verified input root must be a regular directory.');
	const entries: TreeEntry[] = [];
	const roots = options.allowedLinkRoots?.map(path => resolve(path)) ?? [];
	const visit = (directory: string): void => {
		for (const name of readdirSync(directory).sort()) {
			const path = join(directory, name);
			const metadata = lstatSync(path);
			const relativePath = relative(root, path).split(sep).join('/');
			const mode = options.preserveModes === false ? 0 : metadata.mode & 0o777;
			if (metadata.isDirectory()) {
				entries.push([relativePath, 'directory', mode, '']);
				visit(path);
			} else if (metadata.isFile()) {
				entries.push([relativePath, 'file', mode, `${metadata.size}:${fileDigest(path)}`]);
			} else if (metadata.isSymbolicLink()) {
				const target = readlinkSync(path);
				const resolved = resolve(directory, target);
				if (isAbsolute(target) || !inside(root, resolved) && !roots.includes(resolved)) throw new Error(`Input link escapes its authenticated roots: ${relativePath}`);
				const actual = realpathSync(path);
				if (!inside(root, actual) && !roots.some(allowed => inside(allowed, actual))) throw new Error(`Input link escapes its authenticated roots: ${relativePath}`);
				entries.push([relativePath, 'link', mode, target]);
			} else throw new Error(`Verified input must be a regular file, directory or admitted link: ${relativePath}`);
		}
	};
	visit(root);
	return entries;
}

export function fileDigest(path: string): string {
	if (!lstatSync(path).isFile()) throw new Error(`Digest input must be a regular file: ${path}`);
	const hash = createHash('sha256');
	const descriptor = openSync(path, 'r');
	try {
		for (;;) {
			const length = readSync(descriptor, digestBuffer);
			if (length === 0) break;
			hash.update(digestBuffer.subarray(0, length));
		}
	} finally { closeSync(descriptor); }
	return hash.digest('hex');
}

function inside(root: string, path: string): boolean {
	const child = relative(resolve(root), resolve(path));
	return child === '' || !isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`);
}
