// api/analyze-place-image.js
//
// 업로드한 식당 사진을 OpenAI Vision(gpt-4o-mini)로 분석해서
// 이름/카테고리/가격대/주소/영업시간을 자동으로 뽑아내는 서버 함수입니다.
//
// 중요: OPENAI_API_KEY는 여기(서버)에서만 씁니다. 절대 프론트엔드 코드에 넣지 마세요.
// Vercel 배포 시 Project Settings > Environment Variables 에 OPENAI_API_KEY를 등록하세요.
//
// 클라이언트가 사진 파일을 직접 base64로 바꿔서 JSON으로 보내는 방식입니다.
// (멀티파트 폼데이터를 서버에서 직접 파싱하는 방식은 손으로 짠 파서가 깨지기 쉬워서
// 더 안정적인 이 방식으로 바꿨습니다.)

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST 요청만 지원해요." });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "서버에 OPENAI_API_KEY가 설정되어 있지 않아요." });
  }

  try {
    const { imageBase64, mimeType } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: "이미지 데이터가 없어요." });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "이 이미지는 식당/카페 스크린샷이에요. 아래 JSON 형식으로만 답변하세요 (다른 설명 없이, 마크다운 코드블록 없이):\n" +
                  '{"name": "가게 이름", "category": "음식 종류", "price": "가격대", "address": "주소", "hours": "영업시간"}\n' +
                  "정보를 알 수 없는 항목은 빈 문자열로 채워주세요.",
              },
              {
                type: "image_url",
                image_url: { url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}` },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI API 에러:", errText);
      return res.status(502).json({ error: "이미지 분석 API 호출에 실패했어요." });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "{}";

    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      return res.status(500).json({ error: "분석 결과를 해석하지 못했어요." });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "이미지 분석 중 오류가 발생했어요." });
  }
}
