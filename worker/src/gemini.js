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

  const harga = Number.parseInt(String(obj.harga).replace(/\D/g, ""), 10);
  return {
    nama: obj.nama || "",
    harga: Number.isNaN(harga) ? "" : harga,
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
  return "Baca label harga pada gambar. Balas hanya JSON dengan field nama dan harga angka rupiah.";
}
