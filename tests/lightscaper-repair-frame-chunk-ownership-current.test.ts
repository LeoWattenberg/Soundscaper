/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

function owner(path: string) {
	return chunkGroupForModulePath(path);
}

test('Current Lightscaper handoff schema kernels retain the established shared editor domain owner', () => {
	for (const name of ['timeline-image-model-editable-kernel-v1', 'image-develop-handoff-provenance-kernel-v1', 'video-cube-lut-project-references-kernel-v1']) {
		for (const prefix of ['/workspace/src/common/editor/internal/', 'D:\\workspace\\src\\common\\editor\\internal\\']) {
			assert.equal(owner(`${prefix}${name}.ts`), 'editor-domain', name);
		}
	}
});

test('Current Lightscaper handoff image execution stays in the existing Frame image feature owner', () => {
	for (const name of ['timeline-image-current-frame-source', 'timeline-image-mask-raster-source-v1', 'timeline-image-execution-resources-current-v1',
		'timeline-image-develop-frame-v2', 'timeline-image-develop-frame-v3', 'internal/timeline-image-develop-frame-kernel-v1']) {
		assert.equal(owner(`/workspace/src/framescaper/${name}.ts`), 'framescaper-timeline-images', name);
		assert.equal(owner(`D:\\workspace\\src\\framescaper\\${name.replaceAll('/', '\\')}.ts`), 'framescaper-timeline-images', name);
	}
});

test('Current handoff ownership leaves foreign product modules and native project audit ownership intact', () => {
	assert.notEqual(owner('/workspace/src/soundscaper/timeline-image-current-frame-source.ts'), 'framescaper-timeline-images');
	assert.notEqual(owner('/workspace/src/common/editor/internal/unrelated-service.ts'), 'editor-domain');
	assert.equal(owner('/workspace/src/common/editor/storage/project-repository.ts'), 'editor-storage-model');
	assert.equal(owner('/workspace/src/framescaper/editor-project-timeline-image-source-rebind.ts'), 'framescaper-timeline-images');
});

test('Current repair execution shares the existing optional recipe owner while source capability capture stays inert', () => {
	for (const version of ['core', 'v2', 'v3']) {
		assert.equal(owner(`/workspace/src/common/editor/imaging/image-develop-frame-${version}.ts`), 'editor-image-develop-recipe');
	}
	assert.equal(owner('/workspace/src/common/editor/imaging/cube-lut-source-scope-v1.ts'), 'editor-imaging');
});

test('Current handoff shared native LUT and durable archive leaves retain their established semantic owners', () => {
	for (const prefix of ['/workspace/src/framescaper/', 'D:\\workspace\\src\\framescaper\\']) {
		assert.equal(owner(`${prefix}cube-lut-source-finishing.ts`), 'framescaper-timeline-images');
		assert.notEqual(owner(`${prefix}editor-scape-durable-asset-plan-core.ts`), 'editor-scape-archive-bytes');
	}
	for (const prefix of ['/workspace/src/common/editor/', 'D:\\workspace\\src\\common\\editor\\']) {
		assert.equal(owner(`${prefix}scape-durable-asset-plan-core-v1.ts`), 'editor-scape-archive-bytes');
	}
	assert.notEqual(owner('/workspace/src/framescaper/cube-lut-source-unrelated.ts'), 'editor-imaging');
	assert.notEqual(owner('/workspace/src/framescaper/editor-scape-durable-asset-unrelated.ts'), 'editor-scape-archive-bytes');
});
