# wasm-webp 0.1.0

- npm package: `wasm-webp@0.1.0`
- upstream: <https://github.com/nieyuyao/webp-wasm>
- bundled libwebp: `1.3.2`
- npm tarball SHA-512: `6754a8a7e98b2a88330cadef27348f7d2c51175ca3ff36e69fe5c9b94f7eedfbdaaf172e1a11a478b06a26be47f0b7605ae03010ab997a50b3c7bba3ced7e155`
- npm `dist.integrity`: `sha512-Z1Sop+mLKogzDK3vJzSPfSxRF1yj/zbmn+XJuU9+7fvarxcuGhGkeLBqJr5H8LdgWuAwEKuZelCzx7ujztfhVQ==`

The calculated tarball SHA-512 in base64 is identical to npm's
`dist.integrity` value above.

## Vendored files

| File | SHA-256 |
|---|---|
| `index.js` | `4241547f7359842e2dddab5f12ca6d29458a6d180b9dc99c1f3fcfb09813777b` |
| `webp-wasm.js` | `ea9023c6313b758105d1ab3d8adf27b504ec26d40ea59f4926ae4ae81fd1a32a` |
| `webp-wasm.wasm` | `4d438a73dfe550d608d6b89eee34ea9374d58d3ffa0355218766281fc9a76c22` |

`index.js`는 원본 대조용, 실행 경로 아님. Worker가 `webp-wasm.js`를 바로 부른다.

Only the browser ESM entry, its generated Emscripten module, and its `.wasm`
payload are vendored. `LICENSE.wasm-webp` contains the package MIT license;
`LICENSE.libwebp` contains libwebp's BSD-3-Clause license.

## Static-loader correction

One upstream line was changed so native browser ESM resolution works without a
bundler.

- Original: `import Module from './webp-wasm';`
- Vendored: `import Module from './webp-wasm.js';`
- Reason: browsers do not add a JavaScript extension to relative ESM imports.

