export function parseGeminiText(text) {
  let clean = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");

  if (start !== -1 && end !== -1) {
    clean = clean.slice(start, end + 1);
  }

  let obj;
  try {
    obj = JSON.parse(clean);
  } catch {
    throw new Error("Format hasil tidak terbaca");
  }

  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("Format hasil tidak terbaca");
  }

  const num = (v) => {
    const n = Number.parseInt(String(v == null ? "" : v).replace(/\D/g, ""), 10);
    return Number.isNaN(n) ? 0 : n;
  };
  const TIPE = ["none", "diskon", "member", "bulk", "gratis"];
  const WARNA = ["kuning", "merah", "putih", "lain"];
  const harga = num(obj.harga);
  const daftar = Array.isArray(obj.semuaHarga) ? obj.semuaHarga : [];
  const semuaHarga = [...new Set(daftar.map(num).filter((n) => n >= 100 && n <= 10000000))]
    .sort((a, b) => a - b)
    .slice(0, 6);
  return {
    nama: obj.nama == null ? "" : String(obj.nama),
    harga: harga === 0 ? "" : harga,
    promoTipe: TIPE.includes(obj.promoTipe) ? obj.promoTipe : "none",
    promoQty: num(obj.promoQty),
    beliQty: num(obj.beliQty),
    gratisQty: num(obj.gratisQty),
    hargaPromo: num(obj.hargaPromo),
    hargaNormal: num(obj.hargaNormal),
    syarat: String(obj.syarat == null ? "" : obj.syarat).trim().slice(0, 120),
    labelWarna: WARNA.includes(obj.labelWarna) ? obj.labelWarna : "lain",
    semuaHarga,
  };
}

export function classifyGeminiStatus(status) {
  if (status === 401 || status === 403) {
    return { kind: "disabled" };
  }

  if (status === 429) {
    return { kind: "rate_limited" };
  }

  if (status >= 500) {
    return { kind: "transient" };
  }

  return { kind: "permanent" };
}

export async function callGemini({ apiKey, imageBase64, model, fetchImpl = fetch }) {
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: promptText() },
              { inline_data: { mime_type: "image/jpeg", data: imageBase64 } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              nama: { type: "STRING" },
              harga: { type: "NUMBER" },
              promoTipe: { type: "STRING", enum: ["none", "diskon", "member", "bulk", "gratis"] },
              promoQty: { type: "NUMBER" },
              beliQty: { type: "NUMBER" },
              gratisQty: { type: "NUMBER" },
              hargaPromo: { type: "NUMBER" },
              hargaNormal: { type: "NUMBER" },
              syarat: { type: "STRING" },
              labelWarna: { type: "STRING", enum: ["kuning", "merah", "putih", "lain"] },
              semuaHarga: { type: "ARRAY", items: { type: "NUMBER" } },
            },
            required: ["nama", "harga"],
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const error = new Error("Gemini unavailable");
    error.status = response.status;
    error.classification = classifyGeminiStatus(response.status);
    throw error;
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return parseGeminiText(text);
}

function promptText() {
  return [
    "Baca label harga pada gambar. Balas HANYA JSON.",
    "Field: nama, harga, promoTipe, promoQty, beliQty, gratisQty, hargaPromo,",
    "hargaNormal, syarat, labelWarna, semuaHarga.",
    "ATURAN UTAMA: jangan menghitung apa pun. Laporkan hanya angka yang TERTULIS di label.",
    "harga = harga yang tertulis paling menonjol.",
    "semuaHarga = daftar SEMUA angka harga yang terbaca di label, apa adanya.",
    "labelWarna = warna dominan latar label: 'kuning' | 'merah' | 'putih' | 'lain'.",
    "syarat = kutip PERSIS teks syarat promo bila ada, misalnya \"Khusus Member AlfaGift\",",
    "\"Beli 2 Gratis 1\", \"Periode 1-15 Juli\". Kosongkan bila tak ada teks syarat.",
    "Pilih promoTipe:",
    "'none' = satu harga saja, tak ada tanda promo.",
    "'diskon' = ada harga coret + harga baru, TANPA syarat keanggotaan;",
    "hargaPromo = harga baru, hargaNormal = harga coret.",
    "'member' = HANYA bila label menuliskan syarat kartu/keanggotaan",
    "(Member, Kartu, AlfaGift, Ponta, JakOne, Bonus Card);",
    "hargaPromo = harga member, hargaNormal = harga non-member.",
    "'bulk' = pola 'N item = harga' atau 'N pcs Rp X';",
    "promoQty = N, hargaPromo = harga paket, hargaNormal = harga satuan bila tertera.",
    "'gratis' = pola 'Beli N Gratis M'; beliQty = N, gratisQty = M,",
    "hargaNormal = harga satuan. JANGAN hitung harga paketnya.",
    "PENTING: harga coret TIDAK otomatis berarti member.",
    "Tanpa tulisan keanggotaan, harga coret itu diskon.",
    "Field yang tak dipakai isi 0 atau string kosong.",
    "Angka tanpa titik/koma. Contoh: 16500 bukan 16.500.",
  ].join(" ");
}
