import { extname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function extractAup4Paths(argv, workingDirectory = process.cwd()) {
	const paths = [];
	for (const argument of Array.isArray(argv) ? argv : []) {
		if (typeof argument !== 'string' || argument.startsWith('-')) continue;
		let candidate = argument;
		if (candidate.startsWith('file://')) {
			try {
				candidate = fileURLToPath(candidate);
			} catch {
				continue;
			}
		}
		if (extname(candidate).toLowerCase() !== '.aup4') continue;
		const absolutePath = isAbsolute(candidate) ? candidate : resolve(workingDirectory, candidate);
		if (!paths.includes(absolutePath)) paths.push(absolutePath);
	}
	return paths;
}
