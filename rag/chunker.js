// rag/chunker.js
// Memecah dokumen Markdown menjadi potongan (chunk) per sub-judul "##".
// Bagian yang terlalu panjang dipecah lagi per baris, dengan overlap 1 baris.

const MAX_CHARS = 800;

export function chunkMarkdown(text, source) {
  const chunks = [];
  const sections = text.split(/^##\s+/m).map((s) => s.trim()).filter(Boolean);

  for (const section of sections) {
    // bagian paling awal (judul "# ...") tidak punya isi sendiri, lewati
    if (/^#\s/.test(section) && !section.includes('\n')) continue;
    const [firstLine, ...rest] = section.split('\n');
    if (/^#\s/.test(firstLine)) continue;
    const heading = firstLine.replace(/^#+\s*/, '').trim();
    const body = rest.join('\n').trim();
    if (!body) continue;

    for (const part of splitLong(body, MAX_CHARS)) {
      chunks.push({ source, heading, text: `${heading}\n${part}` });
    }
  }
  return chunks;
}

function splitLong(body, max) {
  if (body.length <= max) return [body];
  const lines = body.split('\n').filter((l) => l.trim() !== '');
  const parts = [];
  let current = [];
  let size = 0;
  for (const line of lines) {
    if (size + line.length > max && current.length > 0) {
      parts.push(current.join('\n'));
      current = [current[current.length - 1]];
      size = current[0].length;
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length > 0) parts.push(current.join('\n'));
  return parts;
}
