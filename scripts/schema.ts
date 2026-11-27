/** Write scene.schema.json and quick.schema.json (editor autocomplete + validation for scenes/*.json and quick/*.json). */
import { writeFileSync } from 'node:fs';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { QuickFileAuthoringSchema } from '../src/director/quick';
import { SourceSchema } from '../src/engine/source';

const schema = zodToJsonSchema(SourceSchema, { name: 'Scene', $refStrategy: 'none', effectStrategy: 'input', pipeStrategy: 'input' });
writeFileSync('scene.schema.json', `${JSON.stringify(schema, null, 2)}\n`);
console.log('wrote scene.schema.json');

const quick = zodToJsonSchema(QuickFileAuthoringSchema, { name: 'Quick', $refStrategy: 'none', effectStrategy: 'input', pipeStrategy: 'input' });
writeFileSync('quick.schema.json', `${JSON.stringify(quick, null, 2)}\n`);
console.log('wrote quick.schema.json');
