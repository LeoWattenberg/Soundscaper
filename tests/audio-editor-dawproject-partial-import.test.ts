/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { configure } from '@zip.js/zip.js/index-native.js';

import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';

configure({ useWebWorkers: false });

const SAMPLE_RATE = 48_000;
const FRAMES = 64;

async function twoSourceArchive(): Promise<Blob & { name: string }> {
	const projectXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project version="1.0">
  <Application name="Other DAW" version="9"/>
  <Transport><Tempo unit="bpm" value="90" id="tempo"/><TimeSignature numerator="4" denominator="4" id="sig"/></Transport>
  <Structure>
    <Track contentType="audio" id="t1" name="Stems"><Channel role="regular" destination="m" id="c1"/></Track>
    <Track contentType="audio" id="mt" name="Master"><Channel role="master" id="m"/></Track>
  </Structure>
  <Arrangement id="arr"><Lanes timeUnit="seconds" id="l0"><Lanes track="t1" id="l1"><Clips id="cl">
    <Clip time="0" duration="0.001" playStart="0" name="First"><Audio channels="1" duration="${FRAMES / SAMPLE_RATE}" sampleRate="${SAMPLE_RATE}" id="a1"><File path="audio/first.wav"/></Audio></Clip>
    <Clip time="1" duration="0.001" playStart="0" name="Second"><Audio channels="1" duration="${FRAMES / SAMPLE_RATE}" sampleRate="${SAMPLE_RATE}" id="a2"><File path="audio/second.wav"/></Audio></Clip>
  </Clips></Lanes></Lanes></Arrangement>
</Project>`;
	const wav = (value: number): Blob => new Blob([
		encodeWav([new Float32Array(FRAMES).fill(value)], { sampleRate: SAMPLE_RATE, float: true }) as Uint8Array<ArrayBuffer>,
	], { type: 'audio/wav' });
	const archive = await writeDawprojectArchive({
		projectXml, metadataXml: '<MetaData><Title>Two stems</Title></MetaData>',
		files: [
			{ path: 'audio/first.wav', blob: wav(0.25) },
			{ path: 'audio/second.wav', blob: wav(-0.5) },
		],
	});
	Object.defineProperty(archive, 'name', { value: 'two-stems.dawproject' });
	return archive as Blob & { name: string };
}

test('a second embedded source write failure rolls back the first and a retry imports both', async () => {
	const committed = new Map<string, number>();
	const deleted: string[] = [];
	const aborted: string[] = [];
	const committedOrder: string[] = [];
	const failure = new Error('second source storage failed');
	let writes = 0;
	const nextIdByPrefix = new Map<string, number>();
	const fixture = createFixture({
		createStableId: (prefix) => {
			const nextId = (nextIdByPrefix.get(prefix) ?? 0) + 1;
			nextIdByPrefix.set(prefix, nextId);
			return `${prefix}-${nextId}`;
		},
		store: {
			estimateStorage: async () => ({ usage: 0, quota: 1_000_000 }),
			beginSourceWrite: async (sourceId) => {
				let pending: number | null = null;
				return {
					write: async (channels) => {
						writes += 1;
						pending = channels[0]?.[0] ?? null;
						if (writes === 2) throw failure;
					},
					commit: async () => {
						if (pending === null) throw new Error('The source has no pending audio.');
						committed.set(sourceId, pending);
						committedOrder.push(sourceId);
					},
					abort: async () => { pending = null; aborted.push(sourceId); },
				};
			},
			deleteSource: async (sourceId) => { committed.delete(sourceId); deleted.push(sourceId); },
		},
	});
	const previousProject = fixture.runtime.getProject();
	const service = createNativeProjectService(fixture.runtime);
	const archive = await twoSourceArchive();

	await assert.rejects(service.openDawproject(archive), (error: unknown) => error === failure);
	assert.deepEqual(committedOrder, ['source-1'], 'the first source committed before the second write');
	assert.deepEqual(aborted, ['source-2'], 'the failed source transaction was aborted');
	assert.deepEqual(deleted, ['source-1'], 'the earlier committed source was rolled back');
	assert.equal(committed.size, 0, 'no imported source survives the failure');
	assert.equal(fixture.runtime.getProject(), previousProject, 'the open project remains active');
	assert.deepEqual(fixture.switched, []);
	assert.equal(fixture.state.importing, false);

	const result = await service.openDawproject(archive);
	assert.ok(result);
	assert.equal(result.project.title, 'Two stems');
	assert.equal(result.project.sources.length, 2);
	assert.equal(result.project.clips.length, 2);
	assert.deepEqual(result.project.sources.map((source) => source.id), ['source-3', 'source-4']);
	assert.deepEqual([...committed.entries()], [['source-3', 0.25], ['source-4', -0.5]]);
	assert.deepEqual(fixture.switched, [result.project.id]);
	assert.equal(fixture.runtime.getProject(), result.project);
	assert.equal(fixture.state.importing, false);
});
