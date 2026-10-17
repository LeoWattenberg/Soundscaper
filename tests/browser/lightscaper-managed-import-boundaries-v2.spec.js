/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { installNativeOpfsWorkerCompanion, assertNativeOpfsWorkerExecution } from './helpers/native-opfs-worker-companion.ts';

const ROOT = '/__current_managed_import_boundaries_v2__';
const PRIOR = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQlNf/DwACAwFflwzAewAAAABJRU5ErkJggg==', 'base64');
const CURRENT = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAHElEQVR4nGP4z8DwHwyB9P/qV7pAuuF//X+gCACcuAyINRgO7QAAAABJRU5ErkJggg==', 'base64');
const CUBE = Buffer.from('LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n');
// Literal durable states are independent of the import implementation and the
// native observer. An unpublished immutable body may remain; recovery retires
// the import journal/provisional custody without deleting an original body.
const CUTS = [
	['intent', 'before', false, false, false, false, false],
	['intent', 'after', false, false, false, false, true],
	['original', 'before', false, false, false, false, true],
	['original', 'after', true, false, false, false, true],
	['stage', 'before', true, false, false, false, true],
	['stage', 'after', true, false, true, false, true],
	['publish', 'before', true, false, true, false, true],
	['publish', 'after', true, true, true, false, true],
	['promote', 'before', true, true, true, false, true],
	['promote', 'after', true, true, false, true, true],
	['retire', 'before', true, true, false, true, true],
	['retire', 'after', true, true, false, true, false],
];

for (const [phase, when, body, photo, staged, retained, journal] of CUTS) {
	test(`current native import ${phase} ${when} joins interruption and recovers exact mixed originals`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Full WebKit catalog Blob/OPFS custody qualification remains deferred.');
		const result = await scenario(page, phase, when);
		expect(result.enteredCount).toBe(1); expect(result.joinedWhileHeld).toBe(true); expect(result.reasonReflections).toBe(0);
		const receipt = { index: 0, photoId: 'current-photo', status: 'imported', reusedOriginal: false, message: null };
		expect(result.seeded).toEqual([{ ...receipt, photoId: 'prior-photo' }]);
		expect(result.publicationsWhileHeld).toEqual(['promote', 'retire'].includes(phase) ? [receipt] : []);
		expect(result.publications).toEqual(photo ? [receipt] : []);
		expect(result.outcome).toEqual(phase === 'retire' && when === 'after'
			? { status: 'fulfilled', receipts: [receipt], sameReason: false }
			: { status: 'rejected', receipts: [], sameReason: true });
		assertInputs(result.inputs);
		assertState(result.before, { body: false, photo: false, staged: false, retained: false, journal: false });
		const interrupted = { body, photo, staged, retained, journal };
		assertState(result.held, interrupted); expect(result.released).toEqual(result.held); expect(result.reopened).toEqual(result.held);
		assertState(result.recovered, { body, photo, staged: false, retained: photo, journal: false });
		expect(result.recoveredAgain).toEqual(result.recovered);
		const baselineToken = result.before.originals[0].row.mediaContentToken;
		for (const snapshot of [result.held, result.released, result.reopened, result.recovered, result.recoveredAgain]) {
			expect(snapshot.originals[0].row.mediaContentToken).toBe(baselineToken);
			if (body) expect(snapshot.originals[1].row.mediaContentToken).toBe(result.held.originals[1].row.mediaContentToken);
		}

		function assertState(actual, state) {
			expect(actual.root).toEqual({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: result.catalogId,
				name: 'Native current import boundaries', revision: state.photo ? 2 : 1, photoCount: state.photo ? 2 : 1,
				folders: [], keywords: [], collections: [] });
			expect(actual.photos).toEqual([result.inputs.prior, state.photo ? result.inputs.current : null]);
			expect(actual.catalogCounts).toEqual({ photos: state.photo ? 2 : 1, summaries: state.photo ? 2 : 1, photoQueryRowsV2: state.photo ? 2 : 1 });
			expect(actual.mediaCounts).toEqual({ mediaAssets: state.body ? 2 : 1, mediaAssetStaging: 1 });
			expect(actual.mediaStagingRows).toEqual([{ key: 'state', kind: 'state', generation: 'initial' }]);
			expect(actual.mediaStagingRows.filter(row => row.kind !== 'state')).toHaveLength(0);
			expect(actual.intent).toEqual(state.journal ? { schemaVersion: 1, kind: 'photo-import', catalogId: result.catalogId, importId: result.importId } : null);
			expect(actual.lut).toEqual({ bytes: [...CUBE], actualSha256: sha(CUBE) });
			assertOriginal(actual.originals[0], PRIOR, 'prior', true, 1);
			assertOriginal(actual.originals[1], CURRENT, 'current', state.body, Number(state.staged || state.retained));
			expect(actual.retained.map(row => row.photoId).sort()).toEqual(['prior-photo', ...(state.retained ? ['current-photo'] : [])].sort());
			expect(actual.staged.map(row => row.photoId)).toEqual(state.staged ? ['current-photo'] : []);
			for (const row of [...actual.retained, ...actual.staged]) {
				const prefix = row.photoId === 'prior-photo' ? 'prior' : 'current', source = prefix === 'prior' ? PRIOR : CURRENT;
				const importId = row.photoId === 'current-photo' && state.staged ? result.importId : null;
				const original = actual.originals.find(item => item.key === `${prefix}-original`);
				expect(row).toEqual({ schemaVersion: 1, photoId: `${prefix}-photo`, assetId: `${prefix}-original`, sourceId: `${prefix}-source`,
					sha256: sha(source), size: source.length, catalogId: result.catalogId, importId,
					key: JSON.stringify([result.catalogId, importId, `${prefix}-photo`]), scope: JSON.stringify([result.catalogId, importId]),
					mediaContentToken: original.row.mediaContentToken });
			}
		}
	});
}

