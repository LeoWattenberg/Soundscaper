/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

test('selected desktop products inject only the menu-lazy project derivative source', async () => {
	const [soundscaper, framescaper, lazySource] = await Promise.all([
		read('src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx'),
		read('src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx'),
		read('src/common/editor/ui/local-assistance-lazy-semantic-search-source.ts'),
	]);
	for (const source of [soundscaper, framescaper]) {
		assert.match(source,
			/if \(fileService\.isDesktop\)[\s\S]*?createLocalAssistanceLazySemanticSearchSourceV1\(\{[\s\S]*?bridgeScope: fileService\.bridge,[\s\S]*?repository: environment\.store\.assistanceDerivativeRepository,/u);
		assert.match(source, /assistanceSearchSource=\{[^}]+\?\? null\}/u);
		assert.doesNotMatch(source,
			/createLocalAssistanceSemanticIndexCustodyV1|createAssistanceSemanticSearchMenuSourceV1/u);
	}
	assert.match(lazySource,
		/import\('\.\/local-assistance-semantic-search-source\.ts'\)/u);
	assert.doesNotMatch(lazySource,
		/from '\.\/local-assistance-semantic-search-source\.ts'/u);
});

function read(path: string): Promise<string> {
	return readFile(new URL(path, ROOT), 'utf8');
}
