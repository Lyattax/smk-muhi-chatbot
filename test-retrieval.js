// test-retrieval.js — uji pencarian tanpa memanggil Gemini untuk menjawab
// pemakaian: node test-retrieval.js "berapa SPP per bulan?"
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { loadIndex, retrieve } from './rag/retriever.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY?.trim() });
loadIndex();

const question = process.argv.slice(2).join(' ');
if (!question) {
  console.log('Tulis pertanyaannya, contoh: node test-retrieval.js "berapa SPP per bulan?"');
  process.exit(1);
}
const hits = await retrieve(ai, question, { topK: 4, minScore: 0 });
for (const h of hits) console.log(h.score.toFixed(3), '|', h.source, '|', h.heading);
