/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	renderAssistanceReference,
	renderAudioEffectReference,
	renderLanguageReference,
	renderNyquistReference,
	renderPlatformReference,
	renderProjectFileReference,
	renderVideoEffectReference,
	renderWorkspaceReference,
} from '../scripts/lib/docs-reference-generator.mjs';

const products = Object.freeze([
	Object.freeze({
		id: 'soundscaper',
		name: 'Soundscaper',
		shortcuts: Object.freeze({ disabledCommandIds: Object.freeze([]) }),
	}),
	Object.freeze({
		id: 'framescaper',
		name: 'Framescaper',
		shortcuts: Object.freeze({ disabledCommandIds: Object.freeze(['workspace-video-editor']) }),
	}),
]);

const effectProducts = Object.freeze([
	Object.freeze({ id: 'soundscaper', name: 'Soundscaper', capabilities: Object.freeze({ audioEffects: true, videoEffects: false }) }),
	Object.freeze({ id: 'framescaper', name: 'Framescaper', capabilities: Object.freeze({ audioEffects: false, videoEffects: true }) }),
]);

function audioEffectInput(overrides = {}) {
	return {
		products: effectProducts,
		audacitySource: { version: '3.7.7', commit: 'a'.repeat(40), url: 'https://example.invalid/audacity' },
		staffPadSource: { version: '4.0.0', commit: 'b'.repeat(40), url: 'https://example.invalid/staffpad' },
		staffPadEffectTypes: ['audacity-change-tempo'],
		factoryPresetSource: { version: '4.0.0', commit: 'c'.repeat(40), url: 'https://example.invalid/presets' },
		factoryPresets: {
			'audacity-normalize': [
				{ id: 'audacity-factory:audacity-normalize:broadcast', name: 'Broadcast', params: {} },
			],
		},
		audacityDefinitions: {
			'audacity-normalize': {
				category: 'volume',
				params: { peakDb: { kind: 'number', default: -1, minimum: -145, maximum: 0, unit: 'dB' } },
			},
			'audacity-change-tempo': {
				category: 'pitch-tempo',
				lengthChanging: true,
				requiresStaffPad: true,
				params: { mode: { kind: 'enum', default: 'fast', options: [{ value: 'fast' }, { value: 'exact' }] } },
			},
		},
		localDefinitions: {
			compressor: { defaults: { ratio: 4 }, ranges: { ratio: [1, 20, { unit: ':1' }] } },
		},
		rackEffectTypes: ['compressor', 'audacity-change-tempo'],
		selectionEffectTypes: ['audacity-normalize', 'audacity-change-tempo'],
		liveCapability: (type) => (type === 'audacity-normalize'
			? { live: false, reason: 'The gain depends on complete-selection statistics.' }
			: { live: true, reason: null }),
		effectLabel: (type) => ({
			'audacity-normalize': 'Normalize',
			'audacity-change-tempo': 'Change Tempo',
			compressor: 'Compressor',
		}[type]),
		parameterLabel: (type, name) => `${name} label`,
		optionLabel: (type, name, value) => `${String(value)} option`,
		formatCurve: (points) => points.map((point) => `${point.frequency}:${point.gain}`).join(', '),
		...overrides,
	};
}

test('audio effect reference separates realtime rack availability from selection availability', () => {
	const rendered = renderAudioEffectReference(audioEffectInput());

	assert.match(rendered, /Audio effects are registered by Soundscaper\./u);
	assert.match(rendered, /\| Normalize \| `audacity-normalize` \| Volume and dynamics \| No \| Yes \|/u);
	assert.match(rendered, /\| Compressor \| `compressor` \| Volume and dynamics \| Yes \| No \|/u);
	assert.match(rendered, /Changes the selection length; Uses the StaffPad time and pitch library/u);
	assert.match(rendered, /The gain depends on complete-selection statistics\./u);
	// A local effect has no live capability to consult, so it must not claim a reason.
	assert.doesNotMatch(rendered, /\| Compressor \| `compressor` \| [^|]*depends/u);
});

test('audio effect reference lists the presets an effect ships with, and only those', () => {
	const rendered = renderAudioEffectReference(audioEffectInput());

	assert.match(rendered, /\| Normalize \| `audacity-normalize` \| Broadcast \|/u);
	// An effect with no shipped presets has no row at all, rather than a blank one.
	assert.doesNotMatch(rendered, /\| Compressor \| `compressor` \| — \|/u);
});

