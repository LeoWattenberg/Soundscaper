# Dereverb corresponding-source delivery

`dereverb-room.json` records the public HEAD, Range, CORS, and full SHA-256
readback of the exact source archive served alongside the ONNX model.
`dereverb-room-reproduction.json` records an independent deterministic repack,
the source inventory, a fresh environment installed from the archive's frozen
lock, and reproduction using only the extracted source instructions. After the
build, 69 inventoried files remained unchanged; setuptools regenerated its
package file list as recorded in the receipt.

The reproduced ONNX is byte-identical to the distributed model. A separate
waveform comparison passes against the source framework. These checks establish
source availability and reproducibility; they do not replace catalog signing,
Electron installation tests, or perceptual-quality review.
