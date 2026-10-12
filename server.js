import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- Baca file .env ----------
let envStatus = 'dotenv';
try {
  await import('dotenv/config');
} catch {
  try { process.loadEnvFile(); envStatus = 'node'; }   // Node 20.12+ / 21.7+
  catch { envStatus = 'GAGAL (jalankan: npm i dotenv)'; }
}

// ---------- Pengaturan ----------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim();
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite';

// Model cadangan (pisahkan dengan koma), dicoba kalau model utama sedang penuh/sibuk
const GEMINI_FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.6-flash,gemini-3.1-flash-lite')
  .split(',').map((m) => m.trim()).filter(Boolean);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';

// Provider dipilih otomatis dari isi .env, kecuali PROVIDER diisi manual
const PROVIDER = (
  process.env.PROVIDER || (GEMINI_API_KEY ? 'gemini' : OPENAI_API_KEY ? 'openai' : 'mock')
).toLowerCase();

// Kalau AI gagal (mis. 403), balas jawaban contoh + tampilkan error asli
// (set FALLBACK_MOCK=false di .env untuk mematikan dan melihat error murni)
const FALLBACK_MOCK = process.env.FALLBACK_MOCK !== 'false';

const PORT = process.env.PORT || 3000;
const VERSI = 'v-final-model-baru';

// ---------- Info sekolah (konteks untuk AI) ----------
// Edit teks ini untuk menambah info: visi misi, nomor telepon, PPDB, biaya, ekskul, dll.
const KONTEKS_SEKOLAH = `Kamu adalah asisten chat resmi SMK Muhammadiyah 1 Kota Sukabumi.
Jawab dalam bahasa Indonesia yang ramah, singkat, dan jelas (maksimal sekitar 5 kalimat, kecuali diminta rinci).
Jawab HANYA berdasarkan informasi di bawah. Jika informasi tidak tersedia (misalnya biaya, jadwal PPDB, nomor telepon), katakan belum ada informasinya dan sarankan menghubungi pihak sekolah langsung. Jangan mengarang.

DATA SEKOLAH:
- Nama: SMK Muhammadiyah 1 Kota Sukabumi (sekolah menengah kejuruan swasta, di bawah naungan Muhammadiyah)
- Akreditasi: A
- Alamat: Jl. Syamsudin SH No. 59, Kota Sukabumi, Jawa Barat
- Jurusan:
  1. PPLG - Pengembangan Perangkat Lunak dan Gim: membuat aplikasi, website, dan gim
  2. AKL - Akuntansi dan Keuangan Lembaga: pencatatan keuangan, laporan, perpajakan
  3. TJKT - Teknik Jaringan Komputer dan Telekomunikasi: jaringan, server, keamanan sistem
  4. MPLB - Manajemen Perkantoran dan Layanan Bisnis: administrasi, kearsipan, pelayanan bisnis
  5. Keperawatan: dasar perawatan pasien dan kesehatan masyarakat
- Fasilitas: 13 ruang kelas, 4 laboratorium komputer, 1 laboratorium bahasa, 1 perpustakaan`;

// Membaca info_sekolah.txt setiap kali ada pertanyaan, jadi setelah file diedit TIDAK perlu restart server.
// Baris yang diawali tanda # dianggap catatan dan tidak dikirim ke AI.
function ambilKonteks() {
  try {
    const teks = fs.readFileSync(path.join(__dirname, 'info_sekolah.txt'), 'utf8')
      .split('\n').filter((b) => !b.trim().startsWith('#')).join('\n').trim();
    if (teks) return teks;
  } catch (e) { /* file belum ada, pakai cadangan di bawah */ }
  return KONTEKS_SEKOLAH;
}


// ---------- Setup ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));   // web ada di folder public/

