/* SPDX-License-Identifier: AGPL-3.0-only */

export const LINT_SHARD_IDS = Object.freeze([
	'source-common-1',
	'source-common-2',
	'source-products',
	'tests-1',
	'tests-2',
	'tests-3',
	'desktop',
	'tooling',
]);

const LINT_FILE_PATTERN = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const IGNORED_SEGMENTS = new Set(['.astro', 'dist', 'node_modules']);
const IGNORED_ROOTS = new Set([
	'.desktop-build',
	'.wrangler',
	'coverage',
	'playwright-report',
	'release',
	'test-results',
	'vendor',
]);

export function isLintableRepositoryPath(file) {
	const path = normalizeRepositoryPath(file);
	if (path === null || !LINT_FILE_PATTERN.test(path)) return false;

	const segments = path.split('/');
	if (IGNORED_ROOTS.has(segments[0]) || segments.some((segment) => IGNORED_SEGMENTS.has(segment))) {
		return false;
	}
	if (segments[0] === '.claude' && segments[1] === 'worktrees') return false;
	return !/^src\/common\/editor\/(?:.*\/)?native\//u.test(path);
}

export function classifyLintFile(file) {
	const path = normalizeRepositoryPath(file);
	if (path === null || !isLintableRepositoryPath(path)) {
		throw new Error(`Cannot classify non-lintable repository path "${file}".`);
	}
	if (path.startsWith('src/common/')) return `source-common-${stableBucket(path, 2) + 1}`;
	if (path.startsWith('src/')) return 'source-products';
	if (path.startsWith('tests/')) return `tests-${stableBucket(path, 3) + 1}`;
	if (path.startsWith('desktop/')) return 'desktop';
	return 'tooling';
}

export function partitionLintFiles(files) {
	const shards = new Map(LINT_SHARD_IDS.map((shard) => [shard, []]));
	for (const file of [...new Set(files.filter(isLintableRepositoryPath))].sort()) {
		shards.get(classifyLintFile(file)).push(file);
	}
	return shards;
}

export function selectChangedLintFiles(changedTrackedFiles, untrackedFiles) {
	return [...new Set([...changedTrackedFiles, ...untrackedFiles].filter(isLintableRepositoryPath))].sort();
}

export function parseLintSelection(argv) {
	let changed = false;
	let shard = null;
	for (const argument of argv) {
		if (argument === '--changed') {
			changed = true;
			continue;
		}
		const shardMatch = /^--shard=(.+)$/u.exec(argument);
		if (shardMatch === null) throw new Error(`Unknown lint selection argument "${argument}".`);
		shard = shardMatch[1];
		if (!LINT_SHARD_IDS.includes(shard)) {
			throw new Error(`Unknown lint shard "${shard}"; expected one of ${LINT_SHARD_IDS.join(', ')}.`);
		}
	}
	if (changed && shard !== null) throw new Error('--changed cannot be combined with --shard.');
	return { changed, shard };
}

function normalizeRepositoryPath(file) {
	if (typeof file !== 'string') return null;
	const path = file.replaceAll('\\', '/').replace(/^\.\//u, '');
	if (path.length === 0 || path.startsWith('/') || path === '..' || path.startsWith('../')) return null;
	return path;
}

function stableBucket(path, bucketCount) {
	let hash = 2_166_136_261;
	for (const character of path) {
		hash ^= character.codePointAt(0);
		hash = Math.imul(hash, 16_777_619);
	}
	return (hash >>> 0) % bucketCount;
}
