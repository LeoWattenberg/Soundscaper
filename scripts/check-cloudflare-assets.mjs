#!/usr/bin/env node
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve('dist');
const maximumBytes = 25 * 1024 * 1024;
const oversized = walk(root).filter((path) => statSync(path).size > maximumBytes);
if (oversized.length) {
	throw new Error(`Cloudflare Pages rejects assets above 25 MiB:\n${oversized.map((path) => `${relative(root, path)} (${statSync(path).size} bytes)`).join('\n')}`);
}

function walk(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? walk(path) : [path];
	});
}
