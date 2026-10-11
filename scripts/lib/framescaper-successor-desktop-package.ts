/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractFile, listPackage, statFile } from '@electron/asar';
import { parseMotionscaperNativePayload, loadMotionscaperNativeExecutable } from '../../desktop/motionscaper-native-payload.ts';
import { normalizeFramescaperSuccessorDesktopMetadata } from '../../desktop/framescaper-successor-contract.ts';
import { auditDesktopFfmpegAbsence, DESKTOP_CODEC_POLICY } from './desktop-codec-policy.mjs';
const APP_FILES = Object.freeze(['app/desktop/main.mjs', 'app/desktop/preload.cjs', 'app/desktop/product.json', 'app/desktop/native-payload.json', 'app/desktop/native-notices.md', 'app/package.json']);
interface FileIdentity { readonly path: string; readonly byteLength: number; readonly sha256: string }
interface SuccessorStage { readonly schemaVersion: 1; readonly productId: 'framescaper'; readonly line: 'successor'; readonly nativeServiceProfile: 'framescaper-successor-v2'; readonly applicationVersion: string; readonly releaseEligible: false;
	readonly target: Readonly<{ platform: string; arch: string }>; readonly nativeCapabilities: readonly string[]; readonly desktopCodecPolicy: unknown; readonly files: readonly FileIdentity[] }
export async function createFramescaperSuccessorStageInventory(root: string): Promise<readonly FileIdentity[]> {
	const metadata = normalizeFramescaperSuccessorDesktopMetadata(JSON.parse(await readFile(join(root, 'app/desktop/product.json'), 'utf8')));
	const application = JSON.parse(await readFile(join(root, 'app/package.json'), 'utf8')) as Record<string, unknown>;
	if (application.name !== 'framescaper-successor-desktop' || application.version !== metadata.applicationVersion || application.main !== 'desktop/main.mjs' || application.type !== 'module') throw new Error('Successor application identity is invalid.');
	const native = parseMotionscaperNativePayload(JSON.parse(await readFile(join(root, 'app/desktop/native-payload.json'), 'utf8')));
	await loadMotionscaperNativeExecutable(root, native);
	const result: FileIdentity[] = [];
	for (const tree of ['app', 'renderer', 'runtime']) for (const path of await regularFiles(root, tree)) {
		if (tree === 'runtime' && path !== native.helper?.path) throw new Error('Successor native runtime inventory admits only its authenticated linear-frame helper.');
		if (tree === 'app' && !APP_FILES.includes(path)) throw new Error(`Successor application inventory rejects ${path}.`);
		result.push(identity(path, await readFile(join(root, path))));
	}
	if (APP_FILES.some(path => !result.some(file => file.path === path)) || !result.some(file => file.path === 'renderer/index.html')) throw new Error('Successor application inventory is incomplete.');
	return result.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}
export async function verifyFramescaperSuccessorDesktopStage(root: string, targetId: string): Promise<SuccessorStage> {
	const stage = JSON.parse(await readFile(join(root, 'stage-manifest.json'), 'utf8')) as SuccessorStage;
	const metadata = normalizeFramescaperSuccessorDesktopMetadata(JSON.parse(await readFile(join(root, 'app/desktop/product.json'), 'utf8')));
	const native = parseMotionscaperNativePayload(JSON.parse(await readFile(join(root, 'app/desktop/native-payload.json'), 'utf8')));
	if (stage.schemaVersion !== 1 || stage.productId !== 'framescaper' || stage.line !== 'successor' || stage.nativeServiceProfile !== 'framescaper-successor-v2'
		|| stage.applicationVersion !== metadata.applicationVersion || stage.releaseEligible !== false || !['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'].includes(targetId)
		|| `${stage.target?.platform}-${stage.target?.arch}` !== targetId || native.target !== targetId || JSON.stringify(stage.nativeCapabilities) !== JSON.stringify(['motion-saved-files-v1', ...(native.helper ? ['frame-sequence-prores-v1'] : [])])
		|| JSON.stringify(stage.desktopCodecPolicy) !== JSON.stringify(DESKTOP_CODEC_POLICY)) throw new Error('Successor stage identity, target or native admission is invalid.');
	const files = await createFramescaperSuccessorStageInventory(root);
	if (JSON.stringify(files) !== JSON.stringify(stage.files)) throw new Error('Successor stage inventory or digest changed.');
	await auditDesktopFfmpegAbsence({ root, label: 'Framescaper successor staged resources' }); return stage;
}
export async function verifyFramescaperSuccessorPackagedResources(root: string, stage: SuccessorStage): Promise<void> {
	const asar = join(root, 'app.asar'), files: FileIdentity[] = [];
	for (const entry of listPackage(asar, { isPack: false })) {
		const path = entry.replace(/^\//u, ''), metadata = statFile(asar, path, false);
		if ('files' in metadata) continue; if ('link' in metadata || 'unpacked' in metadata && metadata.unpacked) throw new Error('Successor app archive contains an unadmitted link or unpacked file.');
		files.push(identity(`app/${path}`, extractFile(asar, path)));
	}
	const native = parseMotionscaperNativePayload(JSON.parse(extractFile(asar, 'desktop/native-payload.json').toString('utf8')));
	if (native.target !== `${stage.target.platform}-${stage.target.arch}`) throw new Error('Successor native payload target differs from its stage.');
	await loadMotionscaperNativeExecutable(root, native);
	for (const tree of ['renderer', 'runtime']) for (const path of await regularFiles(root, tree, tree === 'runtime')) {
		if (tree === 'runtime' && path !== native.helper?.path) throw new Error('Successor packaged runtime inventory contains an unadmitted helper.'); files.push(identity(path, await readFile(join(root, path))));
	}
	files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
	if (JSON.stringify(files) !== JSON.stringify(stage.files)) throw new Error('Successor packaged resource inventory differs from the authenticated stage.');
	await auditDesktopFfmpegAbsence({ root, label: 'Framescaper successor packaged resources' });
}
async function regularFiles(root: string, directory: string, allowMissing = false): Promise<string[]> {
	const details = await lstat(join(root, directory)).catch((error: unknown) => { if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
	if (!details) return []; if (!details.isDirectory() || details.isSymbolicLink()) throw new Error('Successor package directory must be regular.');
	const result: string[] = [];
	for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
		const path = `${directory}/${entry.name}`; if (entry.isDirectory()) result.push(...await regularFiles(root, path));
		else if (entry.isFile()) result.push(path); else throw new Error(`Successor package entry ${path} must be regular.`);
	}
	return result;
}
function identity(path: string, bytes: Buffer): FileIdentity { return { path, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }; }
