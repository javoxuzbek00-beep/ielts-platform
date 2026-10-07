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
    // 1. Google'dan sizning kalitingizda aynan qaysi modellar faolligini olamiz
    const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const listData = await listRes.json();

    if (!listRes.ok || listData.error) {
      return res.status(500).json({
        error: `Google API xatosi: ${listData?.error?.message || 'Kalit tekshirilmadi'}`
      });
    }

    const models = listData.models || [];
    // generateContent'ni qo'llab-quvvatlaydigan modellarni saralaymiz
    const usableModels = models.filter(m => m.supportedGenerationMethods?.includes('generateContent'));

    if (usableModels.length === 0) {
      return res.status(500).json({ error: 'Ushbu kalitda generateContent model topilmadi' });
    }

    // Birinchi o'rinda Flash modelini, bo'lmasa mavjud birinchisini tanlaymiz
    const selectedModel = usableModels.find(m => m.name.toLowerCase().includes('flash')) || usableModels[0];
    const modelPath = selectedModel.name; // masalan: "models/gemini-2.0-flash" yoki "models/gemini-flash-latest"

    // 2. So'rov matnini tayyorlash
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

    // 3. Google ro'yxatidan olingan aniq modelga so'rov yuborish
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${apiKey}`;
    const genRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const genData = await genRes.json();
    if (!genRes.ok || genData.error) {
      return res.status(500).json({ error: genData?.error?.message || 'AI tahlilida xatolik yuz berdi' });
    }

    const rawText = genData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return res.status(500).json({ error: 'AI javob qaytara olmadi' });
    }

    const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const result = JSON.parse(cleanJson);
    return res.status(200).json(result);

  } catch (error) {
    return res.status(500).json({ error: 'Xatolik: ' + error.message });
  }
}
