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

/** NSIS displays this before Electron exists, while the large payload extracts. */
export async function generateDesktopNightlyTestsSplash({
	outputPath = resolve(ROOT, '.desktop-build/icons/nightly-tests-splash.bmp'),
} = {}) {
	const width = 600;
	const height = 220;
	const image = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="220">
		<rect width="600" height="220" fill="#11131a"/>
		<rect x="28" y="30" width="5" height="160" rx="2" fill="#8aa9ff"/>
		<g fill="#f4f5f8" font-family="sans-serif">
			<text x="50" y="58" font-size="18">Launcher started</text>
			<text x="50" y="100" font-size="28" font-weight="bold">Soundscaper Nightly Tests</text>
			<text x="50" y="142" font-size="19">Extracting the bundled test tools…</text>
			<text x="50" y="179" font-size="15" fill="#b7bdcc">Please wait. The test progress window opens next.</text>
		</g>
	</svg>`, { font: { loadSystemFonts: true } }).render();
	// The portable launcher accepts BMP, not PNG. Emit opaque bottom-up BGR
	// scanlines with the standard 54-byte header; the width is four-byte aligned.
	const stride = width * 3;
	const bitmap = Buffer.alloc(54 + stride * height);
	bitmap.write('BM', 0, 'ascii');
	bitmap.writeUInt32LE(bitmap.length, 2);
	bitmap.writeUInt32LE(54, 10);
	bitmap.writeUInt32LE(40, 14);
	bitmap.writeInt32LE(width, 18);
	bitmap.writeInt32LE(height, 22);
	bitmap.writeUInt16LE(1, 26);
	bitmap.writeUInt16LE(24, 28);
	bitmap.writeUInt32LE(stride * height, 34);
	const pixels = image.pixels;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const source = (y * width + x) * 4;
			const target = 54 + (height - 1 - y) * stride + x * 3;
			bitmap[target] = pixels[source + 2];
			bitmap[target + 1] = pixels[source + 1];
			bitmap[target + 2] = pixels[source];
		}
	}
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, bitmap);
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
