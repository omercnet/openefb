#!/bin/sh
# Builds the batch tool against the shared core used by the app. Output: ./apd-georef (git-ignored).
set -e
cd "$(dirname "$0")"
swiftc -O -swift-version 5 -o apd-georef main.swift ../../efb-212/Services/AirportDiagramGeoreferencer.swift
echo "built $(pwd)/apd-georef"
