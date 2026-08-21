// api/analyze-place-image.js
//
// 업로드한 식당 사진(1장 또는 여러 장)을 OpenAI Vision(gpt-4o-mini)로 분석해서
// 이름/카테고리/가격대/주소/영업시간을 자동으로 뽑아내는 서버 함수입니다.
//
// 중요: OPENAI_API_KEY는 여기(서버)에서만 씁니다. 절대 프론트엔드 코드에 넣지 마세요.
// Vercel 배포 시 Project Settings > Environment Variables 에 OPENAI_API_KEY를 등록하세요.
//
// 클라이언트가 사진 파일을 압축한 뒤 base64로 바꿔서 JSON으로 보내는 방식입니다.
// (멀티파트 폼데이터를 서버에서 직접 파싱하는 방식은 손으로 짠 파서가 깨지기 쉬워서
// 더 안정적인 이 방식으로 바꿨습니다.)
//
// 여러 장을 한 번에 보내면(간판 사진 + 메뉴판 + 내부 사진 등, 전부 같은 식당) 훨씬
// 정확해요. 한 장씩 따로 분석하면 상호명이 안 보이는 사진(메뉴 클로즈업 등) 때문에
// AI가 엉뚱한 식당을 추측할 수 있는데, 여러 장을 같이 보여주면 그럴 일이 줄어듭니다.

// 기본 실행 제한(10초)이 넘으면 응답 없이 그냥 끊겨서(500, 본문 없음) 에러 원인을
// 알기도 힘든데, 사진 여러 장을 GPT Vision으로 분석하면 10초를 넘기기 쉬워서 늘려둠
export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST 요청만 지원해요." });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "서버에 OPENAI_API_KEY가 설정되어 있지 않아요." });
  }

  try {
    // 여러 장: { images: [{ imageBase64, mimeType }, ...] }
    // 한 장만(구버전 호환): { imageBase64, mimeType }
    const body = req.body || {};
    const images = Array.isArray(body.images) && body.images.length > 0 ? body.images : body.imageBase64 ? [body] : [];

    if (images.length === 0) {
      return res.status(400).json({ error: "이미지 데이터가 없어요." });
    }

    const imageContentBlocks = images.map((img) => ({
      type: "image_url",
      image_url: { url: `data:${img.mimeType || "image/jpeg"};base64,${img.imageBase64}` },
    }));

    const instructionText =
      images.length > 1
        ? `이 이미지 ${images.length}장은 모두 같은 식당/카페를 찍은 사진이에요(간판, 메뉴판, 내부 등). ` +
          "여러 장을 종합해서 하나의 식당 정보로 답변하세요. " +
          "아래 JSON 형식으로만 답변하세요 (다른 설명 없이, 마크다운 코드블록 없이):\n" +
          '{"name": "가게 이름", "category": "음식 종류", "price": "가격대", "address": "주소", "hours": "영업시간"}\n' +
          "정보를 알 수 없는 항목은 빈 문자열로 채워주세요. 상호명이 사진에 명확히 안 보이면 " +
          "절대 추측해서 다른 식당 이름을 지어내지 말고 빈 문자열로 두세요."
        : "이 이미지는 식당/카페 스크린샷이에요. 아래 JSON 형식으로만 답변하세요 (다른 설명 없이, 마크다운 코드블록 없이):\n" +
          '{"name": "가게 이름", "category": "음식 종류", "price": "가격대", "address": "주소", "hours": "영업시간"}\n' +
          "정보를 알 수 없는 항목은 빈 문자열로 채워주세요. 상호명이 사진에 명확히 안 보이면 " +
          "절대 추측해서 다른 식당 이름을 지어내지 말고 빈 문자열로 두세요.";

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
            content: [{ type: "text", text: instructionText }, ...imageContentBlocks],
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
