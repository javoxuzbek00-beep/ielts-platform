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

  const { type, image, question, answer } = req.body;

  try {
    let payload;

    if (type === 'reading') {
      let cleanBase64 = image;
      let mimeType = 'image/jpeg';

      if (image && image.includes(';base64,')) {
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
            "context_sentence": "the full authentic sentence from the reading text where it appears",
            "distractors": ["noto'g'ri 1", "noto'g'ri 2", "noto'g'ri 3"]
          }
        ]
      `;

      payload = {
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
        generationConfig: { responseMimeType: "application/json" }
      };

    } else if (type === 'speaking') {
      const prompt = `
        You are Maya, an official IELTS Speaking examiner.
        Question: "${question}"
        Candidate Answer: "${answer}"

        Evaluate strictly according to IELTS Band Descriptors (Fluency, Lexical Resource, Grammar).
        Return ONLY a raw JSON object:
        {
          "band": 7.0,
          "feedback": "O'zbek tilida aniq va professional tahlil",
          "better_vocab": ["so'z 1", "so'z 2"],
          "native_rephrase": "Band 8.5 darajasida qayta yozilgan tabiiy versiyasi"
        }
      `;

      payload = {
        contents: [{
          role: "user",
          parts: [{ text: prompt }]
        }],
        generationConfig: { responseMimeType: "application/json" }
      };
    } else {
      return res.status(400).json({ error: 'Noto\'g\'ri so\'rov turi' });
    }

    // Navbat bilan sinab ko'riladigan zaxira modellar ro'yxati
    const fallbackModels = [
      'gemini-3.8-flash',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash-latest',
      'gemini-pro'
    ];

    let lastError = null;

    // Agar modelda "high demand" yoki yuklama bo'lsa, zaxiradagisiga avtomatik o'tadi
    for (const model of fallbackModels) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await response.json();

        // Agar so'rov muvaffaqiyatli o'tsa va natija kelsa
        if (response.ok && data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
          const rawText = data.candidates[0].content.parts[0].text;
          const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
          const result = JSON.parse(cleanJson);
          return res.status(200).json(result);
        }

        // Xatolik xabarini qayd qilamiz va keyingi modelga o'tamiz
        lastError = data?.error?.message || `Model (${model}) javob bermadi`;
      } catch (err) {
        lastError = err.message;
      }
    }

    return res.status(500).json({ error: lastError || 'Barcha AI serverlarda yuklama yuqori, birozdan so\'ng qayta urining' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
