#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { calculate, ValidationError } from './src/index.js';

const [policyPath, expensesPath, outPath] = process.argv.slice(2);
if (!policyPath || !expensesPath) {
  console.error('Usage: node cli.js <policy.json> <expenses.json> [out.json]');
  process.exit(2);
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

try {
  const output = `${JSON.stringify(calculate(readJson(policyPath), readJson(expensesPath)), null, 2)}\n`;
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, output);
    console.log(`Wrote ${outPath}`);
  } else {
    process.stdout.write(output);
  }
} catch (err) {
  if (err instanceof ValidationError) {
    console.error('Invalid input:');
    for (const message of err.errors) console.error(`  - ${message}`);
  } else {
    console.error(`Error: ${err.message}`);
  }
  process.exit(1);
}
