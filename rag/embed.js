// rag/embed.js
// Mengubah teks menjadi vektor angka (embedding) lewat Gemini.

export const EMBED_MODEL = process.env.EMBED_MODEL?.trim() || 'gemini-embedding-001';
export const EMBED_DIM = 768;
const BATCH_SIZE = 50;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Panjang vektor dibuat = 1 supaya nanti cukup memakai dot product.
function normalize(v) {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}

/**
 * @param ai        instance GoogleGenAI
 * @param texts     array string
 * @param taskType  'RETRIEVAL_DOCUMENT' (saat ingest) atau 'RETRIEVAL_QUERY' (saat bertanya)
 */
export async function embedTexts(ai, texts, taskType) {
  const vectors = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await ai.models.embedContent({
      model: EMBED_MODEL,
      contents: batch,
      config: { taskType, outputDimensionality: EMBED_DIM },
    });
    if (!res.embeddings || res.embeddings.length !== batch.length) {
      throw new Error(`Embedding tidak sesuai: minta ${batch.length}, dapat ${res.embeddings?.length ?? 0}`);
    }
    for (const e of res.embeddings) vectors.push(normalize(e.values));
    if (i + BATCH_SIZE < texts.length) await sleep(1500);
  }
  return vectors;
}
