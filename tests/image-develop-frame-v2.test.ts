/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { withImageDevelopFrameV2, captureImageDevelopCubeLutSourceV2 } from '../src/common/editor/imaging/image-develop-frame-v2.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { withPhotoDevelopFullResolutionFrameV2 } from '../src/lightscaper/controller/photo-develop-frame-v2.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 as LIMITS } from '../src/common/editor/photo-library-develop-full-resolution-port-v1.ts';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { EAGER_CHUNK_GROUPS, resolveRelativeModule, sourceModules, staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';

const BODY = new TextEncoder().encode(`LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => '0.25 0 0\n').join('')}`);
const sha = createHash('sha256').update(BODY).digest('hex');
const ref = { storageKey: `lut-sha256:${sha}`, sha256: sha, byteLength: BODY.byteLength, size: 2, domainMin: [0, 0, 0] as const, domainMax: [1, 1, 1] as const };
const descriptor = { schemaVersion: 1 as const, width: 1, height: 1, sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const };

test('neutral resource-aware owner and Photo facade deliver identical literal natural pixels without changing the source', async () => {
	const frame = { descriptor, pixels: new Uint8Array([64, 128, 192, 127]) };
	const develop = { ...defaultImageDevelopStateV2(), effects: [{ id: 'profile', type: 'cube-lut-profile-v1', enabled: true, params: { lut: ref } }] };
	const source: CubeLutSourcePortV1 = { async withBytes(reference, consume) { assert.equal(this, source); assert.deepEqual(reference, ref); return consume(BODY); } };
	for (const render of [(consume: (view: { frame: { pixels: Uint8Array } }) => number[]) => withImageDevelopFrameV2({ frame, develop }, consume, LIMITS, { source }),
		(consume: (view: { frame: { pixels: Uint8Array } }) => number[]) => withPhotoDevelopFullResolutionFrameV2({ frame, develop }, consume, { source })]) {
		assert.deepEqual(await render(view => [...view.frame.pixels]), [137, 0, 0, 127]);
	}
	assert.deepEqual([...frame.pixels], [64, 128, 192, 127]);
});

test('resource capture preserves the actual receiver without reflection or getter execution', async () => {
	let reflected = 0, getters = 0;
	const source: CubeLutSourcePortV1 = { async withBytes(_reference, consume) { assert.equal(this, source); return consume(BODY); } };
	source.withBytes = new Proxy(source.withBytes, { get() { reflected++; throw Error('method reflected'); } });
	const captured = captureImageDevelopCubeLutSourceV2(source); source.withBytes = () => { throw Error('late replacement'); };
	assert.equal(await captured.withBytes(ref, bytes => bytes.byteLength), BODY.byteLength); assert.equal(reflected, 0);
	assert.throws(() => captureImageDevelopCubeLutSourceV2({ get withBytes() { getters++; return source.withBytes; } })); assert.equal(getters, 0);
	const opaque = Object.freeze({ failure: 'reflection' });
	assert.throws(() => captureImageDevelopCubeLutSourceV2(new Proxy({}, { getOwnPropertyDescriptor() { throw opaque; } })), error => error === opaque);
});

test('the neutral wrapper remains a separate optional recipe owner with fixed semantic bounds', () => {
	for (const path of ['src/common/editor/imaging/image-develop-frame-core.ts', 'src/common/editor/imaging/image-develop-frame-v2.ts']) {
		assert.equal(chunkGroupForModulePath(path), 'editor-image-develop-recipe');
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), 'editor-image-develop-recipe');
		assert.notEqual(chunkGroupForModulePath(path + '.foreign'), 'editor-image-develop-recipe');
	}
	assert.notEqual(chunkGroupForModulePath('src/common/editor/imaging/image-develop-frame-v3.ts'), 'editor-image-develop-recipe');
	const group = chunkGroups.find(value => value.name === 'editor-image-develop-recipe'); assert.ok(group);
	assert.equal(group.priority, 99); assert.equal(group.maxSize, 400_000); assert.equal(group.includeDependenciesRecursively, false);
});

test('real Light bootstrap/import/backup runtime imports and paid copy co-owners cannot acquire the optional recipe wrapper', () => {
	const root = fileURLToPath(new URL('../', import.meta.url)), paid = new Set([...EAGER_CHUNK_GROUPS, 'editor-visual-effect-copy', 'lightscaper-develop-copy']);
	const coowners = new Map<string, string[]>();
	for (const path of sourceModules(resolve(root, 'src')).filter(path => !path.endsWith('.d.ts'))) {
		const owner = chunkGroupForModulePath(path); if (!owner || !paid.has(owner)) continue;
		const members = coowners.get(owner) ?? []; members.push(path); coowners.set(owner, members);
	}
	const source = new Map<string, string>();
	for (const entry of ['src/lightscaper/ui/LightscaperBootstrap.tsx', 'src/common/editor/ui/lightscaper/PhotoImportDialogV2.tsx', 'src/lightscaper/controller/photo-library-backup-v5.ts']) {
		const pending = [resolve(root, entry)], reached = new Set<string>(), charged = new Set<string>();
		while (pending.length) {
			const path = pending.pop()!; if (reached.has(path)) continue; reached.add(path);
			const owner = chunkGroupForModulePath(path);
			if (owner && paid.has(owner) && !charged.has(owner)) { charged.add(owner); pending.push(...coowners.get(owner) ?? []); }
			if (!source.has(path)) source.set(path, transformSync(readFileSync(path, 'utf8'), { loader: path.endsWith('.tsx') ? 'tsx' : path.endsWith('.ts') ? 'ts' : path.endsWith('.jsx') ? 'jsx' : 'js', format: 'esm' }).code);
			for (const specifier of staticRelativeDependencies(source.get(path)!)) { const target = resolveRelativeModule(path, specifier); assert.ok(target, specifier); pending.push(target); }
		}
		for (const path of reached) assert.doesNotMatch(relative(root, path).split(sep).join('/'), /\/imaging\/image-develop-frame-(?:core|v2)\.ts$/u, entry);
	}
});