let gemini = null;
if (PROVIDER === 'gemini') {
  if (!GEMINI_API_KEY) { console.error('GEMINI_API_KEY kosong di .env'); process.exit(1); }
  const { GoogleGenAI } = await import('@google/genai');
  gemini = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
} else if (PROVIDER === 'openai') {
  if (!OPENAI_API_KEY) { console.error('OPENAI_API_KEY kosong di .env'); process.exit(1); }
} else if (PROVIDER !== 'mock') {
  console.error(`PROVIDER tidak dikenal: "${PROVIDER}". Pilih: mock, gemini, atau openai.`);
  process.exit(1);
}

// ---------- Fungsi bantu ----------
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function ambilTeks(file) {
  const nama = file.originalname.toLowerCase();
  if (file.mimetype === MIME_DOCX || nama.endsWith('.docx')) {
    const mammoth = (await import('mammoth')).default;
    const { value } = await mammoth.extractRawText({ buffer: file.buffer });
    return value;
  }
  if (file.mimetype.startsWith('text/') || nama.endsWith('.txt')) return file.buffer.toString('utf-8');
  return null;
}

const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const sementara = (e) =>
  [429, 500, 503].includes(e?.status) || /UNAVAILABLE|high demand|overloaded/i.test(e?.message || '');

// Coba model utama; kalau sibuk (503/429) ulangi beberapa kali, lalu pindah ke model cadangan
async function panggilGemini(contents) {
  const daftarModel = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS];
  let errorTerakhir;
  for (const model of daftarModel) {
    for (let percobaan = 1; percobaan <= 2; percobaan++) {
      try {
        const hasil = await gemini.models.generateContent({ model, contents, config: { systemInstruction: ambilKonteks() } });
        return hasil.text;
      } catch (error) {
        errorTerakhir = error;
        if (!sementara(error)) throw error;            // error permanen (403, 404, dll): langsung gagal
        console.warn(`Model ${model} sibuk (percobaan ${percobaan}/2), coba lagi...`);
        if (percobaan < 2) await tidur(1500);
      }
    }
  }
  throw errorTerakhir;
}