function assertInputs(inputs) {
	for (const [prefix, body, width, height, schema] of [['prior', PRIOR, 1, 1, 1], ['current', CURRENT, 2, 3, 2]]) {
		const photo = inputs[prefix]; expect(photo.schemaVersion).toBe(schema);
		expect(photo.original).toEqual({ schemaVersion: 1, kind: 'still', id: `${prefix}-source`, storageKey: `${prefix}-original`, name: `${prefix}.png`,
			mimeType: 'image/png', contentSha256: sha(body), byteLength: body.length, width, height, hasAlpha: true, retention: 'managed' });
	}
	const develop = inputs.current.versions[0].develop;
	expect(develop.processVersion).toBe(2);
	expect(develop.effects).toEqual([{ id: 'retained-profile', type: 'cube-lut-profile-v1', enabled: false, params: { lut: {
		storageKey: `lut-sha256:${sha(CUBE)}`, sha256: sha(CUBE), byteLength: CUBE.length, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] } } }]);
}
function assertOriginal(actual, body, prefix, exists, rootCount) {
	expect(actual.key).toBe(`${prefix}-original`); expect(actual.bytes).toEqual(exists ? [...body] : null);
	expect(actual.actualSha256).toBe(exists ? sha(body) : null);
	if (!exists) { expect(actual.row).toBeNull(); return; }
	expect(actual.row).toEqual({ sourceId: `${prefix}-original`, storage: 'opfs', path: expect.any(String), sha256: sha(body), size: body.length,
		mediaContentDigestVersion: 1, mediaContentToken: expect.stringMatching(/^media-content-[a-z0-9][a-z0-9-]{15,127}$/u), catalogRootCount: rootCount });
}
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

async function scenario(page, phase, when) {
	await installNativeOpfsWorkerCompanion(page);
	const bundle = await build({ entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-managed-import-boundaries-native-v2.ts', import.meta.url))],
		bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	for (const path of [`${ROOT}/index.html`, `${ROOT}/entry.js`]) await page.route(path, async route => {
		const response = await route.fetch(), headers = response.headers();
		delete headers['content-length']; delete headers['content-encoding']; headers['content-type'] = path.endsWith('.html') ? 'text/html' : 'text/javascript';
		try { await route.fulfill({ status: 200, headers, body: path.endsWith('.html')
			? '<!doctype html><title>Current native import boundaries</title>' : bundle.outputFiles[0].text }); }
		finally { await response.dispose(); }
	});
	await page.goto(`${ROOT}/index.html`);
	const result = await page.evaluate(async ({ root, phase, when }) =>
		(await import(new URL(`${root}/entry.js`, location.href).href)).qualifyManagedPhotoImportNativeBoundaryV2(phase, when), { root: ROOT, phase, when });
	await assertNativeOpfsWorkerExecution(page); return result;
}
