/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { parseWildcardResponseHeaders } from '../../../scripts/lib/static-response-headers.mjs';
import { resolvePackagedProductExecutable } from '../../../scripts/lib/desktop-packaged-product-executable.mjs';
import { resolvePackagedResourcesPath } from '../../../scripts/lib/packaged-executable-resource-identity.mjs';
import {
	createDesktopExternalFfmpegVideoWorkload,
	normalizeDesktopVideoCodecOperationPlan,
} from '../../../desktop/desktop-video-codec-operation-contract.ts';

const executeFile = promisify(execFile);
const repository = resolve(import.meta.dirname, '../../..');
const renderers = new WeakMap();
const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
	'.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
	'.woff2': 'font/woff2', '.wasm': 'application/wasm' };

/** Exercise the Electron codec composition while retaining the browser suite's origin and CSP. */
export async function installOriginalOverwriteDesktopRenderer(page) {
	const supplied = process.env.SCAPE_BROWSER_DESKTOP_FRAMESCAPER_RENDERER;
	const payloadRoot = process.env.SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT;
	let packaged = null;
	if (!supplied && payloadRoot !== undefined) {
		if (!isAbsolute(payloadRoot)) throw new TypeError('SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT must be absolute.');
		const executable = resolvePackagedProductExecutable({ productRoot: join(payloadRoot, 'products'),
			productId: 'framescaper', platform: process.platform, arch: process.arch });
		packaged = join(resolvePackagedResourcesPath(executable, process.platform), 'renderer');
	}
	const directory = supplied || packaged || await mkdtemp(join(tmpdir(), 'framescaper-overwrite-renderer-'));
	const owned = !supplied && !packaged;
	if (owned) {
		try {
			await executeFile(process.execPath, ['node_modules/vite/bin/vite.js', 'build',
				'--outDir', directory, '--emptyOutDir'], {
				cwd: repository,
				env: { ...process.env, SCAPE_PRODUCT: 'framescaper', SCAPE_DESKTOP_CODEC_RUNTIME: 'main-process', SCAPE_BUILD_SOURCE_MAPS: '0' },
				maxBuffer: 16 * 1024 * 1024,
				timeout: 240_000,
			});
		} catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
	}
	const root = resolve(directory);
	let headers;
	try { headers = parseWildcardResponseHeaders(await readFile(join(root, '_headers'), 'utf8')); }
	catch (error) { if (owned) await rm(directory, { recursive: true, force: true }); throw error; }
	const handler = async (route) => {
		let pathname = new URL(route.request().url()).pathname;
		if (pathname.startsWith('/__e2e-overwrite/') || pathname === '/.offline-build-manifest.json') {
			await route.fallback(); return;
		}
		if (pathname === '/embed/en/' || pathname === '/en/') pathname = '/index.html';
		else if (pathname.endsWith('/')) pathname += 'index.html';
		const path = resolve(root, `.${decodeURIComponent(pathname)}`);
		if (!path.startsWith(`${root}${sep}`)) { await route.fallback(); return; }
		let body;
		try { body = await readFile(path); }
		catch (error) { if (error.code !== 'ENOENT') throw error; await route.fallback(); return; }
		const extension = path.slice(path.lastIndexOf('.'));
		await route.fulfill({ body, headers,
			contentType: contentTypes[extension] || 'application/octet-stream' });
	};
	renderers.set(page, { directory, handler, owned });
	try { await page.route('**/*', handler); }
	catch (error) {
		renderers.delete(page);
		if (owned) await rm(directory, { recursive: true, force: true });
		throw error;
	}
}

export async function releaseOriginalOverwriteDesktopRenderer(page) {
	const renderer = renderers.get(page);
	if (!renderer) return;
	renderers.delete(page);
	try { await page.unroute('**/*', renderer.handler); }
	finally { if (renderer.owned) await rm(renderer.directory, { recursive: true, force: true }); }
}

