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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Serverda GEMINI_API_KEY topilmadi. Vercel sozlamalarini tekshiring.' });
  }

  const { type, image, question, answer } = req.body;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  try {
    let payload;

    if (type === 'reading') {
      const cleanBase64 = image.includes(',') ? image.split(',')[1] : image;
      const prompt = `
        Analyze this IELTS Reading passage page image carefully.
        Extract the 8 to 12 most important B2/C1 academic vocabulary words or collocations.
        Return ONLY a raw JSON array matching this exact schema, with NO Markdown wrapping:
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
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: "image/jpeg",
                data: cleanBase64
              }
            }
          ]
        }],
        generationConfig: { response_mime_type: "application/json" }
      };

    } else if (type === 'speaking') {
      const prompt = `
        You are Maya, a strict and professional official IELTS Speaking examiner.
        The question was: "${question}"
        The candidate answered: "${answer}"

        Evaluate strictly according to IELTS Band Descriptors:
        1. Fluency & Coherence
        2. Lexical Resource
        3. Grammatical Range & Accuracy
        4. Pronunciation clarity

        Return ONLY a raw JSON object with this exact schema:
        {
          "band": 7.0,
          "feedback": "O'zbek tilida juda aniq, do'stona va professional xatolar tahlili",
          "better_vocab": ["tavsiya 1", "tavsiya 2", "tavsiya 3"],
          "native_rephrase": "Band 8.5 darajasida qayta ifodalangan mukammal tabiiy variant"
        }
      `;

      payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json" }
      };
    } else {
      return res.status(400).json({ error: 'Noto\'g\'ri so\'rov turi' });
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
      return res.status(500).json({ error: 'Gemini tahlil qila olmadi', details: data });
    }

    const rawText = data.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(rawText);
    return res.status(200).json(parsed);

  } catch (error) {
    console.error("AI Error:", error);
    return res.status(500).json({ error: 'Ichki server xatoligi: ' + error.message });
  }
}
