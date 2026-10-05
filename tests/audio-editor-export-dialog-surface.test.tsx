/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { elementByTag, mountedExportDialog } from './helpers/audio-editor-export-dialog-fixture.ts';

test('the dialog asks what is delivered once, and the answer states both form and span', async () => {
	const fixture = await mountedExportDialog();
	try {
		await fixture.chooseOutput(ENGLISH_COPY.exportOutputStems);
		await fixture.startExport();
		assert.equal(fixture.requests[0]?.mode, 'stems');
		assert.equal(fixture.requests[0]?.range, 'project');

		await fixture.chooseOutput(ENGLISH_COPY.exportOutputChapters);
		await fixture.startExport();
		assert.equal(fixture.requests[1]?.mode, 'chapters');
		assert.equal(fixture.requests[1]?.chapterSource, 'labels');
		assert.equal(fixture.requests[1]?.range, 'project');

		await fixture.chooseOutput(ENGLISH_COPY.exportOutputLoop);
		await fixture.startExport();
		assert.equal(fixture.requests[2]?.mode, 'mix');
		assert.equal(fixture.requests[2]?.range, 'loop');

		await fixture.chooseOutput(ENGLISH_COPY.entireProject);
		await fixture.startExport();
		assert.equal(fixture.requests[3]?.mode, 'mix');
		assert.equal(fixture.requests[3]?.range, 'project');
	} finally {
		await fixture.unmount();
	}
});

test('a project with labels and no markers is offered the label split alone', async () => {
	const fixture = await mountedExportDialog();
	try {
		assert.deepEqual(
			await fixture.outputOptionLabels(),
			[
				ENGLISH_COPY.entireProject, ENGLISH_COPY.exportOutputStems,
				ENGLISH_COPY.exportOutputClips,
				ENGLISH_COPY.exportOutputLoop, ENGLISH_COPY.exportOutputChapters,
			],
			'the label track has a label and the timeline has no marker, so only the label split is deliverable',
		);
	} finally {
		await fixture.unmount();
	}
});

test('a project with no labels is not offered a chapter split', async () => {
	const fixture = await mountedExportDialog({ labels: [] });
	try {
		assert.deepEqual(
			await fixture.outputOptionLabels(),
			[ENGLISH_COPY.entireProject, ENGLISH_COPY.exportOutputStems, ENGLISH_COPY.exportOutputClips, ENGLISH_COPY.exportOutputLoop],
			'the loop is enabled and there is no selection, so only those four are deliverable',
		);
	} finally {
		await fixture.unmount();
	}
});

test('a project with no labels reads why the chapter split is greyed out', async () => {
	const fixture = await mountedExportDialog({ labels: [] });
	try {
		assert.equal(fixture.noLabelsHint(), ENGLISH_COPY.exportOutputNoLabels);
	} finally {
		await fixture.unmount();
	}
});

test('a single-file delivery does not blame the labels for refusing a chapter split', async () => {
	const fixture = await mountedExportDialog();
	try {
		assert.equal(fixture.noLabelsHint(), null, 'the project already carries a label');

		await fixture.chooseFormat('BW64 / ADM');
		assert.deepEqual(
			await fixture.outputOptionLabels(),
			[ENGLISH_COPY.entireProject, ENGLISH_COPY.exportOutputLoop],
			'BW64 carries one programme, so neither the stems nor the chapter split is offered',
		);
		assert.equal(
			fixture.noLabelsHint(),
			null,
			'the format refuses the split whatever the labels say, so adding one would not help',
		);
	} finally {
		await fixture.unmount();
	}
});

test('the channel choice is radio buttons, and only a custom one opens the mapping editor', async () => {
	const fixture = await mountedExportDialog();
	try {
		assert.deepEqual(fixture.channelOptionLabels(), [
			ENGLISH_COPY.preserveChannels, ENGLISH_COPY.mono, ENGLISH_COPY.stereo, ENGLISH_COPY.customChannelMapping,
		]);
		assert.equal(fixture.editMappingButton().hasAttribute('disabled'), true);

		await fixture.chooseChannels('mono');
		await fixture.startExport();
		assert.equal(fixture.requests[0]?.channelMapping, 'mono');
		assert.equal(fixture.editMappingButton().hasAttribute('disabled'), true);

		await fixture.chooseChannels('custom');
		assert.equal(fixture.editMappingButton().hasAttribute('disabled'), false);
	} finally {
		await fixture.unmount();
	}
});

