#!/usr/bin/env node

/**
 * Converts a JavaScript dungeon file to JSON that can be loaded into the UI.
 * Thin CLI wrapper around the exported `dungeonToJSON` (lib/core/dungeon-to-json.js).
 * Usage: node scripts/dungeon-to-json.js <input.js> [output-name]
 */

import { writeFileSync } from 'fs';
import path from 'path';
import { dungeonToJSON } from '../lib/core/dungeon-to-json.js';

// Get command line arguments
const args = process.argv.slice(2);

if (args.length === 0) {
    console.error('❌ Error: Please provide an input JavaScript file');
    console.log('Usage: node scripts/dungeon-to-json.js <input.js> [output-name]');
    console.log('Example: node scripts/dungeon-to-json.js ./dungeons/my-dungeon.js my-dungeon');
    process.exit(1);
}

const inputPath = path.resolve(args[0]);
const outputName = args[1] || path.basename(inputPath, '.js');

try {
    console.log(`📖 Loading ${inputPath}...`);
    console.log('🔄 Converting to JSON format...');
    // includeCredentials: true preserves the legacy UI round-trip behavior (full config).
    const dungeonState = await dungeonToJSON(inputPath, { includeCredentials: true });

    // Write to JSON file
    const outputPath = path.join(path.dirname(inputPath), `${outputName}.json`);
    writeFileSync(outputPath, JSON.stringify(dungeonState, null, 2), 'utf-8');

    console.log(`✅ Successfully created ${outputPath}`);
    console.log(`\n💡 You can now load this file in the dungeon-master UI:`);
    console.log(`   Click "Load" and select ${outputName}.json`);

} catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
}
