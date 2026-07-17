import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const patchDirectory = join(root, 'patches', 'components');
const patchFiles = readdirSync(patchDirectory)
	.filter((file) => file.endsWith('.patch'))
	.sort();

for (const file of patchFiles) {
	const patchPath = join(patchDirectory, file);
	const patch = readFileSync(patchPath, 'utf8');
	try {
		execFileSync('git', ['apply', '--check', '--unsafe-paths', '--whitespace=nowarn', patchPath], {
			cwd: root,
			input: patch,
			stdio: 'pipe',
		});
	} catch {
		try {
			execFileSync('git', ['apply', '--reverse', '--check', '--unsafe-paths', '--whitespace=nowarn', patchPath], {
				cwd: root,
				input: patch,
				stdio: 'pipe',
			});
			continue;
		} catch {
			execFileSync('git', ['apply', '--check', '--unsafe-paths', '--whitespace=nowarn', patchPath], {
				cwd: root,
				input: patch,
				stdio: ['pipe', 'inherit', 'inherit'],
			});
		}
	}
	execFileSync('git', ['apply', '--unsafe-paths', '--whitespace=nowarn', patchPath], {
		cwd: root,
		input: patch,
		stdio: ['pipe', 'inherit', 'inherit'],
	});
}
