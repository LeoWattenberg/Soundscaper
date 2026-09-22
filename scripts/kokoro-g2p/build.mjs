#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Build the frozen multilingual G2P closure on its target package runner. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract, list } from 'tar';
import {
	describeDesktopKokoroG2pBundle,
	verifyDesktopKokoroG2pRuntime,
} from '../lib/desktop-kokoro-g2p-runtime.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PROJECT = resolve(ROOT, 'scripts/kokoro-g2p');
const HELPER = resolve(ROOT, 'desktop/assistance-kokoro-g2p-helper.py');
const DICTIONARY_URL = 'https://github.com/r9y9/open_jtalk/releases/download/v1.11.1/open_jtalk_dic_utf_8-1.11.tar.gz';
const DICTIONARY_SHA256 = 'fe6ba0e43542cef98339abdffd903e062008ea170b04e7e2a35da805902f382a';
const DICTIONARY_DIRECTORY = 'open_jtalk_dic_utf_8-1.11';
const MAXIMUM_DICTIONARY_BYTES = 32 * 1024 * 1024;
const COLLECTIONS = Object.freeze([
	'kokoro', 'misaki', 'spacy', 'en_core_web_sm', 'spacy_curated_transformers', 'curated_transformers',
	'espeakng_loader', 'phonemizer', 'pyopenjtalk', 'fugashi', 'unidic', 'unidic_lite', 'jieba',
	'pypinyin', 'pypinyin_dict', 'cn2an', 'num2words', 'language_tags',
]);
const HIDDEN_IMPORTS = Object.freeze([
	'misaki.en', 'misaki.espeak', 'misaki.ja', 'misaki.zh',
	'kokoro.pipeline', 'spacy.lang.en',
]);

export function kokoroG2pBuildPlan({ targetId, platform = process.platform, arch = process.arch }) {
	const host = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform;
	const allowed = new Set(['mac-arm64', 'linux-x64', 'linux-arm64', 'win-x64', 'win-arm64']);
	if (!allowed.has(targetId) || !targetId.startsWith(`${host}-`)
		|| (targetId !== `${host}-${arch}` && !(targetId === 'win-arm64' && arch === 'x64'))) {
		throw new Error(`Kokoro G2P requires its native package runner or Windows ARM64 x64 emulation: ${targetId}.`);
	}
	return {
		targetId,
		executable: platform === 'win32' ? 'kokoro-g2p.exe' : 'kokoro-g2p',
		pythonArchitecture: platform === 'win32' && targetId === 'win-arm64' ? 'x64' : arch,
	};
}