for (const productId of ['soundscaper', 'framescaper']) {
	test(`${productId} delivers clips from the existing export output choice`, async () => {
		const fixture = await mountedExportDialog({ productId, video: productId === 'framescaper' });
		try {
			await fixture.chooseField('loudnessNormalization', ENGLISH_COPY.loudnessNormalizationR128);
			await fixture.chooseOutput(ENGLISH_COPY.exportOutputClips);
			assert.deepEqual(fixture.sectionFields()[ENGLISH_COPY.renderingSection], ['dither']);
			await fixture.startExport();
			assert.equal(fixture.requests[0]?.mode, 'clips');
			assert.equal(fixture.requests[0]?.range, 'project');
			assert.equal(fixture.requests[0]?.includeTail, false);
			assert.equal(Object.hasOwn(fixture.requests[0] ?? {}, 'loudnessNormalization'), false);
			if (productId === 'framescaper') {
				await fixture.chooseFormat(ENGLISH_COPY.videoExportMp4);
				assert.equal((await fixture.outputOptionLabels()).includes(ENGLISH_COPY.exportOutputClips), false);
			}
		} finally {
			await fixture.unmount();
		}
	});
}

test('removing the last audio clip retires a clips choice even when video remains', async () => {
	const fixture = await mountedExportDialog({ video: true });
	try {
		await fixture.chooseOutput(ENGLISH_COPY.exportOutputClips);
		await fixture.removeAudioClips();
		await fixture.startExport();
		assert.equal(fixture.requests[0]?.mode, 'mix');
		assert.equal((await fixture.outputOptionLabels()).includes(ENGLISH_COPY.exportOutputClips), false);
	} finally {
		await fixture.unmount();
	}
});

test('the mapping editor writes the checked routing into the delivered request', async () => {
	const fixture = await mountedExportDialog();
	try {
		await fixture.chooseChannels('custom');
		await fixture.click(fixture.editMappingButton());
		// The grid opens on the identity routing this project would deliver.
		assert.equal(fixture.mappingCell(0, 0).getAttribute('aria-checked'), 'true');
		assert.equal(fixture.mappingCell(1, 0).getAttribute('aria-checked'), 'false');

		await fixture.click(fixture.mappingCell(1, 0));
		await fixture.click(fixture.mappingCell(1, 1));
		await fixture.click(elementByTag(
			fixture.dom.one('[data-export-channel-mapping-action="apply"]'), 'button',
		));
		assert.equal(fixture.dom.find('[data-export-channel-mapping]'), null);

		await fixture.startExport();
		assert.deepEqual(fixture.requests[0]?.channelMapping, {
			channels: [
				{ inputs: [{ channel: 0, gain: 1 }, { channel: 1, gain: 1 }] },
				{ inputs: [] },
			],
		});
	} finally {
		await fixture.unmount();
	}
});

test('dither and loudness normalization are rendering decisions, not audio-format ones', async () => {
	const fixture = await mountedExportDialog();
	try {
		const sections = fixture.sectionFields();
		assert.deepEqual(sections[ENGLISH_COPY.audioOptionsSection], ['channelMapping', 'bitDepth', 'sampleRate']);
		assert.deepEqual(sections[ENGLISH_COPY.exportSection], ['format', 'output']);
		assert.deepEqual(sections[ENGLISH_COPY.renderingSection], ['loudnessNormalization', 'dither', 'tails']);
	} finally {
		await fixture.unmount();
	}
});

test('a finished export starts its own download exactly once', async () => {
	const fixture = await mountedExportDialog();
	try {
		const link = fixture.dom.one('[data-export-download]');
		assert.equal(link.clickCount, 0);

		await fixture.publish({ url: 'blob:one', fileName: 'mix.wav' });
		assert.equal(link.clickCount, 1);
		// The same output re-rendering is not a second delivery.
		await fixture.publish({ url: 'blob:one', fileName: 'mix.wav' });
		assert.equal(link.clickCount, 1);

		await fixture.publish({ url: 'blob:two', fileName: 'mix.wav' });
		assert.equal(link.clickCount, 2);

		// A direct save writes the file itself and publishes no link to press.
		await fixture.publish({ url: null, fileName: 'mix.wav' });
		assert.equal(link.clickCount, 2);
	} finally {
		await fixture.unmount();
	}
});

