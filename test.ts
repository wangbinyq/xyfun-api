import * as assert from "https://deno.land/std@0.147.0/testing/asserts.ts";
import * as base64 from "https://deno.land/std@0.147.0/encoding/base64.ts";
import { XFYun } from "./xfyun.ts";

const APP_ID = Deno.env.get("appid") || "";
const API_KEY = Deno.env.get("apikey") || "";
const API_SECRET = Deno.env.get("apisecret") || "";

Deno.test("xfyun api", async () => {
  const xfyun = new XFYun({
    appid: APP_ID,
    apisecret: API_SECRET,
    apikey: API_KEY,
  });

  const connection = await xfyun.connect(
    "tts-api.xfyun.cn",
    "/v2/tts",
  );
  connection.send({
    business: {
      aue: "lame",
      sfl: 1,
      vcn: "xiaoyan",
      tte: "UTF8",
    },
    data: {
      text: base64.encode("你好, 你好, 你们好"),
      status: 2,
    },
  });

  let byteLength = 0;
  for await (const data of connection) {
    const buf = base64.decode(data.data.audio);
    byteLength += buf.byteLength;
    assert.assertEquals(data.code, 0);
  }
  assert.assertEquals(byteLength, 15984);

  await connection.close();

  assert.assertEquals(connection.ws.readyState, WebSocket.CLOSED);
});

Deno.test("xfyun tts", async () => {
  const xfyun = new XFYun({
    appid: APP_ID,
    apisecret: API_SECRET,
    apikey: API_KEY,
  });

  let byteLength = 0;

  for await (
    const voice of xfyun.tts({
      aue: "lame",
      sfl: 1,
      text: "你好, 你好, 你们好",
      vcn: "xiaoyan",
      tte: "UTF8",
    })
  ) {
    byteLength += voice.byteLength;
  }

  assert.assertEquals(byteLength, 15984);
});

Deno.test("xfyun iat", async () => {
  const xfyun = new XFYun({
    appid: APP_ID,
    apisecret: API_SECRET,
    apikey: API_KEY,
  });

  const audio = await Deno.open("./16k_10.pcm");

  let result = "";

  for await (
    const data of xfyun.iat({
      language: "zh_cn",
      domain: "iat",
      accent: "mandarin",
      dwa: "wpgs", // 可选参数，动态修正

      format: "audio/L16;rate=16000",
      encoding: "raw",
      audio: audio.readable,
    })
  ) {
    result += data.data.result.ws.flatMap((ws) =>
      ws.cw.map((cw) => cw.w).join("")
    )
      .join("");
  }

  assert.assertEquals(
    result,
    `4月13日，中国台北选手戴资颖在比赛中发球，当日在新加坡室内体育场举行的新加坡羽毛球公开赛，女子单打半决赛中，中国台北选手戴资颖以2:1战胜日本选手山口茜，晋级决赛。`,
  );
});
