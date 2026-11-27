#!/bin/bash
set -euo pipefail
APP_SOURCE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$APP_SOURCE/.build"
swiftc -parse-as-library -o "$APP_SOURCE/.build/native-contracts" \
    "$APP_SOURCE/Sources/TwoManyDMs/Models.swift" \
    "$APP_SOURCE/Sources/TwoManyDMs/LocalAPI.swift" \
    "$APP_SOURCE/Tests/ContractTests.swift"
"$APP_SOURCE/.build/native-contracts" "$@"
