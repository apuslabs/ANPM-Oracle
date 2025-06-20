const { connect, createSigner } = require("@permaweb/aoconnect");
import axios from "axios";
import { readFileSync } from "fs";
import { AOMessageTag, MessageResult } from "./AOProcess.js";

const HB_NODE = process.env.HYPERBEAM_URL || "http://localhost:10000";

const walletFilePath = process.env.WALLET || "~/.aos.json";
const wallet = readFileSync(walletFilePath, { encoding: "utf-8" });
const ao = connect({
  MODE: "mainnet",
  device: "process@1.0",
  signer: createSigner(JSON.parse(wallet)),
  URL: HB_NODE,
});

export function requestHB<U>(
  processId: string,
  tags: Record<string, string>,
  data?: string | Record<string, unknown>
): Promise<U> {
  const params = {
    type: "Message",
    path: `/${processId}~process@1.0/push/serialize~json@1.0`,
    method: "POST",
    ...tags,
    data: data || "",
    "data-protocol": "ao",
    variant: "ao.N.1",
    target: processId,
  };
  const params2 = Object.entries(params)
    .filter((v) => !!v[1])
    .reduce((acc, [key, value]) => {
      acc[key] =
        typeof value === "object" ? JSON.stringify(value) : String(value);
      return acc;
    }, {} as Record<string, string>);

  return ao
    .request(params2)
    .then((res: { body: unknown }) => {
      if (!res.body) {
        throw new Error("No response received");
      }
      try {
        return JSON.parse(res.body as unknown as string);
      } catch {
        throw new Error("Could not parse response");
      }
    })
    .then(
      (resBody: {
        info: string;
        error: string | undefined;
        output: any;
        json: { error: string | undefined; body: U };
      }) => {
        if (resBody?.info === "hyper-aos") {
          if (resBody?.error) {
            throw new Error(resBody.error);
          }
          return resBody.output;
        } else {
          if (resBody?.json?.error) {
            throw new Error(resBody.json.error);
          }
          return resBody.json?.body as U;
        }
      }
    )
    .then((output: unknown) => {
      if (!output) {
        throw new Error("No body in response");
      }
      try {
        return JSON.parse(output as unknown as string) as U;
      } catch {
        return output as U;
      }
    });
}

export function getHBCache<U>(processId: string, cacheKey: string): Promise<U> {
  return axios
    .get(`${HB_NODE}/${processId}~process@1.0/now/${cacheKey}`)
    .then((res) => res.data)
    .then((res) => {
      if (res === null || res === undefined) {
        throw new Error("No response received");
      }
      try {
        return JSON.parse(res as unknown as string) as U;
      } catch {
        return res as U;
      }
    });
}

export function extractMessage(msg: MessageResult, idx: number) {
  if (!msg || !msg.Messages) {
    throw new Error("Invalid message format");
  }
  if (idx < 0 || idx >= msg.Messages.length) {
    throw new Error("Index out of bounds");
  }
  const data = msg.Messages[idx];
  return {
    tags: (data.Tags as AOMessageTag[]).reduce((acc, tag) => {
      acc[tag.name] = tag.value;
      return acc;
    }, {} as Record<string, string>),
    data: data.Data,
  };
}

export function handleApusMessage(msg: MessageResult): any[] {
  if (msg.Error) {
    throw new Error(msg.Error);
  }
  const { tags, data } = extractMessage(msg, 0);
  if (tags.Code && tags.Code !== "200") {
    throw new Error(tags.Error || data || "Unknown error");
  }
  return msg.Messages;
}
