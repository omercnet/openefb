#!/bin/sh
# Builds the CAAI aerodrome-diagram tool against the shared core used by the app. Output: ./caai-apd (git-ignored).
set -e
cd "$(dirname "$0")"
swiftc -O -swift-version 5 -o caai-apd main.swift ../../efb-212/Services/AirportDiagramGeoreferencer.swift
echo "built $(pwd)/caai-apd"
