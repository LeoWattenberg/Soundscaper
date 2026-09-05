/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { configure } from '@zip.js/zip.js/index-native.js';

import { createNativeProjectService } from '../src/common/editor/controller/native-project-service.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';

// The archive helpers deflate through zip.js, which starts a worker per archive;
// several of those isolates do not fit the address space the suite runs under.
configure({ useWebWorkers: false });

const SAMPLE_RATE = 48_000;
const FRAMES = 64;

function projectXml(channelCount: number): string {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project version="1.0">
  <Application name="Other DAW" version="9"/>
  <Transport><Tempo unit="bpm" value="90" id="tempo"/><TimeSignature numerator="4" denominator="4" id="sig"/></Transport>
  <Structure>
    <Track contentType="audio" id="t1" name="Stem"><Channel role="regular" destination="m" id="c1"/></Track>
    <Track contentType="audio" id="mt" name="Master"><Channel role="master" id="m"/></Track>
  </Structure>
  <Arrangement id="arr"><Lanes timeUnit="seconds" id="l0"><Lanes track="t1" id="l1"><Clips id="cl">
    <Clip time="0" duration="0.001" playStart="0" name="Take"><Audio channels="${channelCount}" duration="${FRAMES / SAMPLE_RATE}" sampleRate="${SAMPLE_RATE}" id="a1"><File path="audio/take.wav"/></Audio></Clip>
  </Clips></Lanes></Lanes></Arrangement>
</Project>
`;
}

async function dawprojectFile(channelCount: number): Promise<Blob & { name: string }> {
	const channels = Array.from({ length: channelCount }, (_, channel) => (
		new Float32Array(FRAMES).map((_value, index) => ((index + channel) % 100) / 100 - 0.5)
	));
	const wav = new Blob(
		[encodeWav(channels, { sampleRate: SAMPLE_RATE, float: true }) as Uint8Array<ArrayBuffer>],
		{ type: 'audio/wav' },
	);
	const archive = await writeDawprojectArchive({
		projectXml: projectXml(channelCount), metadataXml: '<MetaData><Title>Wide</Title></MetaData>',
		files: [{ path: 'audio/take.wav', blob: wav }],
	});
	Object.defineProperty(archive, 'name', { value: 'Wide.dawproject' });
	return archive as Blob & { name: string };
}

function writerCapture() {
	const written: { sourceId: string; channels: number }[] = [];
	const store = {
		estimateStorage: async () => ({ usage: 0, quota: 1_000_000 }),
		beginSourceWrite: async (sourceId: string) => ({
			write: async (channels: readonly Float32Array[]) => {
				written.push({ sourceId, channels: channels.length });
			},
			commit: async () => undefined,
			abort: async () => undefined,
		}),
		deleteSource: async () => undefined,
	};
	return { written, store };
}

test('opening a DAWproject refuses audio above the 32-channel import limit before anything is persisted', async () => {
	const { written, store } = writerCapture();
	const fixture = createFixture({ store });
	const service = createNativeProjectService(fixture.runtime);
	const file = await dawprojectFile(33);

	await assert.rejects(
		() => service.openDawproject(file),
		/Audio import supports 1–32 channels; the source declares 33\./u,
	);

	assert.deepEqual(written, [], 'no PCM reaches the store');
	assert.deepEqual(fixture.switched, [], 'the previous project stays active');
	assert.equal(fixture.state.importing, false, 'the importing flag is released');
});

test('opening a DAWproject still admits audio at the 32-channel import limit', async () => {
	const { written, store } = writerCapture();
	const fixture = createFixture({ store });
	const service = createNativeProjectService(fixture.runtime);

	const result = await service.openDawproject(await dawprojectFile(32));

	assert.ok(result);
	assert.deepEqual(written.map((entry) => entry.channels), [32]);
	assert.deepEqual(fixture.switched, [(result.project as { id: string }).id]);
});
