/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { hashMotionSustainedFile } from './motionscaper-sustained-observation.ts';

interface Pin { readonly path: string; readonly byteLength: number; readonly sha256: string }
interface PrefixAuthority {
	readonly schemaVersion: 1; readonly prefix: string; readonly nativeBuildReceiptSha256: string;
	readonly trees: readonly Readonly<{ directory: string; files: readonly Pin[] }>[];
}
function record(value: unknown): Record<string, unknown> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>;
}
/** The expected SHA is supplied by the reviewer, never minted from these observed prefix bytes. */
export async function verifyMotionSustainedReferenceAuthority(path: string, expectedSha256: string, prefix: string, nativeReceiptSha256: string) {
	assert.match(expectedSha256, /^[a-f0-9]{64}$/u);
	const chunks: Uint8Array[] = [];
	const authorityPin = await hashMotionSustainedFile(path, 4 * 1024 * 1024, bytes => { chunks.push(Uint8Array.from(bytes)); }); assert.equal(authorityPin.sha256, expectedSha256);
	const value = record(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
	assert.deepEqual(Object.keys(value).sort(), ['nativeBuildReceiptSha256', 'prefix', 'schemaVersion', 'trees']);
	assert.equal(value.schemaVersion, 1); assert.equal(value.prefix, prefix); assert.equal(value.nativeBuildReceiptSha256, nativeReceiptSha256);
	assert.ok(Array.isArray(value.trees) && value.trees.length >= 2 && value.trees.length <= 16);
	const directories = new Set<string>();
	for (const input of value.trees) {
		const tree = record(input); assert.deepEqual(Object.keys(tree).sort(), ['directory', 'files']);
		assert.ok(typeof tree.directory === 'string' && isAbsolute(tree.directory) && resolve(tree.directory) === tree.directory);
		assert.equal(await realpath(tree.directory), tree.directory); assert.ok(!directories.has(tree.directory)); directories.add(tree.directory);
		assert.ok(Array.isArray(tree.files) && tree.files.length > 0 && tree.files.length <= 4096);
		const expected: string[] = [];
		for (const inputFile of tree.files) {
			const file = record(inputFile); assert.deepEqual(Object.keys(file).sort(), ['byteLength', 'path', 'sha256']);
			assert.ok(typeof file.path === 'string' && !isAbsolute(file.path) && !file.path.split('/').some(part => !part || part === '.' || part === '..'));
			assert.ok(typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(file.sha256));
			const actual = await hashMotionSustainedFile(join(tree.directory, file.path)); assert.equal(actual.byteLength, file.byteLength); assert.equal(actual.sha256, file.sha256); expected.push(file.path);
		}
		assert.equal(new Set(expected).size, expected.length);
		const actual: string[] = [];
		const visit = async (relative: string): Promise<void> => {
			for (const entry of await readdir(join(tree.directory as string, relative), { withFileTypes: true })) {
				const name = relative ? `${relative}/${entry.name}` : entry.name;
				if (entry.isDirectory()) await visit(name); else { assert.ok(entry.isFile(), 'Reference closure rejects symlinks/special files.'); actual.push(name); }
				assert.ok(actual.length <= 4096);
			}
		};
		await visit(''); assert.deepEqual(actual.sort(), expected.sort());
	}
	assert.ok(directories.has(join(prefix, 'include')) && directories.has(join(prefix, 'lib')));
	const authority = value as unknown as PrefixAuthority;
	return { pin: authorityPin, authority, verifyFlags(tokens: readonly string[]) {
		for (const token of tokens) {
			if (token.startsWith('-I')) assert.equal(token.slice(2), join(prefix, 'include'));
			else if (token.startsWith('-L')) assert.ok(directories.has(token.slice(2)), `Unapproved reference link directory: ${token}`);
			else if (token.startsWith('-l')) {
				const name = token.slice(2);
				assert.ok(['m', 'pthread', 'atomic', 'stdc++', 'gcc_s', 'gcc', 'rt', 'dl'].includes(name)
					|| authority.trees.some(tree => tree.files.some(file => file.path === `lib${name}.a`)), `Unapproved reference library: ${token}`);
			} else assert.equal(token, '-pthread');
		}
	} };
}
