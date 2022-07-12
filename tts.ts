import { deferred } from "https://deno.land/std@0.147.0/async/deferred.ts";
import * as bytes from "https://deno.land/std@0.147.0/bytes/mod.ts";
import { getLogger } from "https://deno.land/std@0.147.0/log/mod.ts";
import * as base64 from "https://deno.land/std@0.147.0/encoding/base64.ts";

import { hmac } from "https://deno.land/x/hmac@v2.0.1/mod.ts";

const TTSReg = ["auto", "alphabet", "auto-alphabet"] as const;
const TTSRdn = ["auto", "number", "string", "string-first"] as const;

const logger = getLogger("xfyun.tts");

export type TTSConfig = {
  appid: string;
  apisecret: string;
  apikey: string;
};

export type TTSRequest = {
  text: string;
  aue: string;
  sfl?: number;
  auf?: string;
  vcn: string;
  speed?: number;
  volume?: string;
  pitch?: string;
  bgs?: boolean;
  tte?: "GB2312" | "GBK" | "BIG5" | "UNICODE" | "GB18030" | "UTF8";
  reg?: typeof TTSReg[number];
  rdn?: typeof TTSRdn[number];
};

export class XfyunTTS {
  static HOST = "tts-api.xfyun.cn";
  static PATH = "/v2/tts";
  private appid: string;
  private apisecret: string;
  private apikey: string;

  constructor(
    {
      appid,
      apisecret,
      apikey,
    }: TTSConfig,
  ) {
    this.appid = appid;
    this.apisecret = apisecret;
    this.apikey = apikey;
  }

  private get ws_url(): string {
    const host = XfyunTTS.HOST;
    const path = XfyunTTS.PATH;
    const date = new Date().toUTCString();
    const signature_origin =
      `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
    const signature = hmac(
      "sha256",
      this.apisecret,
      signature_origin,
      "utf-8",
      "base64",
    );
    const authorization_origin =
      `api_key="${this.apikey}",algorithm="hmac-sha256",headers="host date request-line",signature="${signature}"`;
    const authorization = base64.encode(authorization_origin);

    const url = new URL(path, "wss://" + host);

    url.searchParams.set("host", host);
    url.searchParams.set("date", date);
    url.searchParams.set("authorization", authorization);

    return url.toString();
  }

  async request(req: TTSRequest): Promise<Uint8Array> {
    const ws = new WebSocket(this.ws_url);
    const connecting = deferred();
    const closing = deferred();
    const result = deferred<Uint8Array>();
    const bufs: Uint8Array[] = [];

    ws.onerror = (ev) => {
      if (connecting.state === "pending") {
        connecting.reject(ev);
      }
    };

    ws.onopen = () => {
      if (connecting.state === "pending") {
        connecting.resolve();
      }
    };

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.code === 0) {
          const buf = base64.decode(data.data.audio);
          bufs.push(buf);
          logger.debug(`tss get voice data length: ${buf.byteLength}`);
          if (data.data.status === 2) {
            const buf = bytes.concat(...bufs);
            logger.debug(
              `tss get voice data finished, total bytes: ${buf.byteLength}`,
            );
            ws.close();
            result.resolve(buf);
          }
        } else {
          throw new Error(data.message, { cause: data });
        }
      } catch (err) {
        ws.close();
        result.reject(err);
      }
    };

    ws.onclose = () => closing.resolve();

    await connecting;

    const { text, ...raw_business } = req;

    const business = {
      tte: "UTF8",
      ...raw_business,
      bgs: raw_business.bgs ? 1 : 0,
      reg: undefined as string | undefined,
      rdn: undefined as string | undefined,
    };

    if (raw_business.reg) {
      const idx = TTSReg.indexOf(raw_business.reg);
      if (idx >= 0) {
        business.reg = "" + TTSReg.indexOf(raw_business.reg);
      }
    }

    if (raw_business.rdn) {
      const idx = TTSRdn.indexOf(raw_business.rdn);
      if (idx >= 0) {
        business.rdn = "" + TTSRdn.indexOf(raw_business.rdn);
      }
    }

    logger.debug("tts request business data: \n" + JSON.stringify(business));

    ws.send(JSON.stringify({
      common: {
        app_id: this.appid,
      },
      business,
      data: {
        text: base64.encode(text),
        status: 2,
      },
    }));

    await closing;
    const buf = await result;
    return buf;
  }
}
