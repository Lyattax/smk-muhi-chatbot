// ingest.js — jalankan dengan: npm run ingest
// Mengubah semua file di folder knowledge/ menjadi data/index.json
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { chunkMarkdown } from './rag/chunker.js';
import { embedTexts, EMBED_MODEL, EMBED_DIM } from './rag/embed.js';

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) { console.error('GEMINI_API_KEY kosong di .env'); process.exit(1); }
const ai = new GoogleGenAI({ apiKey });
const KNOWLEDGE_DIR = 'knowledge';

const files = fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.md'));
let chunks = [];
for (const file of files) {
  const text = fs.readFileSync(path.join(KNOWLEDGE_DIR, file), 'utf8');
  chunks = chunks.concat(chunkMarkdown(text, file));
}
console.log(`${files.length} file -> ${chunks.length} chunk`);

const vectors = await embedTexts(ai, chunks.map((c) => c.text), 'RETRIEVAL_DOCUMENT');

const index = {
  model: EMBED_MODEL,
  dim: EMBED_DIM,
  createdAt: new Date().toISOString(),
  chunks: chunks.map((c, i) => ({
    id: i,
    ...c,
    embedding: vectors[i].map((x) => Number(x.toFixed(6))),
  })),
};

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/index.json', JSON.stringify(index));
console.log('Selesai: data/index.json');
