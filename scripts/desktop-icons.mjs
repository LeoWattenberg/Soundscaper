#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Resvg } from '@resvg/resvg-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SOURCE = resolve(ROOT, 'public/logo/logo-klein-schwarz.svg');
const DEFAULT_OUTPUT = resolve(ROOT, '.desktop-build/icons/icon.png');

export async function generateDesktopIcon({
	sourcePath = DEFAULT_SOURCE,
	outputPath = DEFAULT_OUTPUT,
} = {}) {
	const source = await readFile(sourcePath, 'utf8');
	const rootTag = source.match(/<svg\b[^>]*>/u)?.[0];
	const viewBox = rootTag?.match(/\bviewBox="([^"]+)"/u)?.[1]
		?.trim().split(/\s+/u).map(Number);
	if (!rootTag || viewBox?.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) {
		throw new Error(`Desktop icon source has no finite SVG viewBox: ${sourcePath}`);
	}

	const [x, y, width, height] = viewBox;
	const side = Math.max(width, height);
	const squareViewBox = [
		x - ((side - width) / 2),
		y - ((side - height) / 2),
		side,
		side,
	].join(' ');
	let squareSource = source.replace(/<text\b[\s\S]*?<\/text>/gu, '');
	const squareRoot = rootTag
		.replace(/\bwidth="[^"]*"/u, 'width="1024"')
		.replace(/\bheight="[^"]*"/u, 'height="1024"')
		.replace(/\bviewBox="[^"]*"/u, `viewBox="${squareViewBox}"`);
	squareSource = squareSource.replace(rootTag, squareRoot);

	// The wordmark uses a system font in the historical SVG. The desktop icon
	// deliberately uses only its existing vector marks so raster output is
	// independent of host fonts and identical on every packaging runner.
	const rendered = new Resvg(squareSource, {
		fitTo: { mode: 'width', value: 1024 },
		font: { loadSystemFonts: false },
	}).render();
	if (rendered.width !== 1024 || rendered.height !== 1024) {
		throw new Error(`Desktop icon raster is ${rendered.width}x${rendered.height}; expected 1024x1024.`);
	}
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, rendered.asPng());
	return outputPath;
}

function isMainModule() {
	return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
	generateDesktopIcon().then((outputPath) => {
		console.log(`Generated desktop icon: ${outputPath}`);
	}).catch((error) => {
		console.error(`Desktop icon generation failed: ${error.message}`);
		process.exitCode = 1;
	});
}