/** Bounded native video RPC fixture: encode the renderer's actual RGBA frames with the pinned core. */
export async function installPinnedOriginalOverwriteVideoCodec(page) {
	const operations = new Map();
	let ordinal = 0;
	await page.exposeFunction('__originalOverwriteVideoCodec', async (action, request) => {
		if (action === 'begin') {
			const plan = normalizeDesktopVideoCodecOperationPlan(request);
			const operationId = `desktop-video-${(++ordinal).toString(16).padStart(32, '0')}`;
			let closeInputs;
			const closed = new Promise((resolve) => { closeInputs = resolve; });
			operations.set(operationId, { plan, video: [], audio: [], closedRoles: new Set(), closed, closeInputs });
			return { operationId };
		}
		const operationId = typeof request === 'string' ? request : request.operationId;
		const operation = operations.get(operationId);
		if (action === 'cancel' || action === 'delete') return operations.delete(operationId);
		if (!operation) throw new Error('The native video operation is unavailable.');
		if (action === 'write') {
			const input = operation[request.role];
			const maximum = request.role === 'video' ? operation.plan.videoInputBytes : operation.plan.audioInputBytes;
			if (!Array.isArray(input) || operation.closedRoles.has(request.role) || request.offset !== input.length
				|| request.bytes.length > 1024 * 1024 || input.length + request.bytes.length > maximum) {
				throw new Error('The native video input write exceeds its admitted bounds.');
			}
			for (const byte of request.bytes) input.push(byte);
			return { offset: input.length };
		}
		if (action === 'close') {
			const input = operation[request.role];
			const expected = request.role === 'video' ? operation.plan.videoInputBytes : operation.plan.audioInputBytes;
			if (request.offset !== expected || input.length !== expected) throw new Error('The native video input is incomplete.');
			operation.closedRoles.add(request.role);
			if (operation.closedRoles.has('video') && (operation.plan.audioInputBytes === null || operation.closedRoles.has('audio'))) {
				operation.closeInputs();
			}
			return { offset: input.length };
		}
		if (action === 'execute') {
			await operation.closed;
			operation.output = await encodePinnedVideo(operation, ordinal);
			return { exitCode: 0 };
		}
		if (action === 'stat') return { byteLength: operation.output.byteLength };
		if (action === 'read') {
			if (request.maximumBytes > 1024 * 1024 || request.offset < 0) throw new Error('The native video output range is invalid.');
			return Array.from(operation.output.subarray(request.offset, request.offset + request.maximumBytes));
		}
		throw new Error('The native video action is unknown.');
	});
	await page.addInitScript(() => {
		const invoke = (action, request) => globalThis.__originalOverwriteVideoCodec(action, request);
		const plans = [];
		Object.defineProperty(globalThis, '__originalOverwriteVideoPlans', { value: plans });
		Object.defineProperty(globalThis, '__originalOverwriteVideoBridge', { value: Object.freeze({
			getDesktopVideoExportCapabilities: async () => ({ schemaVersion: 1, formats: {
				mp4: { available: true, provider: 'external-ffmpeg' },
				webm: { available: true, provider: 'external-ffmpeg' },
			} }),
			beginDesktopVideoCodecOperation: (plan) => { plans.push(structuredClone(plan)); return invoke('begin', plan); },
			writeDesktopVideoCodecInput: (request) => invoke('write', { ...request, bytes: Array.from(request.bytes) }),
			closeDesktopVideoCodecInput: (request) => invoke('close', request),
			executeDesktopVideoCodecOperation: (request) => invoke('execute', request),
			statDesktopVideoCodecOutput: (request) => invoke('stat', request),
			readDesktopVideoCodecOutput: async (request) => Uint8Array.from(await invoke('read', request)),
			deleteDesktopVideoCodecOperation: (request) => invoke('delete', request),
			cancelDesktopVideoCodecOperation: (operationId) => invoke('cancel', operationId),
		}) });
	});
}

let pinnedCore;
async function encodePinnedVideo(operation, ordinal) {
	const coreJavaScript = new URL('../../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', import.meta.url);
	const coreWasm = new URL('../../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', import.meta.url);
	pinnedCore ??= (async () => {
		globalThis.self ??= globalThis; globalThis.location ??= coreJavaScript;
		const [{ default: createCore }, wasmBinary] = await Promise.all([import(coreJavaScript.href), readFile(coreWasm)]);
		return createCore({ wasmBinary });
	})();
	const core = await pinnedCore;
	const video = `/overwrite-${ordinal}.rgba`, audio = `/overwrite-${ordinal}.wav`;
	const output = `/overwrite-${ordinal}.${operation.plan.format}`;
	const { ffmpegArguments } = createDesktopExternalFfmpegVideoWorkload(operation.plan, { outputPath: output });
	const arguments_ = ffmpegArguments.map((value) => value === 'pipe:3' ? video : value === 'pipe:4' ? audio : value);
	const logs = [];
	core.setLogger(({ message }) => { logs.push(message); if (logs.length > 50) logs.shift(); });
	try {
		core.FS.writeFile(video, Uint8Array.from(operation.video));
		if (operation.plan.audioInputBytes !== null) core.FS.writeFile(audio, Uint8Array.from(operation.audio));
		const exitCode = core.exec(...arguments_);
		if (exitCode !== 0) throw new Error(`Pinned native video encoding failed: ${logs.join('\n')}`);
		const bytes = core.FS.readFile(output).slice();
		if (bytes.byteLength > operation.plan.maximumOutputBytes) throw new Error('The native video output exceeds its admitted bound.');
		return bytes;
	} finally {
		core.setLogger(() => {});
		for (const path of [video, audio, output]) { try { core.FS.unlink(path); } catch {} }
	}
}