export async function buildKokoroG2pBundle({
	targetId,
	outputRoot = resolve(ROOT, '.native-build/assistance-runtimes/kokoro-g2p'),
	cacheRoot = resolve(ROOT, '.native-build/assistance-runtimes/kokoro-g2p-cache'),
	platform = process.platform,
	arch = process.arch,
	fetchImpl = globalThis.fetch,
}) {
	const plan = kokoroG2pBuildPlan({ targetId, platform, arch });
	if (typeof fetchImpl !== 'function') throw new TypeError('Kokoro G2P dictionary fetcher is invalid.');
	const lockBytes = await readFile(join(PROJECT, 'uv.lock'));
	const helperBytes = await readFile(HELPER);
	const noticeRegister = JSON.parse(await readFile(join(PROJECT, 'notices/sources.json'), 'utf8'));
	const recipeBytes = await Promise.all([
		fileURLToPath(import.meta.url), join(PROJECT, 'collect_notices.py'),
		join(PROJECT, 'hooks/hook-curated_transformers.py'), join(PROJECT, 'notices/sources.json'),
		join(PROJECT, 'pyproject.toml'),
		...noticeRegister.notices.map((notice) => join(PROJECT, 'notices', notice.path)),
	].map((path) => readFile(path)));
	const recipeSha256 = sha256(Buffer.concat(recipeBytes));
	await mkdir(cacheRoot, { recursive: true });
	await mkdir(outputRoot, { recursive: true });
	const destination = join(outputRoot, targetId);
	const inventoryPath = join(outputRoot, `${targetId}.manifest.json`);
	try {
		const manifest = JSON.parse(await readFile(inventoryPath, 'utf8'));
		const provenance = JSON.parse(await readFile(join(destination, 'build-provenance.json'), 'utf8'));
		if (provenance.targetId === targetId
			&& provenance.recipeSha256 === recipeSha256
			&& provenance.dependencyLock?.sha256 === sha256(lockBytes)
			&& provenance.entrypoint?.sha256 === sha256(helperBytes)
			&& provenance.dictionary?.sha256 === DICTIONARY_SHA256) {
			await verifyDesktopKokoroG2pRuntime({ manifest, targetId,
				runtimeRoot: outputRoot, targetRoot: destination });
			return { bundleRoot: destination, provenance, reused: true };
		}
	} catch { /* Missing or altered build cache is regenerated from pinned inputs. */ }
	const archive = join(cacheRoot, 'open_jtalk_dic_utf_8-1.11.tar.gz');
	if (!(await fileMatches(archive, DICTIONARY_SHA256))) {
		const response = await fetchImpl(DICTIONARY_URL);
		if (!response.ok || !response.body) throw new Error(`Open JTalk dictionary download failed: ${response.status}.`);
		const chunks = [];
		let total = 0;
		for await (const value of response.body) {
			const bytes = Buffer.from(value);
			total += bytes.byteLength;
			if (total > MAXIMUM_DICTIONARY_BYTES) throw new Error('Open JTalk dictionary exceeds its download limit.');
			chunks.push(bytes);
		}
		const body = Buffer.concat(chunks);
		if (sha256(body) !== DICTIONARY_SHA256) throw new Error('Open JTalk dictionary digest differs from its pin.');
		await writeFile(archive, body);
	}
	const work = await mkdtemp(join(outputRoot, '.build-'));
	try {
		await validateAndExtractDictionary(archive, work);
		const dictionaryRoot = join(work, DICTIONARY_DIRECTORY);
		const environment = {
			...process.env,
			UV_PROJECT_ENVIRONMENT: join(cacheRoot, 'venv', targetId),
			UV_PYTHON: targetId === 'win-arm64'
				? 'cpython-3.12-windows-x86_64-none' : '3.12',
			HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', PYTHONHASHSEED: '0',
			SOURCE_DATE_EPOCH: '1787225940', TZ: 'UTC',
		};
		await command('uv', ['sync', '--locked', '--no-dev'], PROJECT, environment);
		const delimiter = platform === 'win32' ? ';' : ':';
		const args = [
			'run', '--no-sync', 'pyinstaller', '--noconfirm', '--clean', '--onedir',
			'--name', 'kokoro-g2p', '--distpath', join(work, 'dist'),
			'--workpath', join(work, 'work'), '--specpath', join(work, 'spec'),
			'--additional-hooks-dir', join(PROJECT, 'hooks'),
			'--add-data', `${dictionaryRoot}${delimiter}pyopenjtalk/${DICTIONARY_DIRECTORY}`,
			...COLLECTIONS.flatMap((name) => ['--collect-all', name]),
			...HIDDEN_IMPORTS.flatMap((name) => ['--hidden-import', name]),
			HELPER,
		];
		await command('uv', args, PROJECT, environment);
		const built = join(work, 'dist', 'kokoro-g2p');
		const executable = join(built, plan.executable);
		if (!(await stat(executable)).isFile()) throw new Error('PyInstaller did not emit the Kokoro G2P executable.');
		const normalizedEmptyFiles = await normalizeKokoroG2pEmptyFiles(built);
		await materializeKokoroG2pSymlinks(built);
		await command('uv', ['run', '--no-sync', 'python', join(PROJECT, 'collect_notices.py'), built],
			PROJECT, environment);
		const noticeBytes = await readFile(join(built, 'python-license-inventory.json'));
		const upstreamNotices = await stageUpstreamNotices(built);
		const provenance = {
			schemaVersion: 1,
			targetId,
			recipeId: 'kokoro-g2p-pyinstaller-onedir-v1',
			recipeSha256,
			pythonArchitecture: plan.pythonArchitecture,
			dependencyLock: { path: 'scripts/kokoro-g2p/uv.lock', sha256: sha256(lockBytes) },
			entrypoint: { path: 'desktop/assistance-kokoro-g2p-helper.py', sha256: sha256(helperBytes) },
			dictionary: { url: DICTIONARY_URL, sha256: DICTIONARY_SHA256 },
			pythonLicenseInventory: { path: 'python-license-inventory.json', sha256: sha256(noticeBytes) },
			upstreamNotices: { path: 'licenses/upstream/sources.json', sha256: upstreamNotices.sha256,
				fileCount: upstreamNotices.fileCount },
			normalizedEmptyFiles,
		};
		await writeFile(join(built, 'build-provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`, { flag: 'wx' });
		await mkdir(dirname(destination), { recursive: true });
		await rm(destination, { recursive: true, force: true });
		await rename(built, destination);
		const inventory = await describeDesktopKokoroG2pBundle({ targetId, bundleRoot: destination });
		await writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
		return { bundleRoot: destination, provenance, reused: false };
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}

/** Preserve empty Python/package markers as one harmless newline for the desktop file gate. */
export async function normalizeKokoroG2pEmptyFiles(bundleRoot) {
	const normalized = [];
	async function visit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isSymbolicLink()) continue;
			if (entry.isDirectory()) {
				await visit(path);
				continue;
			}
			if (!entry.isFile()) throw new Error('Kokoro G2P bundle contains a special file.');
			if ((await lstat(path)).size !== 0) continue;
			const name = relative(bundleRoot, path).replaceAll('\\', '/');
			if (!name.endsWith('.py') && !name.endsWith('.pxd')
				&& !name.endsWith('/py.typed') && !name.endsWith('/REQUESTED')) {
				throw new Error(`Kokoro G2P bundle has an unexpected empty file: ${name}.`);
			}
			await writeFile(path, '\n');
			normalized.push(name);
		}
	}
	await visit(bundleRoot);
	normalized.sort((left, right) => left.localeCompare(right, 'en'));
	return { count: normalized.length, paths: normalized,
		originalSha256: sha256(Buffer.alloc(0)), normalizedSha256: sha256(Buffer.from('\n')) };
}

