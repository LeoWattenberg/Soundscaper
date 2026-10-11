/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, relative, sep } from 'node:path';
import { assertPagesBuildIdentity } from './pages-deployment-plan.ts';
import { motionReleaseVersionChannel, type MotionReleaseIdentity } from './motionscaper-release-policy.ts';

const ORIGIN = 'https://motionscaper.org';
const MAX_FILES = 16_384; const MAX_FILE_BYTES = 25 * 1024 * 1024; const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
interface FilePin { readonly path: string; readonly byteLength: number; readonly sha256: string }
export interface MotionReleaseWebArtifact {
	readonly schemaVersion: 1; readonly productId: 'motionscaper'; readonly tag: string; readonly channel: 'candidate' | 'stable';
	readonly applicationVersion: string; readonly sourceRevision: string; readonly origin: string; readonly files: readonly FilePin[];
}
interface Options { readonly directory: string; readonly evidence: string; readonly identity: MotionReleaseIdentity }
function expectedIdentity(identity: MotionReleaseIdentity) {
	if (identity.productId !== 'motionscaper' || identity.tag !== `motionscaper-v${identity.version}`
		|| motionReleaseVersionChannel(identity.version) !== identity.channel || !/^[a-f\d]{40}$/u.test(identity.sourceRevision)) throw new Error('Motion web artifact identity or channel is invalid.');
	return { schemaVersion: 1 as const, productId: 'motionscaper' as const, tag: identity.tag, channel: identity.channel,
		applicationVersion: identity.version, sourceRevision: identity.sourceRevision, origin: ORIGIN };
}
async function assertOwnedDirectory({ directory, evidence }: Options): Promise<void> {
	if (resolve(directory) !== await realpath(directory)) throw new Error('Motion web artifact directory must not pass through a symlink.');
	const evidenceRelative = relative(resolve(directory), resolve(evidence));
	// Evidence stays beside the deployment and cannot alter the bytes it authenticates.
	if (evidenceRelative === '' || (!evidenceRelative.startsWith(`..${sep}`) && evidenceRelative !== '..' && !isAbsolute(evidenceRelative))) throw new Error('Motion web artifact evidence must remain outside the deployment.');
	if (resolve(dirname(evidence)) !== await realpath(dirname(evidence))) throw new Error('Motion web artifact evidence parent must not pass through a symlink.');
	await assertPagesBuildIdentity(directory, { productId: 'motionscaper', projectName: 'motionscaper', origin: ORIGIN });
	const handbook = join(directory, 'docs/index.html'); const metadata = await lstat(handbook);
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_FILE_BYTES
		|| !(await readFile(handbook, 'utf8')).includes(`href="${ORIGIN}/docs/"`)) throw new Error('Motion web artifact requires its own production handbook.');
}
async function inventory(directory: string): Promise<readonly FilePin[]> {
	const files: FilePin[] = []; let total = 0; let entries = 0;
	async function visit(prefix: string): Promise<void> {
		for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
			if (++entries > MAX_FILES * 2 || prefix.split('/').length > 32) throw new Error('Motion web artifact directory bound exceeded.');
			const name = prefix ? `${prefix}/${entry.name}` : entry.name;
			if ([...name].some(character => character === '\\' || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error('Motion web artifact path is invalid.');
			if (entry.isDirectory()) { await visit(name); continue; }
			if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Motion web artifact inputs must be regular files, not symlinks.');
			if (files.length >= MAX_FILES) throw new Error('Motion web artifact file-count bound exceeded.');
			const path = join(directory, name); const before = await lstat(path);
			if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_FILE_BYTES || total + before.size > MAX_TOTAL_BYTES) throw new Error('Motion web artifact byte bound exceeded.');
			const hash = createHash('sha256'); let length = 0;
			for await (const chunk of createReadStream(path)) { length += Buffer.byteLength(chunk); if (length > before.size) throw new Error('Motion web artifact bytes changed during capture.'); hash.update(chunk); }
			const after = await lstat(path);
			if (length !== before.size || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Motion web artifact bytes changed during capture.');
			files.push({ path: name, byteLength: length, sha256: hash.digest('hex') }); total += length;
		}
	}
	await visit('');
	return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
export async function captureMotionReleaseWebArtifact(options: Options): Promise<MotionReleaseWebArtifact> {
	const identity = expectedIdentity(options.identity); await assertOwnedDirectory(options);
	const files = await inventory(options.directory);
	if (JSON.stringify(files) !== JSON.stringify(await inventory(options.directory))) throw new Error('Motion web artifact inventory changed during capture.');
	const result = { ...identity, files };
	await writeFile(options.evidence, `${JSON.stringify(result, null, '\t')}\n`, { flag: 'wx' });
	return result;
}
export async function verifyMotionReleaseWebArtifact(options: Options): Promise<MotionReleaseWebArtifact> {
	const identity = expectedIdentity(options.identity); await assertOwnedDirectory(options);
	const metadata = await lstat(options.evidence);
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > 16 * 1024 * 1024) throw new Error('Motion web artifact identity record exceeds its bound.');
	const value: unknown = JSON.parse(await readFile(options.evidence, 'utf8'));
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Motion web artifact identity is invalid.');
	const record = value as Record<string, unknown>;
	if (Object.keys(record).sort().join() !== [...Object.keys(identity), 'files'].sort().join()
		|| Object.entries(identity).some(([key, expected]) => record[key] !== expected)) throw new Error('Motion web artifact identity differs from the independently selected release.');
	const files = await inventory(options.directory);
	if (JSON.stringify(record.files) !== JSON.stringify(files)) throw new Error('Motion web artifact inventory or bytes differ from the admitted build.');
	if (JSON.stringify(files) !== JSON.stringify(await inventory(options.directory))
		|| JSON.stringify(record) !== JSON.stringify(JSON.parse(await readFile(options.evidence, 'utf8')))) throw new Error('Motion web artifact bytes or evidence changed during verification.');
	return { ...identity, files };
}
