/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import { BROWSER_EXPORT_BLOB_MAXIMUM_BYTES } from '../src/common/editor/browser-export-output.ts';
import { SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES } from '../src/common/editor/scape-export-estimate.ts';

const inventoryUrl = new URL('../config/milestone-2-closure.json', import.meta.url);
const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

const ROUTE_CONTROL = Object.freeze({
	'scape-browser-blob': 'bounded-direct-archive-publication',
	'scape-file-system-access': 'bounded-direct-archive-publication',
	'scape-electron': 'bounded-direct-archive-publication',
	'audio-mix-browser-blob': 'bounded-browser-export-blob-publication',
	'audio-mix-direct-native-pcm': 'exact-direct-pcm-mix-save',
	'audio-mix-direct-compressed-realtime': 'exact-direct-compressed-mix-save',
	'audio-mix-direct-compressed-offline': 'exact-direct-compressed-mix-save',
	'audio-stems-browser-blob': 'bounded-browser-export-blob-publication',
	'audio-stems-direct-native-pcm-zip': 'direct-stem-archive-save',
	'audio-stems-direct-native-pcm-7z': 'direct-stem-archive-save',
	'audio-stems-direct-compressed-zip-realtime': 'direct-stem-archive-save',
	'audio-stems-direct-compressed-zip-offline': 'direct-stem-archive-save',
	'video-browser-blob': 'bounded-browser-export-blob-publication',
	'video-direct-mp4': 'exact-direct-mp4-webm-video-save',
	'video-direct-webm': 'exact-direct-mp4-webm-video-save',
} as const);

const BROWSER_BLOB_ROUTES = Object.freeze([
	'scape-browser-blob',
	'audio-mix-browser-blob',
	'audio-stems-browser-blob',
	'video-browser-blob',
]);

interface RouteRecord {
	readonly controlId: string;
	readonly finalRendererBlob: boolean;
	readonly id: string;
	readonly maximumBytes?: number;
	readonly publicationMode: 'browser-blob' | 'direct-stream';
}

test('milestone 2 qualifies one exact unique publication-route register', async () => {
	const [inventory, matrix] = await Promise.all([
		readFile(inventoryUrl, 'utf8').then(JSON.parse),
		readFile(matrixUrl, 'utf8').then(JSON.parse),
	]);
	const item = inventory.items.find(({ id }: { id: string }) => id === 'm2-pipeline-route-qualification');
	const routeIds = item.routeIds as string[];
	const qualification = matrix.publicationRouteQualification as Readonly<{
		browserBlobMaximumBytes: number;
		routes: RouteRecord[];
		status: string;
	}>;

	assert.equal(item.status, 'implemented');
	assert.equal(new Set(routeIds).size, routeIds.length, 'route IDs must be unique');
	assert.deepEqual([...routeIds].sort(), Object.keys(ROUTE_CONTROL).sort());
	assert.equal(qualification.status, 'implemented');
	assert.equal(qualification.browserBlobMaximumBytes, 512 * 1024 * 1024);
	assert.equal(qualification.browserBlobMaximumBytes, BROWSER_EXPORT_BLOB_MAXIMUM_BYTES);
	assert.equal(qualification.browserBlobMaximumBytes, SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES);
	assert.deepEqual(qualification.routes.map(({ id }) => id), routeIds);
});

test('every browser route has one frozen Blob limit and every direct route excludes a final renderer Blob', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const controls = new Map<string, Readonly<{ evidence: Array<{ kind: string; path: string }> }>>();
	for (const risk of matrix.risks) {
		for (const control of risk.currentControls) controls.set(control.id, control);
	}
	for (const route of matrix.publicationRouteQualification.routes as RouteRecord[]) {
		assert.equal(route.controlId, ROUTE_CONTROL[route.id as keyof typeof ROUTE_CONTROL]);
		const control = controls.get(route.controlId);
		assert.ok(control, `${route.id} references an unknown control`);
		assert.ok(control.evidence.some(({ kind }) => kind === 'implementation'));
		assert.ok(control.evidence.some(({ kind }) => kind === 'test'));
		for (const { path } of control.evidence) {
			await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)));
		}
		if (BROWSER_BLOB_ROUTES.includes(route.id)) {
			assert.equal(route.publicationMode, 'browser-blob');
			assert.equal(route.finalRendererBlob, true);
			assert.equal(route.maximumBytes, BROWSER_EXPORT_BLOB_MAXIMUM_BYTES);
		} else {
			assert.equal(route.publicationMode, 'direct-stream');
			assert.equal(route.finalRendererBlob, false);
			assert.equal(route.maximumBytes, undefined);
		}
	}
});

test('browser audio and video publication use the shared admission boundary', async () => {
	const [audio, video, ffmpegVideo] = await Promise.all([
		readFile(new URL('../src/common/editor/controller/export-service.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/controller/video-export-service.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ffmpeg-video-output.ts', import.meta.url), 'utf8'),
	]);
	assert.match(audio, /prepareBrowserExportBlob/u);
	assert.match(audio, /admitBrowserExportBlob/u);
	assert.match(video, /prepareBrowserExportBlob/u);
	assert.match(ffmpegVideo, /readBoundedFfmpegOutputFile/u);
	assert.doesNotMatch(audio, /new Blob\(\[encoded\.bytes\]/u);
	assert.doesNotMatch(video, /new Blob\(\[encoded\.bytes\]/u);
});

test('dormant keyed V7 export reuses the frozen video Blob and direct route IDs', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const videoRoutes = matrix.publicationRouteQualification.routes
		.filter(({ id }: RouteRecord) => id.startsWith('video-')) as RouteRecord[];

	assert.deepEqual(videoRoutes.map(({ id }) => id), [
		'video-browser-blob',
		'video-direct-mp4',
		'video-direct-webm',
	]);
	assert.equal(matrix.publicationRouteQualification.routes.length, 15);
	const keyedControl = matrix.risks
		.flatMap(({ currentControls }: { currentControls: Array<{ id: string }> }) => currentControls)
		.find(({ id }: { id: string }) => id === 'exact-v20-keyed-export-authority');
	assert.ok(keyedControl, 'the dormant keyed strategy must have separate authority evidence');
});

test('the threat model owns the route-level claim without promoting resource qualification', async () => {
	const documentation = await readFile(
		new URL('../docs/production-threat-model.md', import.meta.url),
		'utf8',
	);
	for (const routeId of Object.keys(ROUTE_CONTROL)) {
		assert.match(documentation, new RegExp(`\\b${routeId}\\b`, 'u'));
	}
	assert.match(
		documentation,
		/four retained\s+browser-Blob fallbacks.*non-raiseable 512 MiB.*stat and admit.*before a whole-file `readFile`.*before final Blob construction.*before download publication/isu,
	);
	assert.match(
		documentation,
		/other eleven IDs.*direct streaming routes.*None performs final renderer-sized.*Blob construction or download publication/isu,
	);
	assert.match(
		documentation,
		/does not add browser\s+heap.*worker MEMFS.*RSS.*reference-scale.*durability.*packaged.*cross-platform claims/isu,
	);
});
