# Circle native USDC test artifact

`circle-fiat-token-v2_2.json` is test-only compiled object code from Circle's unmodified `FiatTokenV2_2` implementation and `SignatureChecker` library. It is used only in a disposable local EVM. Production calls Circle's existing canonical Polygon contract and never deploys this fixture.

- Source: https://github.com/circlefin/stablecoin-evm
- Exact commit: `fc85788bc7c23cefe3df1a757133048bfddadeaa`
- Solidity: `0.6.12+commit.27d51765.Emscripten.clang`
- Optimizer: enabled, 200 runs
- Imported dependency: `@openzeppelin/contracts@3.4.2`
- Artifact includes exact SHA-256 digests of all 23 source files, ABI, object code, and library link references.
- The test links the reference library and installs the compiled implementation at the canonical token address in an isolated chain with chain ID 137; it does not reproduce the production proxy deployment or exercise real funds.

Circle source is licensed under Apache-2.0; its license is reproduced in `circle-fiat-token-LICENSE.txt`. Imported OpenZeppelin source is licensed under MIT; its license is reproduced in `openzeppelin-contracts-LICENSE.txt`, retrieved from https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v3.4.2/LICENSE. Retained source copyright notices:

- AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
- Copyright (c) 2016 Smart Contract Solutions, Inc.
- Copyright (c) 2018 zOS Global Limited.
- Copyright (c) 2018-2020 CENTRE SECZ
- Copyright 2023 Circle Internet Group, Inc. All rights reserved.
- The above copyright notice and this permission notice shall be included in
