/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { HELPER_PLUGIN_FORMATS } from '../desktop/helper-job-grant.ts';
import {
	DesktopPluginConsent,
	type PluginConsentState,
	PluginConsentError,
	type PluginCustomRootOutcome,
	type PluginFormat,
	type PluginFormatConsentView,
	MAXIMUM_CUSTOM_PLUGIN_ROOTS,
	PLUGIN_FORMATS,
} from '../desktop/plugin-consent.ts';

interface Gate {
	readonly opened: Promise<void>;
	readonly open: () => void;
}

/** Holds a picker open so a test can act while the dialog is still up. */
function createGate(): Gate {
	let open = (): void => undefined;
	const opened = new Promise<void>((resolve) => {
		open = () => {
			resolve();
		};
	});
	return { opened, open };
}

interface Picker {
	readonly calls: PluginFormat[];
	readonly pick: (format: PluginFormat) => Promise<string | null>;
}

function createPicker(...answers: (string | null)[]): Picker {
	const calls: PluginFormat[] = [];
	const queue = [...answers];
	return {
		calls,
		pick: async (format) => {
			calls.push(format);
			return queue.length > 0 ? (queue.shift() as string | null) : null;
		},
	};
}

function createConsent(options: Partial<{
	platform: string;
	homeDirectory: string | null;
	picker: Picker;
	state: PluginConsentState;
}> = {}): Readonly<{ consent: DesktopPluginConsent; picker: Picker }> {
	const picker = options.picker ?? createPicker();
	const consent = new DesktopPluginConsent({
		pickDirectory: picker.pick,
		platform: options.platform ?? 'linux',
		homeDirectory: Object.hasOwn(options, 'homeDirectory') ? options.homeDirectory ?? null : '/home/tester',
		state: options.state,
	});
	return { consent, picker };
}

function formatView(consent: DesktopPluginConsent, format: PluginFormat): PluginFormatConsentView {
	const view = consent.describe().formats.find((entry) => entry.format === format);
	assert.ok(view, `the projection must describe ${format}`);
	return view;
}

function admitted(outcome: PluginCustomRootOutcome): Readonly<{ rootId: string; name: string }> {
	assert.equal(outcome.status, 'admitted');
	if (outcome.status !== 'admitted') throw new Error('unreachable');
	return outcome.root;
}

function refusal(outcome: PluginCustomRootOutcome): string {
	assert.equal(outcome.status, 'refused');
	if (outcome.status !== 'refused') throw new Error('unreachable');
	return outcome.code;
}

function consentErrorCode(operation: () => unknown): string {
	try {
		operation();
	} catch (error) {
		assert.ok(error instanceof PluginConsentError, `expected a PluginConsentError, saw ${String(error)}`);
		return error.code;
	}
	throw new Error('the operation was expected to throw');
}

/** Every string reachable from a renderer-facing projection. */
function projectedStrings(value: unknown, found: string[] = []): string[] {
	if (typeof value === 'string') found.push(value);
	else if (Array.isArray(value)) for (const entry of value) projectedStrings(entry, found);
	else if (value && typeof value === 'object') for (const entry of Object.values(value)) projectedStrings(entry, found);
	return found;
}

test('a fresh store consents to nothing and can produce no scan target', () => {
	const { consent, picker } = createConsent();
	const view = consent.describe();
	assert.equal(view.scanningEnabled, false, 'nothing may be scannable before the user says so');
	assert.deepEqual(view.formats.map((entry) => entry.granted), view.formats.map(() => false));
	assert.deepEqual([...PLUGIN_FORMATS], [...HELPER_PLUGIN_FORMATS], 're-exported, never a private copy');
	assert.equal(consentErrorCode(() => consent.scanTargets('vst3')), 'consent-withheld');
	assert.equal(consentErrorCode(() => consent.scanTargets('clap')), 'consent-withheld');
	assert.equal(consentErrorCode(() => consent.resolveRoot('vst3', 'r0')), 'consent-withheld');
	assert.equal(picker.calls.length, 0, 'nothing may open a folder dialog at startup');
});

