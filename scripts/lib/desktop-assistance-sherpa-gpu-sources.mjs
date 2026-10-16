/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { extract } from 'tar';

export function verifySherpaGpuSource(bytes, source) {
	if (bytes.byteLength !== source.byteLength) throw new Error(`Sherpa ${source.id} source length is invalid.`);
	if (hash(bytes) !== source.sha256) throw new Error(`Sherpa ${source.id} source digest is invalid.`);
	if (source.integrity && `sha512-${createHash('sha512').update(bytes).digest('base64')}` !== source.integrity) {
		throw new Error(`Sherpa ${source.id} source integrity is invalid.`);
	}
	return bytes;
}

export function validateSherpaGpuSourceEntry({ path, type }) {
	const parts = path.replace(/\/$/u, '').split('/');
	if (!['File', 'Directory'].includes(type) || parts.some((part) => !part || part === '.' || part === '..')
		|| path.includes('\\') || /^[A-Za-z]:/u.test(path)) throw new Error('The Sherpa source archive entry is unsafe.');
}

export async function prepareSherpaGpuSources({ recipe, cacheRoot, work, targetId, fetchImpl }) {
	const roots = {}, downloads = {}, sourceRoot = join(work, 'sources');
	await mkdir(sourceRoot, { recursive: true });
	for (const source of recipe.sources) {
		if (source.id === 'node-arm64-lib' && targetId !== 'win-arm64'
			|| source.id === 'node-x64-lib' && targetId !== 'win-x64'
			|| source.id === 'node-delay-hook' && !targetId.startsWith('win-')) continue;
		const archive = await authenticatedSource(source, cacheRoot, fetchImpl);
		downloads[source.id] = archive;
		if (!source.root) continue;
		const root = join(sourceRoot, source.id);
		await mkdir(root);
		let total = 0, count = 0;
		await extract({ file: archive, cwd: root, strip: 1, strict: true, preservePaths: false,
			filter(path, entry) {
				const relative = path.split('/').slice(1).join('/');
				if (source.id === 'sherpa-source' && !sherpaFile(relative)
					|| source.id === 'node-headers' && !relative.startsWith('include/node/')) return false;
				validateSherpaGpuSourceEntry({ path, type: entry.type });
				if (path.split('/')[0] !== source.root) throw new Error('The Sherpa source archive root is invalid.');
				total += entry.size; count += 1;
				if (total > 256 * 1024 * 1024 || count > 30_000) throw new Error('The Sherpa source archive exceeds its extraction bounds.');
				return entry.type === 'File';
			},
		});
		roots[source.id] = root;
	}
	return { roots, downloads };
}

