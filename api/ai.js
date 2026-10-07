export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Faqat POST qabul qilinadi' });

  const rawKey = process.env.GEMINI_API_KEY;
  if (!rawKey) return res.status(500).json({ error: 'Vercel sozlamalarida GEMINI_API_KEY topilmadi' });
  const apiKey = rawKey.trim().replace(/^["']|["']$/g, '');

  const { image } = req.body;
  if (!image) return res.status(400).json({ error: 'Rasm yuborilmadi' });

  try {
    let cleanBase64 = image;
    let mimeType = 'image/jpeg';
    if (image.includes(';base64,')) {
      const parts = image.split(';base64,');
      mimeType = parts[0].replace('data:', '') || 'image/jpeg';
      cleanBase64 = parts[1];
    }

    const prompt = `Analyze this IELTS Reading passage page image carefully.
1. Determine the main theme and create a concise TOPIC TITLE in CAPITAL LETTERS (e.g. "WEANING & INFANT HEALTH", "URBAN MIGRATION").
2. Extract at least 10 to 14 essential B2/C1 academic vocabulary words or collocations from this text.
3. For each word give: word, IPA phonetic transcription, English meaning, accurate Uzbek translation, the authentic sentence from the text, and 3 incorrect Uzbek distractors.

Return ONLY a raw JSON object matching this schema:
{
  "title": "TOPIC TITLE",
  "words": [
    {
      "word": "mitigate",
      "phonetic": "/ˈmɪtɪɡeɪt/",
      "en_meaning": "To make something less severe",
      "uz_meaning": "yumshatmoq, ta'sirini kamaytirmoq",
      "context_sentence": "Authentic sentence from the text",
      "distractors": ["noto'g'ri 1", "noto'g'ri 2", "noto'g'ri 3"]
    }
  ]
}`;

    const payload = {
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { mimeType: mimeType, data: cleanBase64 } }
        ]
      }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    };

    // 1-o'rinda: gemini-3.5-flash-lite (Hujjatlarni o'qish uchun eng tezkor, yuklamasiz)
    // 2-o'rinda: gemini-3.8-flash (Zaxira)
    const modelsToTry = ['gemini-3.5-flash-lite', 'gemini-3.8-flash'];
    let lastError = null;

    for (const model of modelsToTry) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok && data?.candidates?.[0]?.content?.parts?.[0]?.text) {
          const rawText = data.candidates[0].content.parts[0].text;
          let parsed = null;
          try {
            parsed = JSON.parse(rawText);
          } catch (_) {
            const match = rawText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
            if (match) parsed = JSON.parse(match[0]);
          }

          if (parsed) {
            if (Array.isArray(parsed)) {
              return res.status(200).json({
                title: "IELTS READING PASSAGE",
                words: parsed
              });
            }
            return res.status(200).json(parsed);
          }
        }

        lastError = data?.error?.message || `Model ${model} xatosi (${response.status})`;
        
        // Agar bu model band bo'lsa, kutmasdan darhol zaxiradagisiga o'tadi
      } catch (err) {
        lastError = err.message;
      }
    }

    // Hech qanday behuda kutishlarsiz zudlik bilan javob qaytarish
    return res.status(500).json({ error: lastError || 'AI serveridan tezkor javob olinmadi' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