test('every format the shared closed set names is answerable on every platform', () => {
	// The format set belongs to the helper contract, not to this module: a format
	// added there must come out of consent as inert-and-unsupported, never as a
	// missing table row that throws out of the renderer-facing projection.
	for (const platform of ['darwin', 'linux', 'win32']) {
		const { consent } = createConsent({ platform, homeDirectory: '/home/tester' });
		const view = consent.describe();
		assert.deepEqual(view.formats.map((entry) => entry.format), [...HELPER_PLUGIN_FORMATS], platform);
		for (const format of HELPER_PLUGIN_FORMATS) {
			assert.equal(typeof consent.supports(format), 'boolean', `${platform}/${format} must answer, not throw`);
			assert.equal(consent.isGranted(format), false, `${platform}/${format} must start ungranted`);
		}
	}
});

test('standard roots are offered per platform and stay inert until admitted', () => {
	const darwin = createConsent({ platform: 'darwin', homeDirectory: '/Users/tester' }).consent;
	const audioUnits = formatView(darwin, 'au');
	assert.equal(audioUnits.supported, true);
	assert.deepEqual(audioUnits.roots.map((root) => root.name),
		['System Audio Units folder', 'User Audio Units folder']);
	assert.deepEqual(audioUnits.roots.map((root) => root.admitted), [false, false]);

	const linux = createConsent({ platform: 'linux' }).consent;
	assert.equal(formatView(linux, 'au').supported, false);
	assert.deepEqual(formatView(linux, 'au').roots, []);
	assert.equal(consentErrorCode(() => linux.grant('au')), 'unsupported-format',
		'a macOS-only format is not grantable on Linux');
	assert.equal(formatView(linux, 'lv2').roots.length, 3);

	const windows = createConsent({ platform: 'win32', homeDirectory: 'C:\\Users\\tester' }).consent;
	assert.equal(consentErrorCode(() => windows.grant('lv2')), 'unsupported-format');
	assert.deepEqual(formatView(windows, 'vst3').roots.map((root) => root.name), ['Common VST3 folder']);

	const homeless = createConsent({ platform: 'linux', homeDirectory: null }).consent;
	assert.deepEqual(formatView(homeless, 'vst3').roots.map((root) => root.name),
		['System VST3 folder', 'Local VST3 folder'], 'a home-relative root is offered only when a home is known');
});

test('a standard root is admitted only after the format is granted', () => {
	const { consent } = createConsent();
	const offered = formatView(consent, 'vst3').roots;
	const systemRoot = offered[0].rootId;
	assert.equal(consentErrorCode(() => consent.admitStandardRoot('vst3', systemRoot)), 'consent-withheld');

	consent.grant('vst3');
	assert.deepEqual(consent.scanTargets('vst3'), [], 'a granted format with no root still scans nothing');
	assert.equal(consent.describe().scanningEnabled, false);

	consent.admitStandardRoot('vst3', systemRoot);
	assert.deepEqual(consent.scanTargets('vst3').map((root) => root.path), ['/usr/lib/vst3']);
	assert.equal(consent.resolveRoot('vst3', systemRoot).path, '/usr/lib/vst3');
	assert.equal(consent.describe().scanningEnabled, true);
	assert.equal(formatView(consent, 'vst3').roots[0].admitted, true);
	assert.equal(consentErrorCode(() => consent.admitStandardRoot('vst3', 'rdeadbeef')), 'unknown-root');
});

test('a custom root comes only from the main-owned picker, and only after consent', async () => {
	const picker = createPicker('/opt/vendor/plugins');
	const { consent } = createConsent({ picker });
	assert.equal(refusal(await consent.addCustomRoot('vst3')), 'consent-withheld');
	assert.equal(picker.calls.length, 0, 'the picker must not open for a format the user has not granted');

	consent.grant('vst3');
	const root = admitted(await consent.addCustomRoot('vst3'));
	assert.deepEqual(picker.calls, ['vst3']);
	assert.equal(root.name, 'plugins', 'a custom root is named by its folder, never by its path');
	assert.deepEqual(consent.scanTargets('vst3').map((entry) => entry.path), ['/opt/vendor/plugins']);
});

