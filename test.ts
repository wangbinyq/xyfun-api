import * as assert from "https://deno.land/std@0.147.0/testing/asserts.ts";
import { TTSRequest, XfyunTTS } from "./mod.ts";

const APP_ID = Deno.env.get("appid") || "";
const API_KEY = Deno.env.get("apikey") || "";
const API_SECRET = Deno.env.get("apisecret") || "";

Deno.test("connect", async () => {
  const tts = new XfyunTTS({
    appid: APP_ID,
    apisecret: API_SECRET,
    apikey: API_KEY,
  });

  const req: TTSRequest = {
    aue: "lame",
    sfl: 1,
    text: "你好, 你好, 你们好",
    vcn: "xiaoyan",
  };

  const res = await tts.request(req);

  assert.assertEquals(res.byteLength, 15984);
});
