# Real inference fixtures

These small fixtures ship with the nightly test payload. Model weights are downloaded separately through the production installer. `model-inputs.js` verifies the SHA-256 of both committed files before use.

| File | Source | SHA-256 | Rights |
| --- | --- | --- | --- |
| `jfk.wav` | [whisper.cpp v1.7.6 speech sample](https://github.com/ggml-org/whisper.cpp/blob/v1.7.6/samples/jfk.wav) | `59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e` | Excerpt of John F. Kennedy's 1961 inaugural address; US federal government recording, public domain. |
| `astronaut.png` | [scikit-image v0.20.0 NASA astronaut sample](https://github.com/scikit-image/scikit-image/blob/v0.20.0/skimage/data/astronaut.png) | `88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5` | NASA photograph of Eileen Collins, public domain, as documented by [scikit-image](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut). |

Speech preparation converts the original 16-bit, 16 kHz mono recording into float32 and adds one second of silence at either end. DeepFilterNet receives a linearly resampled 48 kHz version with reproducible low-level hiss. The astronaut is decoded to one 512 × 512 RGBA frame, retaining its explicit source-frame timing. The OCR input is generated locally on a white canvas with black `LOCAL MODEL` and `TEST` text; it contains no third-party media.

The tests require real voiced or visual content so that an empty result cannot pass. They do not compare transcripts, boxes, or audio against golden model predictions, and do not measure restoration or recognition quality.
