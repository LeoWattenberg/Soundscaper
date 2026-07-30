import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const MATERIALIZED_PROFILE = 'materialized-v1';
const SCAPE_RANGE_PROFILE = 'scape-range-v1';
const SCAPE_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';
const MATERIALIZED_MAXIMUM_BYTES = 512 * 1024 ** 2;
const SCAPE_RANGE_MAXIMUM_BYTES = 65 * 1024 ** 3;
const ID = 'a'.repeat(64);

test('preload sanitizes and freezes exact materialized chooser descriptors', async () => {
	const raw = readDescriptor();
	const fixture = await loadPreload([[{ ...raw, untrusted: true }]]);
	const descriptors = await fixture.bridge.chooseFiles({ purpose: 'media', multiple: true });

	assert.equal(Object.isFrozen(descriptors), true);
	assert.equal(Object.isFrozen(descriptors[0]), true);
	assert.deepEqual({ ...descriptors[0] }, raw);
	assert.deepEqual(fixture.invocations.map(([channel, value]) => [channel, { ...value }]), [[
		'soundscaper:v1:files:choose',
		{ purpose: 'media', multiple: true },
	]]);
});

test('preload admits a canonical 65 GiB Scape range descriptor from OS association', async () => {
	const fixture = await loadPreload();
	const raw = readDescriptor({
		readProfile: SCAPE_RANGE_PROFILE,
		name: 'Reference.SCAPE',
		size: SCAPE_RANGE_MAXIMUM_BYTES,
		mimeType: SCAPE_MIME_TYPE,
	});
	let received = null;
	const unsubscribe = fixture.bridge.onOpenProject((descriptor) => { received = descriptor; });
	fixture.listeners.get('soundscaper:v1:event:project-open')({}, raw);

	assert.deepEqual({ ...received }, raw);
	assert.equal(Object.isFrozen(received), true);
	unsubscribe();
	assert.equal(fixture.removals.length, 1);
});

test('preload rejects missing, oversized, mismatched, and noncanonical read profiles', async () => {
	const missingProfile = readDescriptor();
	delete missingProfile.readProfile;
	const cases = [
		missingProfile,
		readDescriptor({ size: MATERIALIZED_MAXIMUM_BYTES + 1 }),
		readDescriptor({
			readProfile: SCAPE_RANGE_PROFILE,
			name: 'large.scape',
			size: SCAPE_RANGE_MAXIMUM_BYTES + 1,
			mimeType: SCAPE_MIME_TYPE,
		}),
		readDescriptor({ readProfile: SCAPE_RANGE_PROFILE, name: 'large.aup4', mimeType: SCAPE_MIME_TYPE }),
		readDescriptor({ readProfile: SCAPE_RANGE_PROFILE, name: 'large.scape', mimeType: 'application/zip' }),
		readDescriptor({ name: 'downgraded.scape', mimeType: SCAPE_MIME_TYPE }),
		readDescriptor({ readProfile: 'scape-range-v2' }),
		{ ...readDescriptor(), url: `soundscaper-app://bundle/_desktop/read/${MATERIALIZED_PROFILE}/${ID}/session.wav?leak=1` },
		{ ...readDescriptor(), url: `soundscaper-app://bundle/_desktop/read/${MATERIALIZED_PROFILE}/${ID}/other.wav` },
		{ ...readDescriptor(), url: `https://example.com/_desktop/read/${MATERIALIZED_PROFILE}/${ID}/session.wav` },
	];
	const fixture = await loadPreload(cases.map((value) => [value]));

	for (const _candidate of cases) {
		await assert.rejects(
			() => fixture.bridge.chooseFiles({ purpose: 'project' }),
			/profile|descriptor|capability URL|too large|Scape/iu,
		);
	}
});

function readDescriptor(overrides = {}) {
	const value = {
		id: ID,
		readProfile: MATERIALIZED_PROFILE,
		name: 'session.wav',
		size: MATERIALIZED_MAXIMUM_BYTES,
		mimeType: 'audio/wav',
		lastModified: 123,
		...overrides,
	};
	value.url = overrides.url || `soundscaper-app://bundle/_desktop/read/${value.readProfile}/${value.id}/${encodeURIComponent(value.name)}`;
	return value;
}

async function loadPreload(invocationResults = []) {
	let bridge;
	const invocations = [];
	const listeners = new Map();
	const removals = [];
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		ArrayBuffer,
		Object,
		Promise,
		RangeError,
		String,
		TypeError,
		Uint8Array,
		URL,
		require: () => ({
			contextBridge: {
				exposeInMainWorld(name, value) {
					if (name === 'scapeDesktop') bridge = value.v1;
				},
			},
			ipcRenderer: {
				invoke(channel, value) {
					invocations.push([channel, value]);
					return Promise.resolve(invocationResults.shift());
				},
				send: () => {},
				on(channel, listener) { listeners.set(channel, listener); },
				removeListener(channel, listener) { removals.push([channel, listener]); },
			},
		}),
	});
	return { bridge, invocations, listeners, removals };
}
