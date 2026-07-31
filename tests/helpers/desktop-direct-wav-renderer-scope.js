/* SPDX-License-Identifier: AGPL-3.0-only */

const SOUNDSCAPER_PRODUCT_ID = 'soundscaper';

export function createRendererScope({ aiffExportFailure = '', exportFailure = '', importFailure = '', projectBinVisible = false, waitFailure = '' } = {}) {
	const fixture = {
		activeOptions: [],
		cancelledRuns: 0,
		completedRuns: 0,
		dialogOpen: false,
		exporting: false,
		importedFile: null,
		metadataFields: Array.from({ length: 8 }, (_, index) => `metadata-${index}`),
		customMetadata: '{"fixture":"must be cleared"}',
		metadataOpen: false,
		projectBinCloseCount: 0,
		projectBinVisible,
		progress: 0,
		progressQueries: 0,
		routedToProjectBin: false,
		selectionHistory: [],
		settings: {},
		startedRuns: 0,
	};
	class FakeEvent {
		constructor(type) { this.type = type; }
	}
	class FakeAudioContext {
		constructor() {}
	}
	class FakeDataTransfer {
		files = [];
		items = { add: (file) => { this.files.push(file); } };
	}
	class FakeFile {
		constructor(parts, name, options) {
			this.name = name;
			this.type = options.type;
			this.size = parts.reduce((size, part) => size + part.byteLength, 0);
			this.bytes = parts[0];
		}
	}
	const scope = {
		AudioContext: FakeAudioContext,
		DataTransfer: FakeDataTransfer,
		Event: FakeEvent,
		File: FakeFile,
		setTimeout: (callback, milliseconds) => {
			if (waitFailure && fixture.routedToProjectBin) throw new Error(waitFailure);
			return setTimeout(callback, Math.min(milliseconds, 5));
		},
		clearTimeout,
		scapeDesktop: { v1: {
			chooseSaveTarget: async () => ({}),
			beginWrite: async () => ({}),
			writeChunk: async () => ({}),
			finishWrite: async () => ({}),
			abortWrite: async () => ({}),
		} },
	};
	const root = element({
		attributes: {
			'data-audio-editor-bound': 'true',
			'data-clip-count': '0',
			'data-product': SOUNDSCAPER_PRODUCT_ID,
		},
	});
	const status = element({ attributes: { 'data-state': 'success' }, textContent: 'Ready' });
	const input = element({
		dispatch(event) {
			if (event.type !== 'change') return;
			fixture.importedFile = this.files[0];
			if (importFailure) {
				status.attributes['data-state'] = 'error';
				status.textContent = importFailure;
				return;
			}
			if (fixture.projectBinVisible) {
				fixture.routedToProjectBin = true;
				return;
			}
			root.attributes['data-clip-count'] = '1';
		},
	});
	const projectBinClose = element({ click: () => {
		fixture.projectBinCloseCount += 1;
		fixture.projectBinVisible = false;
	} });
	const projectBin = element({
		query(selector) {
			return selector === '.kw-audio-editor__workspace-panel-close' ? projectBinClose : null;
		},
	});
	const exportButton = element({ click: () => { fixture.dialogOpen = true; } });
	const sampleRateInput = element({
		value: '48000',
		dispatch(event) {
			if (['input', 'change'].includes(event.type)) fixture.settings.sampleRate = this.value;
		},
	});
	const matrix = element({
		value: '',
		dispatch(event) {
			if (['input', 'change'].includes(event.type)) fixture.settings.channelMatrix = this.value;
		},
	});
	const download = element({ hidden: true });
	const progressOutput = element({ textContent: '0%' });
	const metadataControls = fixture.metadataFields.map((_, index) => element({
		value: fixture.metadataFields[index],
		dispatch(event) {
			if (['input', 'change'].includes(event.type)) fixture.metadataFields[index] = this.value;
		},
	}));
	const customMetadata = element({
		value: fixture.customMetadata,
		dispatch(event) {
			if (['input', 'change'].includes(event.type)) fixture.customMetadata = this.value;
		},
	});
	const metadataButton = element({ click: () => { fixture.metadataOpen = true; } });
	const metadataDone = element({ click: () => { fixture.metadataOpen = false; } });
	const metadata = element({
		query(selector) {
			if (selector === '.audio-editor-export-details textarea') return customMetadata;
			return null;
		},
		queryAll(selector) {
			if (selector === '.audio-editor-metadata-table input, .audio-editor-metadata-table textarea') return metadataControls;
			if (selector === '.audio-editor-dialog-footer button') return [metadataDone];
			return [];
		},
	});
	const dropdown = (name, labels) => {
		let trigger;
		trigger = element({ click: () => {
			fixture.activeOptions = labels.map((label, index) => element({
				textContent: label,
				click: () => {
					fixture.settings[name] = index;
					if (name === 'format' && label === 'AIFF') fixture.settings.bitDepth = 1;
					fixture.selectionHistory.push([name, index]);
					trigger.textContent = label;
					fixture.activeOptions = [];
				},
			}));
		} });
		return element({ query: (selector) => selector === 'button' ? trigger : null });
	};
	const fields = {
		'[data-export-field="format"]': dropdown('format', ['WAV', 'Broadcast WAV (BWF)', 'BW64 / ADM', 'AIFF']),
		'[data-export-field="bitDepth"]': dropdown('bitDepth', ['16-bit PCM', '24-bit PCM', '32-bit PCM', '32-bit float']),
		'[data-export-field="sampleRate"] input': sampleRateInput,
		'[data-export-field="channelMapping"]': dropdown('channelMapping', ['Mono', 'Stereo', 'Preserve input channels', 'Custom channel mapping']),
		'[data-export-field="dither"]': dropdown('dither', ['None', 'Triangular', 'High-pass triangular']),
	};
	const start = element({
		click: () => {
			fixture.startedRuns += 1;
			fixture.exporting = true;
			fixture.progress = 0;
			progressOutput.textContent = '0%';
			new scope.AudioContext({ sampleRate: 384000 });
			if (fixture.startedRuns === 1 || fixture.startedRuns === 3) {
				setTimeout(() => {
					fixture.progress = 25;
					progressOutput.textContent = '25%';
				}, 1);
				setTimeout(() => {
					fixture.completedRuns += 1;
					fixture.exporting = false;
					const failure = fixture.startedRuns === 3 ? aiffExportFailure : exportFailure;
					status.attributes['data-state'] = failure ? 'error' : 'success';
					status.textContent = failure;
				}, 5);
			}
		},
	});
	const cancel = element({
		click: () => {
			fixture.cancelledRuns += 1;
			fixture.exporting = false;
		},
	});
	const dialog = element({
		query(selector) {
			if (selector in fields) return fields[selector];
			if (selector === 'textarea') return matrix;
			if (selector === '[data-export-download]') return download;
			if (selector === '[data-export-progress] output') {
				fixture.progressQueries += 1;
				return progressOutput;
			}
			if (selector === '[data-export-action="start"] button') return fixture.exporting ? null : start;
			if (selector === '[data-export-action="cancel"] button') return fixture.exporting ? cancel : null;
			if (selector.endsWith(' button')) return fields[selector.slice(0, -7)]?.querySelector('button') || null;
			return null;
		},
		queryAll(selector) {
			if (selector === '.audio-editor-dialog-footer button') {
				return [metadataButton, fixture.exporting ? cancel : start];
			}
			return [];
		},
	});
	const document = {
		fixture,
		querySelector(selector) {
			if (selector === '[data-audio-editor]') return root;
			if (selector === '[data-workspace-panel="project-bin"]') return fixture.projectBinVisible ? projectBin : null;
			if (selector === '[data-import-input]') return input;
			if (selector === '[data-status]') return status;
			if (selector === '[data-action-bar] .kw-audio-editor__action-bar-center > button:last-of-type') return exportButton;
			if (selector === '[data-export-dialog]') return fixture.dialogOpen && !fixture.metadataOpen ? dialog : null;
			if (selector === '[data-export-metadata-dialog]') return fixture.metadataOpen ? metadata : null;
			return null;
		},
		querySelectorAll(selector) {
			return selector === '[role="option"]' ? fixture.activeOptions : [];
		},
	};
	scope.document = document;
	Object.defineProperty(input, 'files', { configurable: true, writable: true, value: [] });
	Object.defineProperty(sampleRateInput, 'value', { configurable: true, writable: true, value: '48000' });
	Object.defineProperty(matrix, 'value', { configurable: true, writable: true, value: '' });
	return scope;
}

function element({ attributes = {}, click = () => {}, dispatch = () => {}, hidden = false, query = () => null, queryAll = () => [], textContent = '', value = '' } = {}) {
	return {
		attributes,
		click,
		dispatchEvent(event) { return dispatch.call(this, event); },
		getAttribute(name) { return attributes[name] ?? null; },
		hidden,
		querySelector: query,
		querySelectorAll: queryAll,
		textContent,
		value,
	};
}
