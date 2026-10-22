// rag/retriever.js
// Memuat index ke memori lalu mencari chunk yang paling mirip dengan pertanyaan.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedTexts } from './embed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, '..', 'data', 'index.json');

let store = [];

export function loadIndex(file = INDEX_PATH) {
  try {
    store = JSON.parse(fs.readFileSync(file, 'utf8')).chunks ?? [];
    console.log(`[RAG] ${store.length} chunk dimuat dari data/index.json`);
  } catch {
    store = [];
    console.warn('[RAG] data/index.json tidak ditemukan. Jalankan: npm run ingest');
  }
  return store.length;
}

export const ragSiap = () => store.length > 0;
export const jumlahChunk = () => store.length;

// Vektor sudah dinormalisasi, jadi dot product = cosine similarity.
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);

export async function retrieve(ai, query, { topK = 4, minScore = 0.45 } = {}) {
  if (store.length === 0) return [];
  const [qVec] = await embedTexts(ai, [query], 'RETRIEVAL_QUERY');

  const ranked = store
    .map((c) => ({ source: c.source, heading: c.heading, text: c.text, score: dot(qVec, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  console.log('[RAG]', query.slice(0, 60), '=>', ranked.map((r) => r.score.toFixed(2)).join(', '));
  return ranked.filter((r) => r.score >= minScore);
}