test('the picker answer is admitted as a path before it becomes a root', async () => {
	const picker = createPicker(null, 'relative/plugins', '/opt/vendor/../../etc', '/opt/ok');
	const { consent } = createConsent({ picker });
	consent.grant('clap');
	assert.equal((await consent.addCustomRoot('clap')).status, 'declined', 'a cancelled dialog admits nothing');
	assert.equal(refusal(await consent.addCustomRoot('clap')), 'unsafe-root');
	assert.equal(refusal(await consent.addCustomRoot('clap')), 'unsafe-root');
	assert.equal(admitted(await consent.addCustomRoot('clap')).name, 'ok');
	assert.equal(consent.scanTargets('clap').length, 1);
});

test('one folder is admitted once, and removal drops it from the scan targets', async () => {
	const picker = createPicker('/opt/vendor/plugins', '/opt/vendor/plugins');
	const { consent } = createConsent({ picker });
	consent.grant('vst3');
	const root = admitted(await consent.addCustomRoot('vst3'));
	assert.equal(refusal(await consent.addCustomRoot('vst3')), 'duplicate-root');
	assert.equal(consent.removeRoot('vst3', root.rootId), true);
	assert.deepEqual(consent.scanTargets('vst3'), []);
	assert.equal(consent.removeRoot('vst3', root.rootId), false);
	assert.equal(consentErrorCode(() => consent.resolveRoot('vst3', root.rootId)), 'unknown-root');
});

test('revoking a format stops scanning without discarding the chosen folders', async () => {
	const picker = createPicker('/opt/vendor/plugins');
	const { consent } = createConsent({ picker });
	consent.grant('vst3');
	await consent.addCustomRoot('vst3');
	consent.revoke('vst3');
	assert.equal(consent.isGranted('vst3'), false);
	assert.equal(consent.describe().scanningEnabled, false);
	assert.equal(consentErrorCode(() => consent.scanTargets('vst3')), 'consent-withheld');
	consent.grant('vst3');
	assert.deepEqual(consent.scanTargets('vst3').map((root) => root.path), ['/opt/vendor/plugins']);
});

test('consent revoked while the dialog is open admits nothing', async () => {
	const gate = createGate();
	const { consent } = createConsent({
		picker: {
			calls: [],
			pick: async (format) => {
				await gate.opened;
				return `/opt/${format}/late`;
			},
		},
	});
	consent.grant('vst3');
	const pending = consent.addCustomRoot('vst3');
	// The user revokes the format while the folder dialog is still up: the
	// authority checked before the await is stale by the time it resolves.
	consent.revoke('vst3');
	gate.open();
	assert.equal(refusal(await pending), 'consent-withheld');

	consent.grant('vst3');
	assert.deepEqual(consent.scanTargets('vst3'), [], 'a folder chosen after revocation is not an admitted root');
	assert.deepEqual(formatView(consent, 'vst3').roots.filter((root) => root.admitted), []);
});

test('two dialogs open at once cannot push past the custom-root ceiling', async () => {
	const gate = createGate();
	let picks = 0;
	const { consent } = createConsent({
		picker: {
			calls: [],
			pick: async () => {
				picks += 1;
				const answer = `/opt/vendor/plugins-${String(picks)}`;
				if (picks > MAXIMUM_CUSTOM_PLUGIN_ROOTS - 1) await gate.opened;
				return answer;
			},
		},
	});
	consent.grant('vst3');
	for (let index = 0; index < MAXIMUM_CUSTOM_PLUGIN_ROOTS - 1; index += 1) {
		admitted(await consent.addCustomRoot('vst3'));
	}
	// Both dialogs passed the capacity check before either answered, so only a
	// re-check after the await keeps the ceiling from being two roots wide.
	const both = [consent.addCustomRoot('vst3'), consent.addCustomRoot('vst3')];
	gate.open();
	const outcomes = await Promise.all(both);
	assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ['admitted', 'refused']);
	assert.equal(refusal(outcomes.find((outcome) => outcome.status === 'refused') ?? outcomes[0]), 'root-capacity');
	assert.equal(consent.scanTargets('vst3').length, MAXIMUM_CUSTOM_PLUGIN_ROOTS);
});