async function panggilOpenAI(messages) {
  const resp = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: OPENAI_MODEL, messages: [{ role: 'system', content: ambilKonteks() }, ...messages] }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(data?.error?.message || `HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return data.choices?.[0]?.message?.content ?? '';
}

// Dipakai di catch: fallback ke jawaban contoh, atau kirim error asli
function tanganiError(res, field, teksMock, pesan, error) {
  console.error(pesan, '->', error?.message ?? error);
  if (FALLBACK_MOCK) {
    return res.status(200).json({
      [field]: teksMock,
      mock: true,
      fallback: true,
      catatan: 'AI gagal dipanggil, ini jawaban contoh. Lihat error_asli.',
      error_asli: error?.message ?? String(error),
    });
  }
  const status = Number.isInteger(error?.status) && error.status >= 400 ? error.status : 500;
  res.status(status).json({ error: pesan, detail: error?.message ?? String(error) });
}

// ---------- Routes ----------
app.get('/status', (req, res) => {
  res.json({ status: 'ok', versi: VERSI, provider: PROVIDER, fallback_mock: FALLBACK_MOCK });
});

// 1. Teks
app.post('/tanya-ai', async (req, res) => {
  const { pertanyaan } = req.body ?? {};
  if (!pertanyaan || typeof pertanyaan !== 'string' || !pertanyaan.trim()) {
    return res.status(400).json({ error: 'Pertanyaan wajib diisi!' });
  }
  const teksMock = `[MOCK] Kamu bertanya: "${pertanyaan}". Ini jawaban contoh.`;

  try {
    if (PROVIDER === 'mock') return res.json({ jawaban: teksMock, mock: true });
    if (PROVIDER === 'gemini') {
      return res.json({ jawaban: await panggilGemini(pertanyaan) });
    }
    res.json({ jawaban: await panggilOpenAI([{ role: 'user', content: pertanyaan }]) });
  } catch (error) {
    tanganiError(res, 'jawaban', teksMock, 'Gagal memproses permintaan AI', error);
  }
});

// 2. Gambar
app.post('/analisis-gambar', upload.single('gambar'), async (req, res) => {
  const instruksi = req.body?.instruksi || 'Jelaskan gambar ini';
  if (!req.file) return res.status(400).json({ error: 'Berkas gambar wajib diunggah!' });
  if (!req.file.mimetype.startsWith('image/')) {
    return res.status(400).json({ error: 'Berkas harus berupa gambar (jpg, png, dll)!' });
  }
  const teksMock = `[MOCK] Instruksi: "${instruksi}". File: ${req.file.originalname} (${req.file.mimetype}, ${req.file.size} byte).`;

  try {
    if (PROVIDER === 'mock') return res.json({ analisis: teksMock, mock: true });
    const base64 = req.file.buffer.toString('base64');
    if (PROVIDER === 'gemini') {
      const analisis = await panggilGemini([
        instruksi,
        { inlineData: { data: base64, mimeType: req.file.mimetype } },
      ]);
      return res.json({ analisis });
    }
    const analisis = await panggilOpenAI([{
      role: 'user',
      content: [
        { type: 'text', text: instruksi },
        { type: 'image_url', image_url: { url: `data:${req.file.mimetype};base64,${base64}` } },
      ],
    }]);
    res.json({ analisis });
  } catch (error) {
    tanganiError(res, 'analisis', teksMock, 'Gagal menganalisis gambar', error);
  }
});

// 3. Dokumen (pdf, docx, txt)
app.post('/analisis-dokumen', upload.single('dokumen'), async (req, res) => {
  const instruksi = req.body?.instruksi || 'Ringkas dokumen ini';
  if (!req.file) return res.status(400).json({ error: 'Berkas dokumen wajib diunggah!' });
  const teksMock = `[MOCK] Instruksi: "${instruksi}". Dokumen: ${req.file.originalname} (${req.file.mimetype}, ${req.file.size} byte).`;

  try {
    if (PROVIDER === 'mock') return res.json({ analisis: teksMock, mock: true });

    const teks = await ambilTeks(req.file);
    const isPdf = req.file.mimetype === 'application/pdf' || req.file.originalname.toLowerCase().endsWith('.pdf');

    if (PROVIDER === 'gemini') {
      let contents;
      if (teks !== null) contents = [instruksi, `Isi dokumen:\n${teks}`];
      else if (isPdf) contents = [instruksi, { inlineData: { data: req.file.buffer.toString('base64'), mimeType: 'application/pdf' } }];
      else return res.status(400).json({ error: 'Format tidak didukung. Gunakan PDF, DOCX, atau TXT.' });
      return res.json({ analisis: await panggilGemini(contents) });
    }

    if (teks === null) {
      return res.status(400).json({ error: 'Provider ini hanya mendukung DOCX atau TXT.' });
    }
    res.json({ analisis: await panggilOpenAI([{ role: 'user', content: `${instruksi}\n\nIsi dokumen:\n${teks}` }]) });
  } catch (error) {
    tanganiError(res, 'analisis', teksMock, 'Gagal menganalisis dokumen', error);
  }
});

app.listen(PORT, () => {
  console.log('==============================================');
  console.log(`Server  : http://localhost:${PORT} (${VERSI})`);
  console.log(`.env    : ${envStatus}`);
  console.log(`Provider: ${PROVIDER}${PROVIDER === 'gemini' ? ` (model ${GEMINI_MODEL}, key ...${GEMINI_API_KEY.slice(-4)})` : PROVIDER === 'openai' ? ` (model ${OPENAI_MODEL}, key ...${OPENAI_API_KEY.slice(-4)})` : ''}`);
  console.log(`Fallback: ${FALLBACK_MOCK ? 'aktif' : 'mati'}`);
  console.log('==============================================');
});