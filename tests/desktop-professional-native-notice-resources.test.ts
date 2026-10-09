/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { Script } from 'node:vm';

import { getFileMatchers, type FileMatcher } from 'app-builder-lib/out/fileMatcher.js';
import type { Configuration } from 'electron-builder';

import sourceRegister from '../config/milestone-5-native-source-acquisitions.json' with { type: 'json' };
import noticeRegister from '../config/soundscaper-professional-native-notices.json' with { type: 'json' };
import releaseLines from '../config/product-release-lines.json' with { type: 'json' };
import {
	assertSoundscaperProfessionalNativePackageNoticeSummary,
	soundscaperProfessionalNativeNoticeSummary,
} from '../scripts/lib/soundscaper-professional-native-notices.mjs';
import {
	soundscaperProfessionalNativeSourceIdsForTarget,
} from '../scripts/lib/soundscaper-professional-native-build-result-contract.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const configPath = join(repositoryRoot, 'electron-builder.config.cjs');
const require = createRequire(configPath);
const configSource = await readFile(configPath, 'utf8');
const agpl = await readFile(join(repositoryRoot, 'LICENSE'));
const targets = ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'];
const { copyFiles } = require('app-builder-lib/out/fileMatcher.js') as {
	copyFiles: (matchers: FileMatcher[] | null) => Promise<void>;
};
type Product = 'soundscaper' | 'framescaper';
type Descriptor = { byteLength: number; sha256: string };

for (const channel of ['candidate', 'stable'] as const) {
	test(`${channel} desktop resource copies preserve authenticated professional-native notices`, async context => {
		for (const productId of ['soundscaper', 'framescaper'] as const) {
			for (const target of targets) {
				const fixture = await copyFixture(context, productId, channel, target, true);
				const inventory = await noticeInventory(fixture.resources, fixture.summary.notices);
				const verify = () => assertSoundscaperProfessionalNativePackageNoticeSummary({
					summary: fixture.summary,
					professional: { sourceAuthentication: fixture.sourceAuthentication },
					target,
					requireFile: (path: string, pin: Descriptor) => {
						assert.deepEqual(inventory.get(path), pin, `${productId} ${target}: ${path}`);
					},
				}, fixture.authorities);
				verify();
				assert.deepEqual(await readFile(join(fixture.resources,
					'licenses/professional-native/AGPL-3.0.txt')), agpl);
				inventory.delete('licenses/professional-native/AGPL-3.0.txt');
				assert.throws(verify, /AGPL-3\.0/u);
				inventory.set('licenses/professional-native/AGPL-3.0.txt', descriptor(Buffer.from('changed')));
				assert.throws(verify, /AGPL-3\.0/u);
			}
		}
	});
}

test('typed-unavailable desktop stages copy codec notices without inventing professional notices', async context => {
	for (const productId of ['soundscaper', 'framescaper'] as const) {
		const fixture = await copyFixture(context, productId, 'candidate', 'linux-x64', false);
		await assert.rejects(readFile(join(fixture.resources,
			'licenses/professional-native/AGPL-3.0.txt')), { code: 'ENOENT' });
		assert.equal(await readFile(join(fixture.resources, 'licenses/codecs/codec.txt'), 'utf8'), 'codec notice');
		assert.equal(await readFile(join(fixture.resources, 'licenses/THIRD_PARTY_LICENSES.md'), 'utf8'), 'aggregate notice');
	}
});

async function copyFixture(context: TestContext, productId: Product,
	channel: 'candidate' | 'stable', target: string, built: boolean) {
	const root = await mkdtemp(join(tmpdir(), 'scape-professional-notice-resources-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const resources = join(root, 'installed-resources');
	const sourceAuthentication = {
		schemaVersion: 1, status: 'authenticated',
		sources: soundscaperProfessionalNativeSourceIdsForTarget(target).map((id: string) => {
			const source = sourceRegister.sources.find(entry => entry.id === id);
			assert.ok(source);
			return { id, authenticationStatus: 'authenticated',
				archiveEvidence: { byteLength: source.archive.byteLength, sha256: source.archive.sha256 },
				extractedTreeEvidence: source.extractedTree };
		}),
	};
	const bytesByName = new Map<string, Buffer>();
	const authorities = { sourceRegister, noticeRegister: {
		schemaVersion: 1, id: 'fixture-native-notices',
		sources: noticeRegister.sources.map(source => {
			const name = source.id === 'juce' ? 'AGPL-3.0.txt' : `${source.id}.txt`;
			const bytes = source.id === 'juce' ? agpl : Buffer.from(`notice for ${source.id}`);
			bytesByName.set(name, bytes);
			return { id: source.id,
				targets: targets.filter(value => soundscaperProfessionalNativeSourceIdsForTarget(value).includes(source.id)),
				notices: [{ name, origin: 'repository', path: 'LICENSE', ...descriptor(bytes) }] };
		}),
	} };
	const summary = soundscaperProfessionalNativeNoticeSummary({ target, sourceAuthentication }, authorities);
	const files = new Map<string, Buffer>([
		['LICENSE', agpl], ['LICENSES/example.txt', Buffer.from('third-party notice')],
		['.desktop-build/renderer/index.html', Buffer.from('renderer')],
		['.desktop-build/runtime/payload', Buffer.from('runtime')],
		['.desktop-build/licenses/THIRD_PARTY_LICENSES.md', Buffer.from('aggregate notice')],
		['.desktop-build/licenses/codecs/codec.txt', Buffer.from('codec notice')],
	]);
	if (built) {
		for (const notice of summary.notices) {
			const bytes = bytesByName.get(notice.name);
			assert.ok(bytes);
			files.set(`.desktop-build/licenses/professional-native/${notice.name}`, bytes);
		}
	}
	for (const [path, bytes] of files) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), bytes);
	}
	const module = { exports: {} as Configuration };
	new Script(configSource, { filename: configPath }).runInNewContext({
		module, process: { env: { SCAPE_PRODUCT: productId } },
		require: (specifier: string): unknown => {
			if (specifier === './config/product-release-lines.json') {
				const value = structuredClone(releaseLines);
				value.products.soundscaper.applicationVersionChannel = channel;
				value.products.soundscaper.releaseChannel = channel;
				return value;
			}
			if (specifier === './scripts/lib/desktop-signing-config.cjs') {
				return { desktopSigningConfig: () => ({
					forceCodeSigning: false, win: {}, mac: { identity: null, notarize: false },
				}) };
			}
			return require(specifier) as unknown;
		},
	});
	await copyFiles(getFileMatchers(module.exports, 'extraResources', resources, {
		macroExpander: value => value, customBuildOptions: {},
		globalOutDir: join(root, 'release'), defaultSrc: root,
	}));
	return { resources, summary, sourceAuthentication, authorities };
}

async function noticeInventory(resources: string, notices: { name: string }[]) {
	const inventory = new Map<string, Descriptor>();
	for (const notice of notices) {
		const path = `licenses/professional-native/${notice.name}`;
		try { inventory.set(path, descriptor(await readFile(join(resources, path)))); }
		catch (error) {
			if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
		}
	}
	return inventory;
}

function descriptor(bytes: Buffer): Descriptor {
	return { byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}
