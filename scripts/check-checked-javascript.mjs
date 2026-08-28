#!/usr/bin/env node

import { extname, relative, resolve, sep } from 'node:path';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';

const root = resolve(import.meta.dirname, '..');
const projectPath = resolve(root, 'tsconfig.javascript.json');
const project = JSON.parse(readFileSync(projectPath, 'utf8'));
const checkedExtensions = new Set(['.cjs', '.js', '.jsx', '.mjs']);
const checkedRoots = ['desktop', 'src'];
const directive = '// @ts-check\n';
const findings = [];

if (project.extends !== './tsconfig.base.json'
	|| project.compilerOptions?.allowJs !== true
	|| project.compilerOptions?.checkJs !== false
	|| !Array.isArray(project.files)
	|| project.files.length === 0) {
	findings.push('tsconfig.javascript.json must be a non-empty, per-file strict project extending tsconfig.base.json.');
}

const files = Array.isArray(project.files) ? project.files : [];
const sortedFiles = [...files].sort();
if (new Set(files).size !== files.length || files.some((path, index) => path !== sortedFiles[index])) {
	findings.push('tsconfig.javascript.json files must be unique and sorted.');
}

const enrolled = new Set();
for (const repositoryPath of files) {
	if (typeof repositoryPath !== 'string'
		|| (!repositoryPath.startsWith('desktop/') && !repositoryPath.startsWith('src/'))
		|| !checkedExtensions.has(extname(repositoryPath))) {
		findings.push(`${String(repositoryPath)}: strict JavaScript entries must be production JS-family files.`);
		continue;
	}
	const path = resolve(root, repositoryPath);
	if (relative(root, path).startsWith(`..${sep}`)) {
		findings.push(`${repositoryPath}: strict JavaScript entries cannot escape the repository.`);
		continue;
	}
	enrolled.add(repositoryPath);
	try {
		if (!lstatSync(path).isFile()) throw new Error('not a regular file');
		if (!readFileSync(path, 'utf8').startsWith(directive)) {
			findings.push(`${repositoryPath}: missing leading ${directive.trim()} directive.`);
		}
	} catch (error) {
		findings.push(`${repositoryPath}: cannot read enrolled source (${String(error)}).`);
	}
}

for (const path of checkedRoots.flatMap((directory) => walk(resolve(root, directory)))) {
	if (!readFileSync(path, 'utf8').startsWith(directive)) continue;
	const repositoryPath = relative(root, path).split(sep).join('/');
	if (!enrolled.has(repositoryPath)) {
		findings.push(`${repositoryPath}: ${directive.trim()} source is missing from tsconfig.javascript.json.`);
	}
}

if (findings.length) throw new Error(`Checked JavaScript gate failed:\n${findings.join('\n')}`);
console.log(`Checked ${String(files.length)} strict JavaScript runtime boundaries.`);

function walk(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) return walk(path);
		return entry.isFile() && checkedExtensions.has(extname(entry.name)) ? [path] : [];
	});
}