test('audio effect reference refuses preset provenance it cannot cite', () => {
	assert.throws(
		() => renderAudioEffectReference(audioEffectInput({ factoryPresetSource: { version: '4.0.0' } })),
		/Audacity preset provenance is required/u,
	);
});

test('audio effect reference renders defaults, ranges, and resolved option labels', () => {
	const rendered = renderAudioEffectReference(audioEffectInput());

	assert.match(rendered, /\| Normalize \| `audacity-normalize` \| peakDb label \| -1 \| -145 to 0 \| dB \|/u);
	assert.match(rendered, /\| Compressor \| `compressor` \| ratio label \| 4 \| 1 to 20 \| :1 \|/u);
	assert.match(rendered, /\| mode label \| fast option \| fast option; exact option \| — \|/u);
});

test('audio effect reference prints a sentinel maximum as an open range', () => {
	const input = audioEffectInput();
	input.audacityDefinitions['audacity-normalize'].params.peakDb.maximum = Number.MAX_VALUE;
	const rendered = renderAudioEffectReference(input);

	assert.match(rendered, /\| -145 or more \|/u);
	assert.doesNotMatch(rendered, /e\+308/u);
});

test('audio effect reference refuses a local effect with no reviewed category', () => {
	assert.throws(
		() => renderAudioEffectReference(audioEffectInput({
			localDefinitions: { mystery: { defaults: {}, ranges: {} } },
			rackEffectTypes: ['mystery'],
			selectionEffectTypes: [],
			effectLabel: () => 'Mystery',
		})),
		/No reviewed documentation label exists for local effect mystery/u,
	);
});

test('audio effect reference refuses a structured local parameter with no reviewed shape', () => {
	assert.throws(
		() => renderAudioEffectReference(audioEffectInput({
			localDefinitions: { compressor: { defaults: { curveShape: [1, 2] }, ranges: {} } },
			rackEffectTypes: ['compressor'],
			selectionEffectTypes: [],
		})),
		/No reviewed documentation shape exists for structured parameter compressor\.curveShape/u,
	);
});

const videoDefinitions = Object.freeze({
	vignette: Object.freeze({
		type: 'vignette',
		label: 'Vignette',
		params: Object.freeze({
			amount: Object.freeze({ label: 'Amount', default: 0.5, min: 0, max: 1, control: 'number' }),
		}),
	}),
	outline: Object.freeze({
		type: 'outline',
		label: 'Outline',
		params: Object.freeze({
			width: Object.freeze({ label: 'Width', default: 4, min: 0, max: 16, control: 'number', unit: 'pixels' }),
			color: Object.freeze({ label: 'Color', default: 0xffffff, control: 'color' }),
			mode: Object.freeze({
				label: 'Mode',
				default: 1,
				control: 'select',
				options: Object.freeze([
					Object.freeze({ value: 0, label: 'Inside' }),
					Object.freeze({ value: 1, label: 'Outside' }),
				]),
			}),
		}),
	}),
});

test('video effect reference renders colors, choices, and units from one definition', () => {
	const rendered = renderVideoEffectReference({ products: effectProducts, definitions: videoDefinitions });

	assert.match(rendered, /Video effects are registered by Framescaper\./u);
	assert.match(rendered, /\| Outline \| `outline` \| 3 \|/u);
	assert.match(rendered, /\| Outline \| Color \| `#ffffff` \| Any RGB color \| — \|/u);
	assert.match(rendered, /\| Outline \| Mode \| Outside \| Inside; Outside \| — \|/u);
	assert.match(rendered, /\| Outline \| Width \| 4 \| 0 to 16 \| pixels \|/u);
});

test('video effect reference refuses an unknown control kind', () => {
	assert.throws(
		() => renderVideoEffectReference({
			products: effectProducts,
			definitions: {
				vignette: {
					type: 'vignette',
					label: 'Vignette',
					params: { amount: { label: 'Amount', default: 0, control: 'dial' } },
				},
			},
		}),
		/Unknown video effect control: dial/u,
	);
});

const nyquistPlugins = Object.freeze([
	Object.freeze({
		name: 'Beat Finder',
		actionId: 'nyquist:beat',
		role: 'analyze',
		author: 'Audacity',
		release: '2.3.2-2',
		copyright: 'GNU General Public License v2.0',
		fileName: 'beat.ny',
		sourceCommit: 'c'.repeat(40),
		isTool: false,
		spectral: false,
		controls: Object.freeze([
			Object.freeze({
				kind: 'choice',
				label: 'Sensitivity',
				unit: '',
				defaultValue: 1,
				options: Object.freeze([
					Object.freeze({ value: 0, label: 'Low' }),
					Object.freeze({ value: 1, label: 'High' }),
				]),
			}),
		]),
	}),
	Object.freeze({
		name: 'Spectral Delete',
		actionId: 'nyquist:spectral-delete',
		role: 'process',
		author: 'Steve Daulton',
		release: '3.0.4-1',
		copyright: 'GNU General Public License v2.0 or later',
		fileName: 'spectral-delete.ny',
		sourceCommit: 'c'.repeat(40),
		isTool: true,
		spectral: true,
		controls: Object.freeze([]),
	}),
]);

