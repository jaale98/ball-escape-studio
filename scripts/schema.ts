/** Write scene.schema.json (editor autocomplete + validation for scenes/*.json). */
import { writeFileSync } from 'node:fs';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { SourceSchema } from '../src/engine/source';

const schema = zodToJsonSchema(SourceSchema, { name: 'Scene', $refStrategy: 'none', effectStrategy: 'input', pipeStrategy: 'input' });
writeFileSync('scene.schema.json', `${JSON.stringify(schema, null, 2)}\n`);
console.log('wrote scene.schema.json');