export async function patchSherpaGpuSources(root, recipe) {
	for (const [path, sha256] of Object.entries(recipe.patchSourceFiles)) {
		const source = await readFile(join(root, path), 'utf8');
		if (hash(Buffer.from(source)) !== sha256) throw new Error(`The reviewed Sherpa patch source ${path} has changed.`);
		let patched;
		if (path.endsWith('/provider.h')) patched = source.replace('  kCPU = 0,', '  kWebGPU = 8,  // WebGpuExecutionProvider\n  kCPU = 0,');
		else if (path.endsWith('/provider.cc')) patched = source.replace('  if (s == "cpu") {', '  if (s == "webgpu") {\n    return Provider::kWebGPU;\n  } else if (s == "cpu") {');
		else if (path.endsWith('/session.cc')) {
			patched = source.replace(/#if defined\(__APPLE__\) && \(ORT_API_VERSION >= 15\) && \\\n {4}!defined\(SHERPA_ONNX_DISABLE_COREML\)\n#include "coreml_provider_factory.h" {2}\/\/ NOLINT\n#endif/u, '');
			patched = patched.replace('namespace sherpa_onnx {', 'namespace sherpa_onnx {\nvoid ScapeAppendWebGpuProvider(Ort::SessionOptions &options);');
			patched = patched.replace('    case Provider::kCPU:', '    case Provider::kWebGPU:\n      ScapeAppendWebGpuProvider(sess_opts);\n      break;\n    case Provider::kCPU:');
			const start = patched.indexOf('    case Provider::kCoreML: {');
			const end = patched.indexOf('    case Provider::kNNAPI: {', start);
			if (start < 0 || end < 0) throw new Error('The Sherpa CoreML provider patch anchor is missing.');
			patched = `${patched.slice(0, start)}    case Provider::kCoreML: {\n      sess_opts.AppendExecutionProvider("CoreML", {{"MLComputeUnits", "ALL"}});\n      break;\n    }\n${patched.slice(end)}`;
		} else patched = `# Authenticated local ORT closure; no upstream fallback downloads.\nadd_library(onnxruntime SHARED IMPORTED GLOBAL)\nset_target_properties(onnxruntime PROPERTIES IMPORTED_LOCATION "\${ORT_LIBRARY}" INTERFACE_INCLUDE_DIRECTORIES "\${ORT_INCLUDE}")\nif(WIN32)\n  set_target_properties(onnxruntime PROPERTIES IMPORTED_IMPLIB "\${ORT_IMPLIB}")\nendif()\ninclude_directories("\${ORT_INCLUDE}")\n`;
		if (patched === source) throw new Error(`The Sherpa provider patch ${path} did not apply.`);
		await writeFile(join(root, path), patched);
	}
}

export async function sherpaGpuSourceNotices(roots, downloads) {
	const licenses = {
		'sherpa-source': ['LICENSE'], 'kaldi-native-fbank': ['LICENSE'], 'kaldi-decoder': ['LICENSE'],
		kaldifst: ['LICENSE'], openfst: ['COPYING'], kissfft: ['COPYING'],
		eigen: ['COPYING.MPL2', 'COPYING.BSD', 'COPYING.APACHE', 'COPYING.MINPACK'],
		'simple-sentencepiece': ['LICENSE'], json: ['LICENSE.MIT'], 'hclust-cpp': ['LICENSE'],
		'node-addon-api': ['LICENSE.md'],
	};
	const sections = [];
	for (const [id, names] of Object.entries(licenses)) {
		for (const name of names) sections.push(`===== ${id}/${name} =====\n${await readFile(join(roots[id], name), 'utf8')}`);
	}
	for (const id of ['node-gyp-license', 'node-license']) sections.push(`===== ${id} =====\n${await readFile(downloads[id], 'utf8')}`);
	return `${sections.join('\n\n')}\n`;
}

async function authenticatedSource(source, cacheRoot, fetchImpl) {
	const cache = join(cacheRoot, 'sherpa-gpu-sources');
	await mkdir(cache, { recursive: true });
	const path = join(cache, source.sha256);
	try {
		const stat = await lstat(path);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== source.byteLength) throw new Error('Sherpa cached source length or type is invalid.');
		verifySherpaGpuSource(await readFile(path), source);
		return path;
	} catch (error) { if (error.code !== 'ENOENT') throw error; }
	let response;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		response = await fetchImpl(source.url, {
			headers: { 'User-Agent': 'Soundscaper-runtime-builder', Accept: 'application/octet-stream, */*' },
			signal: AbortSignal.timeout(120_000),
		});
		// GitLab sometimes rejects a public archive request with HTTP 406.
		// Retry only transient HTTP failures; integrity failures remain terminal.
		if (![406, 429, 502, 503, 504].includes(response.status) || attempt === 2) break;
		await response.body?.cancel();
		await setTimeout(500 * (attempt + 1));
	}
	if (!response.ok || !response.body) throw new Error(`Sherpa source download failed: ${source.id} (${response.status}).`);
	const chunks = []; let length = 0;
	for await (const chunk of response.body) {
		length += chunk.byteLength;
		if (length > source.byteLength) throw new Error(`Sherpa ${source.id} source length is invalid.`);
		chunks.push(chunk);
	}
	const bytes = verifySherpaGpuSource(Buffer.concat(chunks), source);
	const temporary = join(dirname(path), `.download-${randomUUID()}`);
	try {
		await writeFile(temporary, bytes, { flag: 'wx', mode: 0o400 });
		await rename(temporary, path);
	} finally { await rm(temporary, { force: true }); }
	return path;
}

function sherpaFile(path) {
	return path === 'CMakeLists.txt' || path === 'LICENSE' || path === 'sherpa-onnx/CMakeLists.txt'
		|| path.startsWith('cmake/') || path.startsWith('sherpa-onnx/csrc/') || path.startsWith('sherpa-onnx/c-api/')
		|| /^harmony-os\/SherpaOnnxHar\/sherpa_onnx\/src\/main\/cpp\/[^/]+$/u.test(path);
}

export function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