test('nyquist reference names its pinned source once and resolves choice defaults', () => {
	const rendered = renderNyquistReference({
		plugins: nyquistPlugins,
		products,
		isProductCommandDisabled: (id, disabled) => disabled.includes(id),
	});

	assert.match(rendered, /byte-for-byte copy of the Audacity source at `cccccccccccc`/u);
	assert.match(rendered, /\| Beat Finder \| `nyquist:beat` \| Analyze \| Soundscaper, Framescaper \|/u);
	assert.match(rendered, /Tool rather than a processing effect; Needs a spectral selection/u);
	assert.match(rendered, /\| Beat Finder \| Sensitivity \| Choice \| High \| Low; High \| — \|/u);
});

test('nyquist reference refuses a catalog that spans more than one upstream commit', () => {
	const mixed = [nyquistPlugins[0], { ...nyquistPlugins[1], sourceCommit: 'd'.repeat(40) }];
	assert.throws(
		() => renderNyquistReference({
			plugins: mixed,
			products,
			isProductCommandDisabled: () => false,
		}),
		/no longer share one upstream commit/u,
	);
});

const assistanceInput = Object.freeze({
	products: Object.freeze([
		Object.freeze({ id: 'soundscaper', name: 'Soundscaper', capabilities: Object.freeze({ assistanceAssets: true }) }),
		Object.freeze({ id: 'framescaper', name: 'Framescaper', capabilities: Object.freeze({ assistanceAssets: true }) }),
	]),
	guidedWorkflowIds: Object.freeze(['transcribe-captions']),
	operations: Object.freeze(['speech-recognition', 'word-alignment']),
	stageGraph: () => Object.freeze([
		Object.freeze({ stageId: 'detect-speech', operation: 'voice-activity-detection', required: true }),
		Object.freeze({ stageId: 'recognize-speech', operation: 'speech-recognition', required: true }),
		Object.freeze({ stageId: 'align-words', operation: 'word-alignment', required: false }),
		Object.freeze({ stageId: 'assemble-captions', operation: null, required: true }),
	]),
	modelCatalog: Object.freeze({
		publication: Object.freeze({ publicBaseUrl: 'https://assets.example.invalid/models/' }),
		entries: Object.freeze([
			Object.freeze({
				modelId: 'silero-vad-v6',
				version: '6.2.1',
				task: 'voice-activity-detection',
				platforms: Object.freeze(['win32-x64', 'linux-x64']),
				minimumMemoryBytes: 2 * 1024 ** 3,
				distribution: Object.freeze({ kind: 'identity-mirrored' }),
			}),
		]),
	}),
});

test('assistance reference orders required operations and separates the optional ones', () => {
	const rendered = renderAssistanceReference(assistanceInput);

	assert.match(rendered, /Local assistance is available in Soundscaper and Framescaper\./u);
	assert.match(rendered, /Voice activity detection → Speech recognition \| Word alignment \|/u);
	assert.match(rendered, /\| Word alignment \| `word-alignment` \| `advanced:word-alignment` \|/u);
	assert.match(rendered, /\| `silero-vad-v6` \| Voice activity detection \| 6\.2\.1 \| Mirrored byte-for-byte from upstream \| 2 GiB \| Linux x64; Windows x64 \|/u);
});

test('assistance reference refuses a workflow or distribution it has no reviewed wording for', () => {
	assert.throws(
		() => renderAssistanceReference({ ...assistanceInput, guidedWorkflowIds: ['summarise-everything'] }),
		/No reviewed documentation label exists for assistance workflow summarise-everything/u,
	);
	const catalog = {
		...assistanceInput.modelCatalog,
		entries: [{ ...assistanceInput.modelCatalog.entries[0], distribution: { kind: 'converted' } }],
	};
	assert.throws(
		() => renderAssistanceReference({ ...assistanceInput, modelCatalog: catalog }),
		/No reviewed documentation label exists for model distribution converted/u,
	);
});