test('a persisted state may not carry more custom roots than the ceiling allows', () => {
	const roots = Array.from({ length: MAXIMUM_CUSTOM_PLUGIN_ROOTS + 1 }, (_unused, index) => ({
		rootId: `r${String(index)}`,
		origin: 'custom' as const,
		name: `plugins-${String(index)}`,
		path: `/opt/vendor/plugins-${String(index)}`,
	}));
	assert.equal(consentErrorCode(() => createConsent({
		state: { schemaVersion: 1, formats: [{ format: 'vst3', granted: true, roots }] },
	})), 'root-capacity');

	// One below the ceiling is an ordinary restore, so the bound is the only
	// thing being refused here.
	const fine = createConsent({
		state: {
			schemaVersion: 1,
			formats: [{ format: 'vst3', granted: true, roots: roots.slice(0, MAXIMUM_CUSTOM_PLUGIN_ROOTS) }],
		},
	}).consent;
	assert.equal(fine.scanTargets('vst3').length, MAXIMUM_CUSTOM_PLUGIN_ROOTS);
});

test('the renderer-facing projection never carries an absolute path', async () => {
	const platforms = [
		{ platform: 'darwin', home: '/Users/tester', picks: ['/Users/tester/Secret Plug-Ins/Vendor A'] },
		{ platform: 'linux', home: '/home/tester', picks: ['/srv/audio/vendor-b'] },
		{ platform: 'win32', home: 'C:\\Users\\tester', picks: ['C:\\', 'D:\\Audio\\Vendor C'] },
	];
	for (const target of platforms) {
		const picker = createPicker(...target.picks);
		const { consent } = createConsent({ platform: target.platform, homeDirectory: target.home, picker });
		const rawPaths: string[] = [...target.picks];
		for (const format of PLUGIN_FORMATS) {
			if (!consent.supports(format)) continue;
			consent.grant(format);
			for (const root of formatView(consent, format).roots) {
				consent.admitStandardRoot(format, root.rootId);
			}
			for (const root of consent.scanTargets(format)) rawPaths.push(root.path);
		}
		for (const _pick of target.picks) await consent.addCustomRoot('vst3');

		const view = consent.describe();
		const serialized = JSON.stringify(view);
		for (const value of projectedStrings(view)) {
			assert.equal(value.includes('/'), false, `${value} leaks a POSIX path separator`);
			assert.equal(value.includes('\\'), false, `${value} leaks a Windows path separator`);
			assert.equal(/^[A-Za-z]:/u.test(value), false, `${value} leaks a drive designator`);
		}
		for (const path of rawPaths) {
			assert.equal(serialized.includes(path), false, `${path} reached renderer-facing state`);
		}
		// The paths are still there on the main side, which is the point.
		assert.ok(consent.scanTargets('vst3').some((root) => rawPaths.includes(root.path)));
	}
});

test('consent survives a restart and rejects a state it cannot trust', async () => {
	const picker = createPicker('/opt/vendor/plugins');
	const { consent } = createConsent({ picker });
	consent.grant('vst3');
	consent.admitStandardRoot('vst3', formatView(consent, 'vst3').roots[0].rootId);
	await consent.addCustomRoot('vst3');
	const state = consent.exportState();

	const restored = createConsent({ state }).consent;
	assert.deepEqual(restored.scanTargets('vst3').map((root) => root.path),
		['/usr/lib/vst3', '/opt/vendor/plugins']);
	assert.deepEqual(restored.describe(), consent.describe());

	// A state file carried to a platform that cannot host the format is dropped
	// rather than resurrected as an ungrantable grant.
	const elsewhere = createConsent({ platform: 'win32', homeDirectory: 'C:\\Users\\tester', state: {
		schemaVersion: 1,
		formats: [{ format: 'lv2', granted: true, roots: [] }],
	} }).consent;
	assert.equal(formatView(elsewhere, 'lv2').granted, false);

	assert.equal(consentErrorCode(() => createConsent({
		state: { schemaVersion: 2, formats: [] } as unknown as PluginConsentState,
	})), 'malformed-state');
	assert.equal(consentErrorCode(() => createConsent({
		state: {
			schemaVersion: 1,
			formats: [{ format: 'vst3', granted: true, roots: [{ rootId: 'r0', origin: 'custom', name: 'x', path: 'relative' }] }],
		},
	})), 'unsafe-root');
});
