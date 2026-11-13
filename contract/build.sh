#!/usr/bin/env bash
# Builds the contract and shrinks it with Binaryen's wasm-opt. The optimized
# file is less than half the size, which halves the NEAR locked for storage.
set -euo pipefail
cd "$(dirname "$0")"
cargo build --target wasm32-unknown-unknown --release
mkdir -p out
npx --yes --package=binaryen@132.0.0 wasm-opt -Oz --strip-debug --strip-producers \
  target/wasm32-unknown-unknown/release/rigbill.wasm -o out/rigbill.wasm
ls -l out/rigbill.wasm
