const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const body = source.slice(source.indexOf('function parseShoppingNoteText'), source.indexOf('\n\nconst PROMPT'));
const ctx = { NOTE_MAX_ITEMS: 100, NOTE_MAX_TEXT: 80 };
vm.runInNewContext(body + '\nthis.parseShoppingNoteText = parseShoppingNoteText;', ctx);
const parse = (value) => Array.from(ctx.parseShoppingNoteText(value));

test('parses prefixes, whitespace, empty lines, and preserves duplicates', () => {
  assert.deepStrictEqual(parse('1. Susu\n2) Telur\n(3) Roti\n- Apel\n• Jeruk\n* Teh\n+ Kopi\n[ ] Gula\n[x] Garam\n\n  Nasi  \nNasi'), ['Susu','Telur','Roti','Apel','Jeruk','Teh','Kopi','Gula','Garam','Nasi','Nasi']);
});
test('handles one line and empty input', () => { assert.deepStrictEqual(parse('  1. Satu  '), ['Satu']); assert.deepStrictEqual(parse(''), []); });
test('truncates items to 80 chars and caps at 100', () => { const out = parse(Array.from({length: 101}, (_, i) => `${i}. ${'x'.repeat(90)}`).join('\n')); assert.strictEqual(out.length, 100); assert.strictEqual(out[0].length, 80); });
