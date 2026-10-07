export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Faqat POST so\'rovlar qabul qilinadi' });

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

    const prompt = `
      You are an expert Cambridge IELTS Academic teacher.
      Analyze this Reading passage page image:
      1. Create a short, relevant TOPIC TITLE in CAPITAL LETTERS based on the passage (e.g. "WEANING & INFANT DIET", "URBAN MIGRATION").
      2. Extract 10 to 14 essential B2/C1 academic vocabulary words or collocations from this text.
      3. For each word give: word, IPA phonetic, English meaning, Uzbek meaning, exact sentence from the text, and 3 Uzbek distractors.

      Respond ONLY with valid JSON using this format:
      {
        "title": "TOPIC TITLE",
        "words": [
          {
            "word": "example",
            "phonetic": "/ɪɡˈzɑːmpl/",
            "en_meaning": "a representative form or pattern",
            "uz_meaning": "namuna, misol",
            "context_sentence": "This is an authentic sentence from the text.",
            "distractors": ["variant 1", "variant 2", "variant 3"]
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
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2
      }
    };

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

    let lastError = null;
    const maxRetries = 3;

    // High demand bo'lsa 3 martagacha avtomatik qayta so'rov yuborish
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok && data?.candidates?.[0]?.content?.parts?.[0]?.text) {
          const rawText = data.candidates[0].content.parts[0].text;
          
          // Aqlli JSON tozalash va o'qish (Hech qachon xato bermaydi)
          let parsedData = null;
          try {
            parsedData = JSON.parse(rawText);
          } catch (_) {
            const jsonMatch = rawText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
            if (jsonMatch) {
              parsedData = JSON.parse(jsonMatch[0]);
            }
          }

          if (parsedData) {
            // Agar model shunchaki massiv qaytarsa ham moslab beramiz
            if (Array.isArray(parsedData)) {
              return res.status(200).json({
                title: "IELTS READING PASSAGE",
                words: parsedData
              });
            }
            return res.status(200).json(parsedData);
          }
        }

        const msg = data?.error?.message || `Server javob bermadi (${response.status})`;
        lastError = msg;

        // Agar server band bo'lsa (high demand), biroz kutib yana urunadi
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1500 * attempt));
        }
      } catch (err) {
        lastError = err.message;
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1500 * attempt));
        }
      }
    }

    return res.status(500).json({ error: lastError || 'AI javob bermadi, qayta urinib ko\'ring' });

  } catch (error) {
    return res.status(500).json({ error: 'Server xatosi: ' + error.message });
  }
}
