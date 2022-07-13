import {
  deadline,
  deferred,
  delay,
} from "https://deno.land/std@0.148.0/async/mod.ts";
import * as bytes from "https://deno.land/std@0.148.0/bytes/mod.ts";
import { getLogger } from "https://deno.land/std@0.148.0/log/mod.ts";
import * as base64 from "https://deno.land/std@0.148.0/encoding/base64.ts";
import { hmac } from "https://deno.land/x/hmac@v2.0.1/mod.ts";
import { EventIterator } from "https://esm.sh/event-iterator@2.0.0";

const logger = getLogger("xfyun.tts");

export class XFYunConnectionClosed extends Error {}

export type XFYunConfig = {
  appid: string;
  apisecret: string;
  apikey: string;
};

export type XFYunRequest<D = unknown, B = unknown> = {
  business?: B;
  data: D;
};

export type XFYunResponse<D = any> = {
  code: number;
  message: string;
  data: {
    status: 0 | 1 | 2;
  } & D;
  sid?: string;
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
  reg?: "0" | "1" | "2";
  rdn?: "0" | "1" | "2" | "3";
};

export type IATRequest = {
  type?: "default" | "niche";
  // business
  language: string;
  domain:
    | "iat"
    | "medical"
    | "gov-seat-assistant"
    | "gov-ansys"
    | "gov-nav"
    | "fin-nav"
    | "fin-ansys";
  accent: string;
  vad_eos?: number;
  dwa?: "wpgs";
  pd?: "game" | "health" | "shopping" | "trip";
  ptt?: 0 | 1;
  rlang?: "zh-cn" | "zh-hk";
  vinfo?: 0 | 1;
  nunum?: 0 | 1;
  speex_size?: number;
  nbest?: number;
  wbest?: number;

  // data
  format: string;
  encoding: string;
  audio: ReadableStream<Uint8Array>;
};

export type IATResponse = XFYunResponse<{
  result: {
    sn: number;
    ls: boolean;
    bg: number;
    ed: number;
    ws: {
      bg: number;
      cw: { w: string }[];
    }[];
  };
}>;

export interface XFYunConnection {
  [Symbol.asyncIterator]: () => AsyncIterator<XFYunResponse>;
  ws: WebSocket;
  send: <D = unknown, B = unknown>(request: XFYunRequest<D, B>) => void;
  close: () => Promise<void>;
}

export class XFYun {
  private appid: string;
  private apisecret: string;
  private apikey: string;

  constructor(
    {
      appid,
      apisecret,
      apikey,
    }: XFYunConfig,
  ) {
    this.appid = appid;
    this.apisecret = apisecret;
    this.apikey = apikey;
  }

  private get_ws_url(
    host: string,
    path: string,
  ): URL {
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

    return url;
  }

  async connect(
    host: string,
    path: string,
    timeout?: number,
  ): Promise<XFYunConnection> {
    const connected = deferred<XFYunConnection>();
    const url = this.get_ws_url(host, path);
    const ws = new WebSocket(url.toString());

    const onopen = () => {
      logger.debug(`connected to ${url}`);
      connected.resolve();
    };

    const onerror = (err: Event) => {
      logger.error(`failed to connect to ${url}`);
      connected.reject(err);
    };
    ws.addEventListener("open", onopen);
    ws.addEventListener("error", onerror);

    try {
      if (timeout) {
        await deadline(connected, timeout);
      } else {
        await connected;
      }
    } finally {
      ws.removeEventListener("open", onopen);
      ws.removeEventListener("error", onerror);
    }

    const send = (request: XFYunRequest) => {
      if (ws.readyState !== WebSocket.OPEN) {
        throw new XFYunConnectionClosed();
      }

      ws.send(JSON.stringify({
        common: {
          app_id: this.appid,
        },
        ...request,
      }));
    };

    const data = async function* () {
      const subscribe = new EventIterator((queue: any) => {
        ws.addEventListener("message", queue.push);
        ws.addEventListener("error", queue.fail);
        ws.addEventListener("close", queue.stop);

        return () => {
          ws.removeEventListener("message", queue.push);
          ws.removeEventListener("close", queue.fail);
          ws.removeEventListener("error", queue.stop);
        };
      });

      for await (const message of subscribe) {
        const data = JSON.parse(message.data) as XFYunResponse;
        yield data;

        if (data.data.status === 2) {
          return;
        }
      }
    };

    const close = async () => {
      if (ws.readyState === WebSocket.CLOSED) {
        return;
      }

      const closed = deferred();

      const onerror = (err: Event) => closed.reject(err);
      const onclose = () => closed.resolve();

      ws.addEventListener("close", onclose);
      ws.addEventListener("error", onerror);

      try {
        ws.close();
        await closed;
      } finally {
        ws.removeEventListener("error", onerror);
        ws.removeEventListener("close", onclose);
      }
    };

    return {
      [Symbol.asyncIterator]: data,
      ws,
      send,
      close,
    };
  }

  async *tts(req: TTSRequest): AsyncIterable<Uint8Array> {
    const connection = await this.connect(
      "tts-api.xfyun.cn",
      "/v2/tts",
    );

    const { text, ...business } = req;
    connection.send({
      business,
      data: {
        text: base64.encode(text),
        status: 2,
      },
    });

    for await (const data of connection) {
      const voice = base64.decode(data.data.audio);

      yield Uint8Array.from(voice);
    }

    await connection.close();
  }

  async *iat(req: IATRequest): AsyncIterable<IATResponse> {
    const { type, format, encoding, audio, ...business } = req;

    const host = type === "niche"
      ? "iat-api.xfyun.cn"
      : "iat-niche-api.xfyun.cn";

    const connection = await this.connect(host, "/v2/iat");

    let status = 0;

    audio.pipeTo(
      new WritableStream({
        async write(chunk: Uint8Array) {
          const frame = {
            data: {
              status,
              format,
              encoding,
              audio: base64.encode(chunk),
            },
          } as XFYunRequest;

          if (status === 0) {
            frame.business = business;
            status = 1;
          }

          connection.send(frame);
          await delay(40);
        },
        close() {
          const frame = {
            data: {
              status: 2,
              format,
              encoding,
              audio: "",
            },
          };

          connection.send(frame);
        },
      }),
    );

    for await (const data of connection) {
      yield data as IATResponse;
    }

    await connection.close();
  }
}
