const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('sqlite'); // bundle assets/aviation.sqlite
config.resolver.assetExts.push('pbf'); // bundle assets/glyphs (offline map labels)

module.exports = config;
