## 科大讯飞 TTS Web Api Deno 封装

使用方式

```ts
import {
  TTSRequest,
  XfyunTTS,
} from "https://deno.land/x/xfyun-api/v0.0.1/mod.ts";

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
```
