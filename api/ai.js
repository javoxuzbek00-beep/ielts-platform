export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Faqat POST so\'rovlar qabul qilinadi' });
  }

  const rawKey = process.env.GEMINI_API_KEY;
  if (!rawKey) {
    return res.status(500).json({ error: 'Vercel sozlamalarida GEMINI_API_KEY topilmadi' });
  }
  const apiKey = rawKey.trim().replace(/^["']|["']$/g, '');

  const { image } = req.body;
  if (!image) {
    return res.status(400).json({ error: 'Rasm yuborilmadi' });
  }

  try {
    let cleanBase64 = image;
    let mimeType = 'image/jpeg';

    if (image.includes(';base64,')) {
      const parts = image.split(';base64,');
      mimeType = parts[0].replace('data:', '') || 'image/jpeg';
      cleanBase64 = parts[1];
    }

    const prompt = `
      Analyze this IELTS Reading passage page image carefully.
      Extract the 8 to 12 most important B2/C1 academic vocabulary words or collocations.
      Return ONLY a raw JSON array matching this exact schema:
      [
        {
          "word": "word or phrase",
          "phonetic": "/.../",
          "en_meaning": "clear definition in simple English",
          "uz_meaning": "aniq o'zbekcha ma'nosi",
          "context_sentence": "the authentic sentence from the reading text where it appears",
          "distractors": ["noto'g'ri 1", "noto'g'ri 2", "noto'g'ri 3"]
        }
      ]
    `;

    const payload = {
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: mimeType,
              data: cleanBase64
            }
          }
        ]
      }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    };

    // Google'ning eng so'nggi 3-avlod modellari zanjiri
    // Biri band (High demand) bo'lsa, zudlik bilan keyingisiga o'tadi
    const modelsChain = [
      'gemini-3.8-flash',
      'gemini-3.1-flash-lite',
      'gemini-3.7-flash',
      'gemini-3-flash-preview'
    ];

    let lastError = null;

    for (const model of modelsChain) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await response.json();

        // Muvaffaqiyatli javob kelsa — darhol foydalanuvchiga qaytaramiz
        if (response.ok && data?.candidates?.[0]?.content?.parts?.[0]?.text) {
          const rawText = data.candidates[0].content.parts[0].text;
          const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
          const result = JSON.parse(cleanJson);
          return res.status(200).json(result);
        }

        const msg = data?.error?.message || '';
        lastError = msg;

        // Agar bu model band (high demand) yoki topilmagan bo'lsa, kutmasdan keyingisiga o'tamiz
        if (msg.includes('high demand') || msg.includes('overloaded') || response.status === 503 || response.status === 404) {
          continue;
        }

      } catch (err) {
        lastError = err.message;
      }
    }

    return res.status(500).json({ error: lastError || 'Barcha AI serverlar band, 1 daqiqadan so\'ng qayta urining' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
