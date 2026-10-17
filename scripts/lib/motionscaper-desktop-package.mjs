/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadMotionscaperNativeExecutable, parseMotionscaperNativePayload } from '../../desktop/motionscaper-native-payload.ts';
import { extractFile, listPackage, statFile } from '@electron/asar';
import { auditDesktopFfmpegAbsence, DESKTOP_CODEC_POLICY } from './desktop-codec-policy.mjs';

const APP_FILES = Object.freeze(['app/desktop/main.mjs', 'app/desktop/preload.cjs', 'app/desktop/product.json', 'app/desktop/native-payload.json', 'app/desktop/native-notices.md', 'app/package.json']);

export async function createMotionscaperStageInventory(root) {
	const native = parseMotionscaperNativePayload(JSON.parse(await readFile(join(root, 'app/desktop/native-payload.json'), 'utf8')));
	await loadMotionscaperNativeExecutable(root, native);
	const result = [];
	for (const tree of ['app', 'renderer', 'runtime']) {
		for (const path of await regularFiles(root, tree)) {
			if (tree === 'runtime' && path !== native.helper?.path) throw new Error('Motionscaper admits no undeclared native runtime inventory.');
			if (tree === 'app' && !APP_FILES.includes(path)) throw new Error(`Motionscaper shell admits no application file ${path}.`);
			const bytes = await readFile(join(root, path));
			result.push({ path, byteLength: bytes.byteLength, sha256: digest(bytes) });
		}
	}
	if (APP_FILES.some((path) => !result.some((file) => file.path === path))
		|| !result.some((file) => file.path === 'renderer/index.html')) throw new Error('Motionscaper shell inventory is incomplete.');
	return result.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

export async function verifyMotionscaperDesktopStage(root, targetId) {
	const stage = JSON.parse(await readFile(join(root, 'stage-manifest.json'), 'utf8'));
	const native = parseMotionscaperNativePayload(JSON.parse(await readFile(join(root, 'app/desktop/native-payload.json'), 'utf8')));
	const capabilities = ['project-files-v1', ...(native.helper ? ['prores-4444-v1'] : [])];
	if (stage?.schemaVersion !== 1 || stage.productId !== 'motionscaper'
		|| stage.nativeServiceProfile !== 'motionscaper-desktop-v1'
		|| JSON.stringify(stage.nativeCapabilities) !== JSON.stringify(capabilities) || native.target !== targetId
		|| `${stage.target?.platform}-${stage.target?.arch}` !== targetId) {
		throw new Error('Motionscaper shell stage identity, target, or native admission is invalid.');
	}
	if (JSON.stringify(stage.desktopCodecPolicy) !== JSON.stringify(DESKTOP_CODEC_POLICY)) {
		throw new Error('Motionscaper shell codec policy is invalid.');
	}
	const files = await createMotionscaperStageInventory(root);
	if (JSON.stringify(files) !== JSON.stringify(stage.files)) throw new Error('Motionscaper shell stage inventory or digest changed.');
	await auditDesktopFfmpegAbsence({ root, label: 'Motionscaper staged resources' });
	return stage;
}

export async function verifyMotionscaperPackagedResources(resourcesRoot, stage) {
	const asar = join(resourcesRoot, 'app.asar');
	const files = [];
	for (const entry of listPackage(asar)) {
		const path = entry.replace(/^\//u, '');
		const metadata = statFile(asar, path, false);
		if (metadata.files) continue;
		if (metadata.link || metadata.unpacked) throw new Error('Motionscaper app archive contains an unadmitted link or unpacked file.');
		const bytes = extractFile(asar, path);
		files.push({ path: `app/${path}`, byteLength: bytes.byteLength, sha256: digest(bytes) });
	}
	for (const tree of ['renderer', 'runtime']) {
		for (const path of await regularFiles(resourcesRoot, tree, tree === 'runtime')) {
			const bytes = await readFile(join(resourcesRoot, path));
			files.push({ path, byteLength: bytes.byteLength, sha256: digest(bytes) });
		}
	}
	files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
	if (JSON.stringify(files) !== JSON.stringify(stage.files)) throw new Error('Motionscaper packaged resources differ from the authenticated stage inventory.');
	await auditDesktopFfmpegAbsence({ root: resourcesRoot, label: 'Motionscaper packaged resources' });
}

async function regularFiles(root, directory, allowMissing = false) {
	const result = [];
	const metadata = await lstat(join(root, directory)).catch((error) => {
		if (allowMissing && error.code === 'ENOENT') return null;
		throw error;
	});
	if (!metadata) return result;
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Motionscaper package directory is not regular.');
	for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
		const path = `${directory}/${entry.name}`;
		if (entry.isDirectory()) result.push(...await regularFiles(root, path));
		else if (entry.isFile()) result.push(path);
		else throw new Error(`Motionscaper package entry ${path} is not regular.`);
	}
	return result;
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