async function stageUpstreamNotices(bundleRoot) {
	const sourceRoot = join(PROJECT, 'notices');
	const bytes = await readFile(join(sourceRoot, 'sources.json'));
	const manifest = JSON.parse(bytes.toString('utf8'));
	if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.notices)
		|| manifest.notices.length !== 9) throw new Error('Kokoro G2P upstream notice register is invalid.');
	const seen = new Set();
	for (const notice of manifest.notices) {
		if (!/^[A-Za-z0-9.-]+$/u.test(notice.path) || seen.has(notice.path)
			|| !/^[a-f\d]{64}$/u.test(notice.sha256)
			|| !/^[a-f\d]{64}$/u.test(notice.sourceSha256)
			|| typeof notice.sourceUrl !== 'string'
			|| !notice.sourceUrl.startsWith('https://')
			|| !Number.isSafeInteger(notice.byteLength) || notice.byteLength < 1
			|| typeof notice.package !== 'string' || typeof notice.version !== 'string') {
			throw new Error('Kokoro G2P upstream notice identity is invalid.');
		}
		seen.add(notice.path);
		const body = await readFile(join(sourceRoot, notice.path));
		if (body.byteLength !== notice.byteLength || sha256(body) !== notice.sha256) {
			throw new Error(`Kokoro G2P upstream notice differs from its pin: ${notice.path}.`);
		}
		const target = join(bundleRoot, 'licenses/upstream', notice.path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, body, { flag: 'wx' });
	}
	await writeFile(join(bundleRoot, 'licenses/upstream/sources.json'), bytes, { flag: 'wx' });
	return { sha256: sha256(bytes), fileCount: seen.size };
}

