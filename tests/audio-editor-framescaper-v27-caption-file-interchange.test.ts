/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	captionSidecarFormatForFileNameV27,
	openFramescaperCaptionSidecarFileV27,
	saveFramescaperCaptionSidecarFileV27,
} from '../src/common/editor/ui/framescaper-v27-caption-file-interchange.ts';

test('caption file interchange recognizes every selected V27 sidecar extension', () => {
	assert.equal(captionSidecarFormatForFileNameV27('captions.srt'), 'srt');
	assert.equal(captionSidecarFormatForFileNameV27('captions.VTT'), 'webvtt');
	assert.equal(captionSidecarFormatForFileNameV27('captions.ttml'), 'imsc1.1');
	assert.equal(captionSidecarFormatForFileNameV27('captions.imsc'), 'imsc1.1');
	assert.throws(() => captionSidecarFormatForFileNameV27('captions.txt'), /extension|format/iu);
});

test('browser and desktop caption picks stay pathless and decode strict UTF-8', async () => {
	const browser = new File(['WEBVTT\n'], 'captions.vtt', { type: 'text/vtt' });
	assert.deepEqual(await openFramescaperCaptionSidecarFileV27({ file: browser }), {
		format: 'webvtt', fileName: 'captions.vtt', text: 'WEBVTT\n',
	});

	const descriptors: unknown[] = [{ id: 'descriptor' }];
	const calls: unknown[] = [];
	const desktop = await openFramescaperCaptionSidecarFileV27({
		fileService: {
			isDesktop: true,
			chooseFiles(request) { calls.push(request); return descriptors; },
			openReadDescriptor(descriptor, options) {
				calls.push({ descriptor, options });
				return new File(['1\n00:00:00,000 --> 00:00:01,000\nHello\n'], 'captions.srt');
			},
		},
	});
	assert.equal(desktop?.format, 'srt');
	assert.equal(desktop?.fileName, 'captions.srt');
	assert.match(desktop?.text ?? '', /Hello/u);
	assert.deepEqual(calls[0], { purpose: 'labels', multiple: false });
	assert.equal(await openFramescaperCaptionSidecarFileV27({
		fileService: { isDesktop: true, chooseFiles: () => [] },
	}), null);

	const invalid = new File([Uint8Array.from([0xc3, 0x28])], 'captions.srt');
	await assert.rejects(() => openFramescaperCaptionSidecarFileV27({ file: invalid }), /UTF-8/iu);
});

test('caption export uses the common save convention with exact format names and MIME types', async () => {
	const requests: unknown[] = [];
	const result = await saveFramescaperCaptionSidecarFileV27({
		fileService: {
			saveFile(request) { requests.push(request); return { method: 'download' }; },
		},
		format: 'imsc1.1', trackId: 'English / Main', text: '<tt/>',
	});
	assert.deepEqual(result, { method: 'download' });
	assert.deepEqual(requests, [{
		purpose: 'interchange', suggestedName: 'English-Main.ttml',
		mimeType: 'application/ttml+xml;charset=utf-8', text: '<tt/>',
	}]);
});