test('reopening the dialog does not restart its previous download', async () => {
	const fixture = await mountedExportDialog({
		output: { url: 'blob:previous', fileName: 'mix.wav' },
	});
	try {
		const link = fixture.dom.one('[data-export-download]');
		assert.equal(link.clickCount, 0);
		assert.equal(link.getAttribute('href'), 'blob:previous');

		// An unchanged project may produce the same name and bytes. Its fresh URL,
		// not the artifact's identity, distinguishes the newly completed operation.
		await fixture.publish({ url: 'blob:next', fileName: 'mix.wav' });
		assert.equal(link.clickCount, 1);
	} finally {
		await fixture.unmount();
	}
});

test('a video format clears an audio mastering sequence selection', async () => {
	const sequenceName = 'Album side A';
	const fixture = await mountedExportDialog({
		masteringSequences: [{ id: 'sequence-a', name: sequenceName, deliverable: true }],
		video: true,
	});
	try {
		await fixture.chooseOutput(sequenceName);
		await fixture.chooseFormat(ENGLISH_COPY.videoExportMp4);
		assert.equal((await fixture.outputOptionLabels()).includes(sequenceName), false);
	} finally {
		await fixture.unmount();
	}
});

test("Opus delivery offers Audacity's VBR modes and states the chosen one", async () => {
	const fixture = await mountedExportDialog();
	try {
		await fixture.chooseFormat('Opus');
		assert.deepEqual(await fixture.fieldOptionLabels('vbrMode'), [
			ENGLISH_COPY.vbrModeOff, ENGLISH_COPY.vbrModeOn, ENGLISH_COPY.vbrModeConstrained,
		]);
		await fixture.startExport();
		/* A fresh Opus delivery takes Audacity's default of an unconstrained VBR. */
		assert.equal(fixture.requests[0]?.vbrMode, 'on');

		await fixture.chooseField('vbrMode', ENGLISH_COPY.vbrModeConstrained);
		await fixture.startExport();
		assert.equal(fixture.requests[1]?.vbrMode, 'constrained');
	} finally {
		await fixture.unmount();
	}
});

test("MP3 delivery offers Audacity's bit rate modes and follows the chosen one", async () => {
	const fixture = await mountedExportDialog();
	try {
		await fixture.chooseFormat('MP3');
		assert.deepEqual(await fixture.fieldOptionLabels('bitRateMode'), [
			ENGLISH_COPY.bitRateModePreset, ENGLISH_COPY.bitRateModeVariable,
			ENGLISH_COPY.bitRateModeAverage, ENGLISH_COPY.bitRateModeConstant,
		]);
		/* A fresh MP3 delivery is Audacity's Standard preset. */
		assert.deepEqual(await fixture.fieldOptionLabels('quality'), [
			ENGLISH_COPY.mp3PresetExcessive, ENGLISH_COPY.mp3PresetExtreme,
			ENGLISH_COPY.mp3PresetStandard, ENGLISH_COPY.mp3PresetMedium,
		]);
		await fixture.startExport();
		assert.equal(fixture.requests[0]?.bitRateMode, 'preset');
		assert.equal(fixture.requests[0]?.bitRatePreset, 2);

		await fixture.chooseField('bitRateMode', ENGLISH_COPY.bitRateModeVariable);
		const variable = await fixture.fieldOptionLabels('quality');
		assert.equal(variable.length, 10);
		assert.equal(variable[0], ENGLISH_COPY.mp3VariableBest);
		assert.equal(variable.at(-1), ENGLISH_COPY.mp3VariableSmallest);
		await fixture.chooseField('quality', '145-185 kbps');
		await fixture.startExport();
		assert.equal(fixture.requests[1]?.bitRateMode, 'variable');
		assert.equal(fixture.requests[1]?.vbrQuality, 4);

		await fixture.chooseField('bitRateMode', ENGLISH_COPY.bitRateModeConstant);
		await fixture.chooseField('quality', '256 kbps');
		await fixture.startExport();
		assert.equal(fixture.requests[2]?.bitRateMode, 'constant');
		assert.equal(fixture.requests[2]?.bitRate, 256);
		/* The variable quality the user picked is still there to come back to. */
		assert.equal(fixture.requests[2]?.vbrQuality, 4);
	} finally {
		await fixture.unmount();
	}
});