/** PyInstaller onedir creates POSIX aliases; shipped closure has only regular files. */
export async function materializeKokoroG2pSymlinks(bundleRoot) {
	const root = await realpath(bundleRoot);
	const links = [];
	let expandedFiles = 0;
	let expandedBytes = 0;
	async function inspect(path, ancestors) {
		const real = await realpath(path);
		if (real !== root && !real.startsWith(`${root}${sep}`)) {
			throw new Error(`Kokoro G2P bundle symlink escapes its root: ${relative(root, path)}.`);
		}
		const metadata = await stat(path);
		if (metadata.isFile()) {
			expandedFiles += 1;
			expandedBytes += metadata.size;
			if (expandedFiles > 16_384 || expandedBytes > 4 * 1024 ** 3) {
				throw new Error('Materialized Kokoro G2P bundle exceeds its closure limits.');
			}
			return;
		}
		if (!metadata.isDirectory() || ancestors.has(real)) {
			throw new Error('Kokoro G2P bundle has a special file or directory link cycle.');
		}
		const next = new Set([...ancestors, real]);
		for (const name of await readdir(path)) await inspect(join(path, name), next);
	}
	async function collect(path) {
		for (const entry of await readdir(path, { withFileTypes: true })) {
			const child = join(path, entry.name);
			if (entry.isSymbolicLink()) links.push(child);
			else if (entry.isDirectory()) await collect(child);
		}
	}
	await inspect(root, new Set());
	await collect(root);
	for (const link of links) {
		const resolved = await realpath(link);
		const metadata = await lstat(resolved);
		const temporary = `${link}.materialized-${process.pid}`;
		await rm(temporary, { recursive: true, force: true });
		if (metadata.isDirectory()) await cp(resolved, temporary, { recursive: true, dereference: true });
		else if (metadata.isFile()) await copyFile(resolved, temporary);
		else throw new Error('Kokoro G2P bundle symlink resolves to a special file.');
		await rm(link, { recursive: true, force: true });
		await rename(temporary, link);
	}
	return { materializedLinks: links.length, fileCount: expandedFiles, byteLength: expandedBytes };
}

async function validateAndExtractDictionary(archive, work) {
	await list({ file: archive, strict: true, onentry(entry) {
		const components = entry.path.split('/').filter(Boolean);
		if (components[0] !== DICTIONARY_DIRECTORY
			|| components.some((part) => part === '.' || part === '..')
			|| entry.path.includes('\\') || !['File', 'Directory'].includes(entry.type)) {
			throw new Error('Open JTalk dictionary archive has an unexpected entry.');
		}
	} });
	await extract({ file: archive, cwd: work, strict: true, preservePaths: false });
}

async function fileMatches(path, expected) {
	try {
		const metadata = await stat(path);
		return metadata.isFile() && metadata.size <= MAXIMUM_DICTIONARY_BYTES
			&& sha256(await readFile(path)) === expected;
	} catch (error) {
		if (error.code === 'ENOENT') return false;
		throw error;
	}
}

function command(name, args, cwd, env) {
	return new Promise((resolveCommand, reject) => {
		const child = spawn(name, args, { cwd, env, stdio: 'inherit', shell: false });
		child.once('error', reject);
		child.once('close', (code) => code === 0
			? resolveCommand()
			: reject(new Error(`${name} ${args[0]} failed with exit code ${code}.`)));
	});
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const match = /^--target=(mac-arm64|linux-x64|linux-arm64|win-x64|win-arm64)$/u.exec(process.argv[2] ?? '');
	if (!match || process.argv.length !== 3) {
		console.error('Usage: node scripts/kokoro-g2p/build.mjs --target=<target-id>');
		process.exitCode = 2;
	} else {
		buildKokoroG2pBundle({ targetId: match[1] })
			.then(({ bundleRoot }) => console.log(`Built Kokoro G2P bundle: ${bundleRoot}`))
			.catch((error) => { console.error(error); process.exitCode = 1; });
	}
}
