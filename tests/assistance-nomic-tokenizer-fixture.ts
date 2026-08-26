/* SPDX-License-Identifier: AGPL-3.0-only */

const UTF8 = new TextEncoder();

const SPECIALS = Object.freeze([
	Object.freeze({ id: 0, content: '[PAD]' }),
	Object.freeze({ id: 100, content: '[UNK]' }),
	Object.freeze({ id: 101, content: '[CLS]' }),
	Object.freeze({ id: 102, content: '[SEP]' }),
	Object.freeze({ id: 103, content: '[MASK]' }),
]);

export function nomicTokenizerArtifactFixture() {
	const added = SPECIALS.map(({ id, content }) => ({
		id, content, single_word: false, lstrip: false, rstrip: false,
		normalized: false, special: true,
	}));
	const special = (content: string) => ({
		content, lstrip: false, normalized: false, rstrip: false, single_word: false,
	});
	return Object.freeze({
		tokenizer: bytes({
			version: '1.0', truncation: null, padding: null, added_tokens: added,
			normalizer: { type: 'BertNormalizer', clean_text: true,
				handle_chinese_chars: true, strip_accents: null, lowercase: true },
			pre_tokenizer: { type: 'BertPreTokenizer' },
			post_processor: {
				type: 'TemplateProcessing',
				single: [specialTemplate('[CLS]'), sequenceTemplate('A', 0), specialTemplate('[SEP]')],
				pair: [specialTemplate('[CLS]'), sequenceTemplate('A', 0),
					specialTemplate('[SEP]'), sequenceTemplate('B', 1), specialTemplate('[SEP]', 1)],
				special_tokens: {
					'[CLS]': { id: '[CLS]', ids: [101], tokens: ['[CLS]'] },
					'[SEP]': { id: '[SEP]', ids: [102], tokens: ['[SEP]'] },
				},
			},
			decoder: { type: 'WordPiece', prefix: '##', cleanup: true },
			model: {
				type: 'WordPiece', unk_token: '[UNK]', continuing_subword_prefix: '##',
				max_input_chars_per_word: 100,
				vocab: {
					'[PAD]': 0, '[UNK]': 100, '[CLS]': 101, '[SEP]': 102, '[MASK]': 103,
					'!': 999, ',': 1010, ':': 1024, _: 1035, the: 1996, '##s': 2015,
					world: 2088, red: 2417, find: 2424, search: 3945, document: 6254,
					cafe: 7668, hello: 7592, bicycle: 10165, query: 23032,
				},
			},
		}),
		tokenizerConfig: bytes({
			added_tokens_decoder: Object.fromEntries(SPECIALS.map(({ id, content }) => [id, {
				content, lstrip: false, normalized: false, rstrip: false,
				single_word: false, special: true,
			}])),
			clean_up_tokenization_spaces: true, cls_token: '[CLS]', do_lower_case: true,
			mask_token: '[MASK]', model_max_length: 8192, pad_token: '[PAD]', sep_token: '[SEP]',
			strip_accents: null, tokenize_chinese_chars: true,
			tokenizer_class: 'BertTokenizer', unk_token: '[UNK]',
		}),
		specialTokensMap: bytes({
			cls_token: special('[CLS]'), mask_token: special('[MASK]'),
			pad_token: special('[PAD]'), sep_token: special('[SEP]'),
			unk_token: special('[UNK]'),
		}),
		config: bytes({
			architectures: ['NomicBertModel'], hidden_size: 768,
			max_position_embeddings: 2048, model_type: 'nomic_bert', n_embd: 768,
			n_positions: 8192, pad_token_id: 0, torch_dtype: 'float32',
			type_vocab_size: 2, vocab_size: 30528,
		}),
	});
}

function specialTemplate(id: '[CLS]' | '[SEP]', typeId = 0) {
	return { SpecialToken: { id, type_id: typeId } };
}

function sequenceTemplate(id: 'A' | 'B', typeId: 0 | 1) {
	return { Sequence: { id, type_id: typeId } };
}

function bytes(value: unknown): Uint8Array {
	return UTF8.encode(JSON.stringify(value));
}