test('workspace reference shows panel visibility per layout and filters by product', () => {
	const rendered = renderWorkspaceReference({
		products,
		copy: {
			workspaceClassic: 'Classic',
			workspaceVideo: 'Video editor',
			toolbarTransport: 'Transport',
			panelMixer: 'Mixer',
			dockBottom: 'Bottom',
			dockLeft: 'Left',
		},
		builtInWorkspaces: ['classic', 'video-editor'],
		presets: {
			classic: { panels: {}, toolbars: { transport: { visible: true } } },
			'video-editor': { panels: { mixer: { visible: true } }, toolbars: {} },
		},
		defaultPanels: { mixer: { dock: 'bottom' } },
		panelIds: ['mixer'],
		toolbarIds: ['transport'],
		dockIds: ['left', 'bottom'],
		panelLabel: (copy, id) => copy[`panel${id[0].toUpperCase()}${id.slice(1)}`] || id,
		dockLabel: (copy, id) => copy[`dock${id[0].toUpperCase()}${id.slice(1)}`] || id,
		isProductCommandDisabled: (id, disabled) => disabled.includes(id),
	});

	assert.match(rendered, /\| Classic \| `workspace-classic` \| Soundscaper, Framescaper \|/u);
	assert.match(rendered, /\| Mixer \| `mixer` \| Bottom \| Hidden \| Visible \|/u);
	assert.match(rendered, /\| Transport \| `transport` \| Visible \| Hidden \|/u);
});

test('project file reference distinguishes the legacy suffix from an unclaimed one', () => {
	const rendered = renderProjectFileReference({
		products,
		extensionByProduct: { soundscaper: '.sscape', framescaper: '.fscape', lightscaper: '.liscape' },
		acceptedExtensions: ['.sscape', '.fscape', '.liscape', '.scape'],
		legacyExtension: '.scape',
		mimeType: 'application/vnd.soundscaper.scape+zip',
		labelImportFormats: ['txt', 'srt'],
		labelExportFormats: ['txt', 'srt', 'json'],
	});

	assert.match(rendered, /Soundscaper and Framescaper each write their own suffix/u);
	assert.match(rendered, /\| `\.sscape` \| Soundscaper \| Every product \| — \|/u);
	assert.match(rendered, /\| `\.liscape` \| No shipping product \|/u);
	assert.match(rendered, /\| `\.scape` \| Nothing \|/u);
	assert.match(rendered, /\| Podcast 2\.0 chapters \(JSON\) \| `\.json` \| No \| Yes \|/u);
	// A suffix no product writes must never be attributed to a product that does not ship.
	assert.doesNotMatch(rendered, /Lightscaper/u);
});

test('language reference marks which translations are written here', () => {
	const rendered = renderLanguageReference({
		routeLocales: [
			{ locale: 'de', nativeName: 'Deutsch', direction: 'ltr' },
			{ locale: 'ar', nativeName: 'العربية', direction: 'rtl' },
		],
		bundledLocaleTags: ['en', 'de'],
		localePath: (locale, options) => (options?.embedded ? `/embed/${locale}/` : `/${locale}/`),
	});

	assert.match(rendered, /\| Deutsch \| `de` \| `\/de\/` \| Left to right \| Written for this editor \|/u);
	assert.match(rendered, /\| `ar` \| `\/ar\/` \| Right to left \| Audacity translation release \|/u);
	assert.match(rendered, /`\/embed\/en\/`/u);
});

test('platform reference names desktop packages from the packaging configuration', () => {
	const capabilities = {
		browserTargets: { chromium: { automated: true }, webkit: { automated: false } },
		desktopTargets: [
			{ os: 'linux', architecture: 'x64', packageGate: 'smoke-tested' },
			{ os: 'macos', architecture: 'arm64', packageGate: 'smoke-tested' },
		],
		platformTiers: ['web-core'],
	};
	const packageTargets = { win: ['nsis', 'zip'], mac: ['dmg'], linux: ['AppImage', 'deb'] };
	const rendered = renderPlatformReference({ capabilities, packageTargets });

	assert.match(rendered, /\| Chromium \(Chrome, Edge\) \| Yes \|/u);
	assert.match(rendered, /\| WebKit \(Safari\) \| No \|/u);
	assert.match(rendered, /\| Linux \| x64 \| AppImage; Debian package \| Packaged and started in an automated smoke test \|/u);
	assert.match(rendered, /\| macOS \| arm64 \| Disk image \|/u);
	assert.throws(
		() => renderPlatformReference({
			capabilities,
			packageTargets: { ...packageTargets, linux: ['snap'] },
		}),
		/No reviewed documentation label exists for desktop package format snap/u,
	);
});
