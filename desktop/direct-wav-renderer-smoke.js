/* SPDX-License-Identifier: AGPL-3.0-only */

export async function runDirectWavRendererSmoke(scope, plan) {
	const document = scope?.document;
	const bridge = scope?.scapeDesktop?.v1;
	if (!document || !bridge
		|| typeof bridge.chooseSaveTarget !== 'function'
		|| typeof bridge.beginWrite !== 'function'
		|| typeof bridge.writeChunk !== 'function'
		|| typeof bridge.finishWrite !== 'function'
		|| typeof bridge.abortWrite !== 'function') {
		throw new Error('Packaged direct WAV bridge is incomplete');
	}
	if (!plan || plan.schemaVersion !== 1 || plan.mode !== 'direct-wav-export-v1'
		|| !['soundscaper', 'framescaper'].includes(plan.productId)
		|| !/^[a-f\d]{32}$/u.test(plan.token)) {
		throw new TypeError('Packaged direct WAV plan is invalid');
	}
	const delay = (milliseconds) => new Promise((resolve) => scope.setTimeout(resolve, milliseconds));
	const waitFor = async (read, label, timeout = 45_000) => {
		const deadline = Date.now() + timeout;
		while (true) {
			const value = read();
			if (value) return value;
			if (Date.now() >= deadline) throw new Error(`Packaged direct WAV smoke timed out waiting for ${label}`);
			await delay(25);
		}
	};
	const setValue = (control, value) => {
		let owner = Object.getPrototypeOf(control);
		let descriptor;
		while (owner && !descriptor) {
			descriptor = Object.getOwnPropertyDescriptor(owner, 'value');
			owner = Object.getPrototypeOf(owner);
		}
		if (descriptor?.set) descriptor.set.call(control, value);
		else control.value = value;
		control.dispatchEvent(new scope.Event('input', { bubbles: true }));
		control.dispatchEvent(new scope.Event('change', { bubbles: true }));
	};
	const commitValue = async (control, value, label) => {
		if (typeof control?.focus !== 'function' || typeof control?.blur !== 'function') {
			throw new Error(`Packaged direct WAV ${label} cannot be committed`);
		}
		control.focus();
		setValue(control, value);
		await delay(25);
		control.blur();
		await delay(25);
	};
	const choose = async (dialog, field, index, expectedText) => {
		const button = await waitFor(() => dialog.querySelector(`${field} button`), `${field} button`);
		button.click();
		const option = await waitFor(() => {
			const values = [...document.querySelectorAll('[role="option"]')]
				.filter((option) => option.getAttribute?.('aria-disabled') !== 'true');
			if (expectedText) {
				const matches = values.filter((candidate) => String(candidate.textContent || '').trim() === expectedText);
				if (matches.length > 1) throw new Error(`Packaged direct WAV ${field} option is ambiguous`);
				return matches[0] ?? null;
			}
			return values[index] ?? null;
		}, `${field} options`);
		option.click();
		await delay(25);
	};
	const createFixture = ({
		channelCount = 2,
		frameCount = 792_000,
		identicalChannels = false,
		name = `direct-wav-smoke-${plan.token}.wav`,
	} = {}) => {
		const sampleRate = 48_000;
		const bytes = new Uint8Array(44 + frameCount * channelCount * 2);
		const view = new DataView(bytes.buffer);
		const text = (offset, value) => {
			for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
		};
		const dataBytes = bytes.byteLength - 44;
		text(0, 'RIFF');
		view.setUint32(4, 36 + dataBytes, true);
		text(8, 'WAVE');
		text(12, 'fmt ');
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true);
		view.setUint16(22, channelCount, true);
		view.setUint32(24, sampleRate, true);
		view.setUint32(28, sampleRate * channelCount * 2, true);
		view.setUint16(32, channelCount * 2, true);
		view.setUint16(34, 16, true);
		text(36, 'data');
		view.setUint32(40, dataBytes, true);
		for (let frame = 0; frame < frameCount; frame += 1) {
			const phase = 2 * Math.PI * 220 * frame / sampleRate;
			for (let channel = 0; channel < channelCount; channel += 1) {
				const channelPhase = identicalChannels ? phase : phase + channel * Math.PI / 3;
				view.setInt16(
					44 + (frame * channelCount + channel) * 2,
					Math.round(Math.sin(channelPhase) * 9_830),
					true,
				);
			}
		}
		return new scope.File([bytes], name, { type: 'audio/wav' });
	};

	const editor = await waitFor(() => {
		const candidate = document.querySelector('[data-audio-editor]');
		return candidate?.getAttribute('data-audio-editor-bound') === 'true' ? candidate : null;
	}, 'bound editor');
	if (editor.getAttribute('data-product') !== plan.productId) throw new Error('Packaged direct WAV product does not match its plan');
	const projectBin = document.querySelector('[data-workspace-panel="project-bin"]');
	if (projectBin) {
		const closeProjectBin = projectBin.querySelector('.kw-audio-editor__workspace-panel-close');
		if (!closeProjectBin) throw new Error('Packaged direct WAV project bin close action is unavailable');
		closeProjectBin.click();
		await waitFor(() => !document.querySelector('[data-workspace-panel="project-bin"]'), 'project bin close');
	}
	const input = await waitFor(() => document.querySelector('[data-import-input]'), 'import input');
	const importFixture = async (file, label, timeout = 30_000) => {
		const initialClips = Number(editor.getAttribute('data-clip-count') || 0);
		const transfer = new scope.DataTransfer();
		transfer.items.add(file);
		input.files = transfer.files;
		input.dispatchEvent(new scope.Event('change', { bubbles: true }));
		await waitFor(() => {
			const status = document.querySelector('[data-status]');
			if (status?.getAttribute('data-state') === 'error') {
				const detail = String(status.textContent || '').replace(/\s+/gu, ' ').trim().slice(0, 512);
				throw new Error(`Packaged direct ${label} import failed${detail ? `: ${detail}` : ''}`);
			}
			return Number(editor.getAttribute('data-clip-count') || 0) > initialClips
				&& status?.getAttribute('data-state') === 'success';
		}, `${label} import`, timeout);
	};
	await importFixture(createFixture(), 'WAV fixture');

	const exportButton = await waitFor(() => document.querySelector(
		'[data-action-bar] .kw-audio-editor__action-bar-center > button:last-of-type',
	), 'export action');
	exportButton.click();
	let dialog = await waitFor(() => document.querySelector('[data-export-dialog]'), 'export dialog');
	const footerButtons = [...dialog.querySelectorAll('.audio-editor-dialog-footer button')];
	if (footerButtons.length < 2) throw new Error('Packaged direct WAV export footer is incomplete');
	footerButtons[0].click();
	const metadata = await waitFor(() => document.querySelector('[data-export-metadata-dialog]'), 'metadata dialog');
	const metadataFields = [...metadata.querySelectorAll('.audio-editor-metadata-table input, .audio-editor-metadata-table textarea')];
	if (metadataFields.length !== 8) throw new Error('Packaged direct WAV metadata fields are incomplete');
	for (const field of metadataFields) setValue(field, '');
	const customMetadata = metadata.querySelector('.audio-editor-export-details textarea');
	if (!customMetadata) throw new Error('Packaged direct WAV custom metadata field is missing');
	setValue(customMetadata, '{}');
	await delay(25);
	const metadataButtons = [...metadata.querySelectorAll('.audio-editor-dialog-footer button')];
	if (metadataButtons.length !== 1) throw new Error('Packaged direct WAV metadata footer is incomplete');
	metadataButtons[0].click();
	dialog = await waitFor(() => document.querySelector('[data-export-dialog]'), 'restored export dialog');

	await choose(dialog, '[data-export-field="bitDepth"]', 0, '16-bit PCM');
	const sampleRate = await waitFor(() => dialog.querySelector('[data-export-field="sampleRate"] input'), 'sample rate');
	setValue(sampleRate, '384000');
	await delay(25);
	if (sampleRate.value !== '384000') throw new Error('Packaged direct WAV sample rate did not update');
	await choose(dialog, '[data-export-field="channelMapping"]', 3, 'Custom channel mapping');
	const matrix = await waitFor(() => dialog.querySelector('textarea'), 'custom channel matrix');
	setValue(matrix, JSON.stringify(Array.from({ length: 16 }, () => 0)));
	await delay(25);
	await choose(dialog, '[data-export-field="dither"]', 0, 'None');
	await delay(25);

	const OriginalAudioContext = scope.AudioContext || scope.webkitAudioContext;
	if (typeof OriginalAudioContext !== 'function') throw new Error('Packaged direct WAV AudioContext is unavailable');
	const originalDescriptor = Object.getOwnPropertyDescriptor(scope, 'AudioContext');
	let realtimeCount = 0;
	const TrackingAudioContext = new Proxy(OriginalAudioContext, {
		construct(target, argumentsList) {
			realtimeCount += 1;
			return Reflect.construct(target, argumentsList, target);
		},
		apply(target, thisValue, argumentsList) {
			realtimeCount += 1;
			return Reflect.apply(target, thisValue, argumentsList);
		},
	});
	Object.defineProperty(scope, 'AudioContext', { configurable: true, writable: true, value: TrackingAudioContext });
	let completed;
	let cancelled;
	let aiffCompleted;
	let bwfCompleted;
	let bw64Completed;
	try {
		const firstStart = await waitFor(() => dialog.querySelector('[data-export-action="start"] button'), 'first export action');
		firstStart.click();
		await waitFor(() => dialog.querySelector('[data-export-action="cancel"] button'), 'first export start');
		await waitFor(() => realtimeCount === 1, 'first realtime render');
		await waitFor(() => {
			const output = dialog.querySelector('[data-export-progress] output');
			const value = Number.parseFloat(String(output?.textContent || ''));
			return Number.isFinite(value) && value > 0 ? value : null;
		}, 'first export progress', 60_000);
		await waitFor(() => dialog.querySelector('[data-export-action="start"] button'), 'completed export', 150_000);
		const completedStatus = document.querySelector('[data-status]');
		if (completedStatus?.getAttribute('data-state') !== 'success') {
			const detail = String(completedStatus?.textContent || '').replace(/\s+/gu, ' ').trim().slice(0, 512);
			throw new Error(`Packaged direct WAV export failed${detail ? `: ${detail}` : ''}`);
		}
		completed = true;

		const secondStart = dialog.querySelector('[data-export-action="start"] button');
		secondStart.click();
		await waitFor(() => dialog.querySelector('[data-export-action="cancel"] button'), 'second export start');
		await waitFor(() => realtimeCount === 2, 'second realtime render');
		await delay(5_000);
		const cancel = dialog.querySelector('[data-export-action="cancel"] button');
		if (!cancel) throw new Error('Packaged direct WAV second export completed before cancellation');
		cancel.click();
		await waitFor(() => dialog.querySelector('[data-export-action="start"] button'), 'cancelled export');
		cancelled = true;

		await choose(dialog, '[data-export-field="format"]', 3, 'AIFF');
		await choose(dialog, '[data-export-field="bitDepth"]', 0, '16-bit PCM');
		const aiffSampleRate = await waitFor(
			() => dialog.querySelector('[data-export-field="sampleRate"] input'),
			'AIFF sample rate',
		);
		if (aiffSampleRate.value !== '384000') throw new Error('Packaged direct AIFF sample rate did not persist');
		const aiffStart = dialog.querySelector('[data-export-action="start"] button');
		if (!aiffStart) throw new Error('Packaged direct AIFF export action is unavailable');
		aiffStart.click();
		await waitFor(() => dialog.querySelector('[data-export-action="cancel"] button'), 'AIFF export start');
		await waitFor(() => realtimeCount === 3, 'AIFF realtime render');
		await waitFor(() => dialog.querySelector('[data-export-action="start"] button'), 'completed AIFF export', 150_000);
		const aiffStatus = document.querySelector('[data-status]');
		if (aiffStatus?.getAttribute('data-state') !== 'success') {
			const detail = String(aiffStatus?.textContent || '').replace(/\s+/gu, ' ').trim().slice(0, 512);
			throw new Error(`Packaged direct AIFF export failed${detail ? `: ${detail}` : ''}`);
		}
		aiffCompleted = true;

		await choose(dialog, '[data-export-field="format"]', 1, 'Broadcast WAV (BWF)');
		await choose(dialog, '[data-export-field="bitDepth"]', 0, '16-bit PCM');
		const bwfSampleRate = await waitFor(
			() => dialog.querySelector('[data-export-field="sampleRate"] input'),
			'BWF sample rate',
		);
		if (bwfSampleRate.value !== '384000') throw new Error('Packaged direct BWF sample rate did not persist');
		await choose(dialog, '[data-export-field="channelMapping"]', 3, 'Custom channel mapping');
		const bwfMatrix = await waitFor(() => dialog.querySelector('textarea'), 'BWF custom channel matrix');
		setValue(bwfMatrix, JSON.stringify(Array.from({ length: 16 }, () => 0)));
		await delay(25);
		const bwfFooter = [...dialog.querySelectorAll('.audio-editor-dialog-footer button')];
		if (bwfFooter.length < 2) throw new Error('Packaged direct BWF export footer is incomplete');
		bwfFooter[0].click();
		const bwfMetadata = await waitFor(
			() => document.querySelector('[data-export-metadata-dialog]'),
			'BWF metadata dialog',
		);
		const bextTabs = [...bwfMetadata.querySelectorAll('[role="tab"]')]
			.filter((tab) => String(tab.textContent || '').trim() === 'BEXT');
		if (bextTabs.length !== 1) throw new Error('Packaged direct BWF BEXT metadata tab is unavailable or ambiguous');
		bextTabs[0].click();
		await waitFor(() => bwfMetadata.querySelector('[data-bext-metadata-editor]'), 'BWF metadata editor');
		const bextVersion = bwfMetadata.querySelector('[name="version"]');
		if (bextVersion?.value !== '2') throw new Error('Packaged direct BWF metadata version is not 2');
		const authoredBext = {
			description: 'Soundscaper packaged BWF smoke',
			originator: 'Soundscaper',
			originatorReference: 'PACKAGED-BWF-0001',
			originationDate: '2026-07-30',
			originationTime: '12:34:56',
			timeReference: '6000',
			umid: '',
			loudnessValue: '',
			loudnessRange: '',
			maxTruePeakLevel: '',
			maxMomentaryLoudness: '',
			maxShortTermLoudness: '',
			codingHistory: 'A=PCM,F=48000,W=16,M=stereo,T=SmokeFixture\n',
		};
		for (const [name, value] of Object.entries(authoredBext)) {
			const field = await waitFor(
				() => bwfMetadata.querySelector(`[name="${name}"]`),
				`BWF metadata ${name}`,
			);
			await commitValue(field, value, `BWF metadata ${name}`);
		}
		const bwfMetadataButtons = [...bwfMetadata.querySelectorAll('.audio-editor-dialog-footer button')];
		if (bwfMetadataButtons.length !== 1) throw new Error('Packaged direct BWF metadata footer is incomplete');
		bwfMetadataButtons[0].click();
		dialog = await waitFor(() => document.querySelector('[data-export-dialog]'), 'restored BWF export dialog');
		const bwfStart = dialog.querySelector('[data-export-action="start"] button');
		if (!bwfStart) throw new Error('Packaged direct BWF export action is unavailable');
		bwfStart.click();
		await waitFor(() => dialog.querySelector('[data-export-action="cancel"] button'), 'BWF export start');
		await waitFor(() => realtimeCount === 4, 'BWF realtime render');
		await waitFor(() => dialog.querySelector('[data-export-action="start"] button'), 'completed BWF export', 150_000);
		const bwfStatus = document.querySelector('[data-status]');
		if (bwfStatus?.getAttribute('data-state') !== 'success') {
			const detail = String(bwfStatus?.textContent || '').replace(/\s+/gu, ' ').trim().slice(0, 512);
			throw new Error(`Packaged direct BWF export failed${detail ? `: ${detail}` : ''}`);
		}
		bwfCompleted = true;

		const closeButtons = [...dialog.querySelectorAll('.audio-editor-dialog-footer button')]
			.filter((button) => String(button.textContent || '').trim() === 'Cancel');
		if (closeButtons.length !== 1) throw new Error('Packaged direct BW64 project switch cannot close the export dialog');
		closeButtons[0].click();
		await waitFor(() => document.querySelector('[data-export-dialog]') ? null : true, 'export dialog close');
		const newProject = await waitFor(
			() => document.querySelector('.kw-audio-editor__project-tab-new'),
			'new project action',
		);
		newProject.click();
		await waitFor(() => editor.getAttribute('data-clip-count') === '0' ? true : null, 'new project activation');
		await importFixture(createFixture({
			channelCount: 6,
			frameCount: 2_112_000,
			identicalChannels: true,
			name: `direct-bw64-smoke-${plan.token}.wav`,
		}), 'BW64 fixture', 60_000);

		exportButton.click();
		dialog = await waitFor(() => document.querySelector('[data-export-dialog]'), 'BW64 export dialog');
		await choose(dialog, '[data-export-field="format"]', 2, 'BW64 / ADM');
		await choose(dialog, '[data-export-field="bitDepth"]', 0, '16-bit PCM');
		const bw64SampleRate = await waitFor(
			() => dialog.querySelector('[data-export-field="sampleRate"] input'),
			'BW64 sample rate',
		);
		setValue(bw64SampleRate, '384000');
		await delay(25);
		if (bw64SampleRate.value !== '384000') throw new Error('Packaged direct BW64 sample rate did not update');
		await choose(dialog, '[data-export-field="dither"]', 0, 'None');
		const bw64Footer = [...dialog.querySelectorAll('.audio-editor-dialog-footer button')];
		if (bw64Footer.length < 2) throw new Error('Packaged direct BW64 export footer is incomplete');
		bw64Footer[0].click();
		const bw64Metadata = await waitFor(
			() => document.querySelector('[data-export-metadata-dialog]'),
			'BW64 metadata dialog',
		);
		const metadataTab = (name) => {
			const tabs = [...bw64Metadata.querySelectorAll('[role="tab"]')]
				.filter((tab) => String(tab.textContent || '').trim() === name);
			if (tabs.length !== 1) throw new Error(`Packaged direct BW64 ${name} metadata tab is unavailable or ambiguous`);
			tabs[0].click();
		};
		metadataTab('General');
		const bw64MetadataFields = [...bw64Metadata.querySelectorAll(
			'.audio-editor-metadata-table input, .audio-editor-metadata-table textarea',
		)];
		if (bw64MetadataFields.length !== 8) throw new Error('Packaged direct BW64 general metadata fields are incomplete');
		for (const field of bw64MetadataFields) setValue(field, '');
		const bw64CustomMetadata = bw64Metadata.querySelector('.audio-editor-export-details textarea');
		if (!bw64CustomMetadata) throw new Error('Packaged direct BW64 custom metadata field is missing');
		setValue(bw64CustomMetadata, '{}');
		metadataTab('BEXT');
		await waitFor(() => bw64Metadata.querySelector('[data-bext-metadata-editor]'), 'BW64 BEXT metadata editor');
		if (bw64Metadata.querySelector('[name="version"]')?.value !== '2') {
			throw new Error('Packaged direct BW64 metadata version is not 2');
		}
		const bw64Bext = {
			description: 'Soundscaper packaged BW64 smoke',
			originator: 'Soundscaper',
			originatorReference: 'PACKAGED-BW64-0001',
			originationDate: '2026-07-30',
			originationTime: '12:34:56',
			timeReference: '6000',
			umid: '',
			loudnessValue: '',
			loudnessRange: '',
			maxTruePeakLevel: '',
			maxMomentaryLoudness: '',
			maxShortTermLoudness: '',
			codingHistory: 'A=PCM,F=48000,W=16,M=multi,T=SmokeFixture\n',
		};
		for (const [name, value] of Object.entries(bw64Bext)) {
			const field = await waitFor(
				() => bw64Metadata.querySelector(`[name="${name}"]`),
				`BW64 BEXT metadata ${name}`,
			);
			await commitValue(field, value, `BW64 BEXT metadata ${name}`);
		}
		metadataTab('ADM');
		const enableAdm = await waitFor(() => {
			const buttons = [...bw64Metadata.querySelectorAll('button')]
				.filter((button) => String(button.textContent || '').trim() === 'Enable ADM');
			if (buttons.length > 1) throw new Error('Packaged direct BW64 Enable ADM action is ambiguous');
			return buttons[0] ?? null;
		}, 'Enable ADM action');
		enableAdm.click();
		await waitFor(() => bw64Metadata.querySelector('[data-adm-metadata-editor]'), 'BW64 ADM metadata editor');
		const layout = await waitFor(() => bw64Metadata.querySelector('[name="adm-bed-layout"]'), 'BW64 ADM layout');
		setValue(layout, '5.1');
		const expectedRoutes = ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'];
		await waitFor(() => {
			const routes = [...bw64Metadata.querySelectorAll('.audio-editor-adm-route select')];
			if (routes.length !== expectedRoutes.length) return null;
			return routes.every((route, index) => (
				[...route.options].some((option) => option.value === expectedRoutes[index])
			)) ? routes : null;
		}, 'BW64 ADM 5.1 route controls');
		for (const [index, channel] of expectedRoutes.entries()) {
			const route = await waitFor(
				() => [...bw64Metadata.querySelectorAll('.audio-editor-adm-route select')][index],
				`BW64 ADM route ${String(index + 1)}`,
			);
			setValue(route, channel);
			await waitFor(
				() => [...bw64Metadata.querySelectorAll('.audio-editor-adm-route select')][index]?.value === channel,
				`BW64 ADM route ${String(index + 1)} assignment`,
			);
		}
		const authoredAdm = {
			'adm-programme-name': 'Soundscaper packaged BW64 programme',
			'adm-programme-language': '',
			'adm-content-name': 'Soundscaper packaged BW64 content',
			'adm-content-language': '',
			'adm-bed-name': 'Soundscaper packaged BW64 5.1 bed',
		};
		for (const [name, value] of Object.entries(authoredAdm)) {
			const field = await waitFor(
				() => bw64Metadata.querySelector(`[name="${name}"]`),
				`BW64 ADM metadata ${name}`,
			);
			await commitValue(field, value, `BW64 ADM metadata ${name}`);
		}
		const routes = [...bw64Metadata.querySelectorAll('.audio-editor-adm-route select')];
		const routeValues = routes.map((route) => route.value);
		if (JSON.stringify(routeValues) !== JSON.stringify(expectedRoutes)) {
			throw new Error('Packaged direct BW64 ADM routing is not canonical 5.1');
		}
		const bw64MetadataButtons = [...bw64Metadata.querySelectorAll('.audio-editor-dialog-footer button')];
		if (bw64MetadataButtons.length !== 1) throw new Error('Packaged direct BW64 metadata footer is incomplete');
		bw64MetadataButtons[0].click();
		dialog = await waitFor(() => document.querySelector('[data-export-dialog]'), 'restored BW64 export dialog');
		const bw64Start = dialog.querySelector('[data-export-action="start"] button');
		if (!bw64Start) throw new Error('Packaged direct BW64 export action is unavailable');
		bw64Start.click();
		await waitFor(() => dialog.querySelector('[data-export-action="cancel"] button'), 'BW64 export start');
		await waitFor(() => realtimeCount === 5, 'BW64 realtime render');
		await waitFor(() => dialog.querySelector('[data-export-action="start"] button'), 'completed BW64 export', 150_000);
		const bw64Status = document.querySelector('[data-status]');
		if (bw64Status?.getAttribute('data-state') !== 'success') {
			const detail = String(bw64Status?.textContent || '').replace(/\s+/gu, ' ').trim().slice(0, 512);
			throw new Error(`Packaged direct BW64 export failed${detail ? `: ${detail}` : ''}`);
		}
		bw64Completed = true;
	} finally {
		if (originalDescriptor) Object.defineProperty(scope, 'AudioContext', originalDescriptor);
		else delete scope.AudioContext;
	}
	const download = dialog.querySelector('[data-export-download]');
	const downloadVisible = Boolean(download && !download.hidden);
	return Object.freeze({
		imported: true, completed, cancelled, aiffCompleted, bwfCompleted, bw64Completed, realtimeCount, downloadVisible,
	});
}
