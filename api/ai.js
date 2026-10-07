export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Faqat POST qabul qilinadi' });

  const rawKey = process.env.GEMINI_API_KEY;
  if (!rawKey) return res.status(500).json({ error: 'GEMINI_API_KEY topilmadi' });
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

    const prompt = `
      You are an expert Cambridge IELTS Academic trainer.
      Analyze this Reading passage page image with extreme precision:
      1. Determine the main theme of the text and create a concise, professional, punchy topic title in CAPITAL LETTERS (e.g., "WEANING & INFANT DIET", "URBAN SPRAWL & INFRASTRUCTURE", "BIOMIMETICS IN MODERN DESIGN").
      2. Extract AT LEAST 10 to 15 of the most crucial B2/C1 academic vocabulary words or collocations from the text.
      3. For each word, provide:
         - exact word/phrase
         - accurate IPA phonetic transcription
         - clear definition in English
         - exact, accurate Uzbek translation
         - authentic context sentence directly from the reading text
         - 3 plausible but incorrect Uzbek distractors for quizzes.

      Return ONLY a raw JSON object with this exact schema:
      {
        "title": "CAPITALIZED TOPIC TITLE",
        "words": [
          {
            "word": "mitigate",
            "phonetic": "/ˈmɪtɪɡeɪt/",
            "en_meaning": "To make something less severe, serious, or painful",
            "uz_meaning": "yumshatmoq, ta'sirini kamaytirmoq",
            "context_sentence": "The council took urgent measures to mitigate environmental hazards.",
            "distractors": ["kuchaytirmoq", "paydo qilmoq", "yo'qotib yubormoq"]
          }
        ]
      }
    `;

    const payload = {
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { mimeType: mimeType, data: cleanBase64 } }
        ]
      }],
      generationConfig: { responseMimeType: "application/json" }
    };

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
        if (response.ok && data?.candidates?.[0]?.content?.parts?.[0]?.text) {
          const rawText = data.candidates[0].content.parts[0].text;
          const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
          return res.status(200).json(JSON.parse(cleanJson));
        }

        const msg = data?.error?.message || '';
        lastError = msg;
        if (msg.includes('high demand') || msg.includes('overloaded') || response.status === 503 || response.status === 404) {
          continue;
        }
      } catch (err) {
        lastError = err.message;
      }
    }

    return res.status(500).json({ error: lastError || 'AI serverlarida yuklama yuqori, qayta urining' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
