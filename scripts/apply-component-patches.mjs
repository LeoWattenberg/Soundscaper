import { readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const patchDirectory = join(root, 'patches', 'components');
const allowedTargetDirectory = resolve(root, 'node_modules', '@dilsonspickles', 'components', 'dist');
const patchFiles = readdirSync(patchDirectory)
	.filter((file) => file.endsWith('.patch'))
	.sort();

function assertAllowedTarget(rawPath, patchFile, { allowDevNull = false } = {}) {
	if (allowDevNull && rawPath === '/dev/null') return;
	if (!rawPath || isAbsolute(rawPath) || rawPath.includes('\\') || /\s/.test(rawPath)) {
		throw new Error(`${patchFile}: unsupported patch target ${JSON.stringify(rawPath)}`);
	}
	if (!rawPath.startsWith('a/') && !rawPath.startsWith('b/')) {
		throw new Error(`${patchFile}: patch targets must use an a/ or b/ prefix`);
	}
	const target = resolve(root, rawPath.slice(2));
	if (!target.startsWith(`${allowedTargetDirectory}${sep}`)) {
		throw new Error(`${patchFile}: target escapes @dilsonspickles/components/dist: ${rawPath}`);
	}
}

export function validateComponentPatch(patch, patchFile = '<patch>') {
	let diffCount = 0;
	for (const line of patch.split(/\r?\n/u)) {
		if (/^(rename|copy) (from|to) |^(new file|deleted file|old|new) mode 120000$|^GIT binary patch$|^Binary files /.test(line)) {
			throw new Error(`${patchFile}: renames, copies, symlinks, and binary patches are not supported`);
		}
		if (line.startsWith('diff --git ')) {
			const match = /^diff --git (\S+) (\S+)$/.exec(line);
			if (!match) throw new Error(`${patchFile}: unsupported diff header`);
			assertAllowedTarget(match[1], patchFile);
			assertAllowedTarget(match[2], patchFile);
			diffCount += 1;
		} else if (line.startsWith('--- ') || line.startsWith('+++ ')) {
			assertAllowedTarget(line.slice(4), patchFile, { allowDevNull: true });
		}
	}
	if (diffCount === 0) throw new Error(`${patchFile}: patch contains no file changes`);
}

export function applyComponentPatches() {
	for (const file of patchFiles) {
		const patchPath = join(patchDirectory, file);
		const patch = readFileSync(patchPath, 'utf8');
		validateComponentPatch(patch, file);
		try {
			execFileSync('git', ['apply', '--check', '--whitespace=nowarn', patchPath], {
				cwd: root,
				stdio: 'pipe',
			});
		} catch {
			try {
				execFileSync('git', ['apply', '--reverse', '--check', '--whitespace=nowarn', patchPath], {
					cwd: root,
					stdio: 'pipe',
				});
				continue;
			} catch {
				execFileSync('git', ['apply', '--check', '--whitespace=nowarn', patchPath], {
					cwd: root,
					stdio: ['pipe', 'inherit', 'inherit'],
				});
			}
		}
		execFileSync('git', ['apply', '--whitespace=nowarn', patchPath], {
			cwd: root,
			stdio: ['pipe', 'inherit', 'inherit'],
		});
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) applyComponentPatches();
