import {
  message,
  createDataItemSigner,
  dryrun,
  result as fetchResult,
} from "@permaweb/aoconnect";
import { readFileSync } from 'fs';

const walletFilePath = process.env.WALLET || "~/.aos.json";
const wallet = readFileSync(walletFilePath, { encoding: "utf-8" });
const signer = createDataItemSigner(JSON.parse(wallet));

export type MessageInput = {
  process: string;
  data?: any;
  tags?: {
    name: string;
    value: string;
  }[];
  anchor?: string;
  Id?: string;
  Owner?: string;
};

export type MessageResult = {
  Output: any;
  Messages: any[];
  Spawns: any[];
  Error?: any;
};

export type DryRunResult = {
  Output: any;
  Messages: any[];
  Spawns: any[];
  Error?: any;
};

/**
 * Tag structure for AO messages
 */
export interface AOMessageTag {
  name: string;
  value: string;
}

/**
 * Helper class to interact with AO processes
 */
export class AOProcess {
  private processId: string;
  private isDevEnvironment: boolean;

  /**
   * @param {string} processId - AO Process ID
   * @param {boolean} isDevEnvironment - Whether the environment is development
   */
  constructor(processId: string, isDevEnvironment: boolean = false) {
    this.processId = processId;
    this.isDevEnvironment = isDevEnvironment;
  }

  /**
   * Convert object to array of name-value tag pairs
   * @param {Record<string, unknown>} obj - Object to convert to tags
   * @returns {Array<{name: string, value: string}>} - Array of tag objects
   */
  obj2tags(obj: Record<string, unknown>): AOMessageTag[] {
    return Object.entries(obj).map(([key, value]) => ({
      name: key,
      value: this.toString(value),
    }));
  }

  /**
   * Convert any value to string
   * @param {unknown} value - Value to convert to string
   * @returns {string} - String representation of value
   */
  toString(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number") {
      return value.toString();
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  /**
   * Format result from AO message
   * @param {MessageResult} result - AO message result
   * @returns {object} - Formatted result
   */
  formatResult(result: MessageResult): {
    resMsgs?: any[];
    resTags?: AOMessageTag[];
    resData?: any;
  } {
    if (result?.Messages?.length > 1) {
      return {
        resMsgs: result?.Messages,
      };
    } else {
      const data = result?.Messages?.[0]?.Data;
      let parsedData;
      try {
        parsedData = JSON.parse(data);
      } catch {
        parsedData = data;
      }
      return {
        resTags: result?.Messages?.[0]?.Tags,
        resData: parsedData,
      };
    }
  }

  /**
   * Get tags from message result
   * @param {MessageResult | DryRunResult | undefined} message - Message result
   * @param {number} index - Index of message to get tags from
   * @returns {Record<string, string> | undefined} - Tags as object
   */
  getTagsFromMessage<U extends Record<string, string> = Record<string, string>>(
    message: MessageResult | DryRunResult | undefined,
    index: number = 0
  ): U | undefined {
    return message?.Messages?.[index]?.Tags?.reduce(
      (acc: Record<string, string>, tag: AOMessageTag) => {
        acc[tag.name] = tag.value;
        return acc;
      },
      {} as U
    );
  }

  /**
   * Get data from message result
   * @param {MessageResult | DryRunResult | undefined} message - Message result
   * @param {number} index - Index of message to get data from
   * @returns {T | undefined} - Message data
   */
  getDataFromMessage<T = unknown>(
    message: MessageResult | DryRunResult | undefined,
    index: number = 0
  ): T | undefined {
    const data = message?.Messages?.[index]?.Data;
    try {
      return JSON.parse(data) as T;
    } catch {
      return data as unknown as T;
    }
  }

  /**
   * Log debug information
   * @param {Record<string, unknown>} tags - Request tags
   * @param {string} msgType - Message type
   * @param {unknown} data - Request data
   * @param {MessageResult} result - AO message result
   */
  logDebugInfo(
    tags: Record<string, unknown>,
    msgType: string,
    data: unknown,
    result: MessageResult
  ): void {
    console.log(`${tags.Action ?? ""} ${msgType}`, {
      reqTags: tags,
      reqData: data,
      output: result?.Output?.data,
      ...this.formatResult(result),
    });
  }

  /**
   * Log error
   * @param {Record<string, string>} tags - Request tags
   * @param {string} msgType - Message type
   */
  logError(tags: Record<string, string>, msgType: string): void {
    console.log(`${tags.Action ?? ""} ${msgType} failed`);
  }

  /**
   * Handle result and check for errors
   * @param {string} msgType - Message type
   * @param {MessageResult} result - AO message result
   * @param {Record<string, unknown>} tags - Request tags
   * @param {unknown} data - Request data
   * @param {boolean} checkStatus - Whether to check status tag
   */
  handleResult(
    msgType: string,
    result: MessageResult,
    tags: Record<string, unknown>,
    data: unknown,
    checkStatus: boolean
  ): void {
    const msgErr = result.Error;
    if (msgErr) {
      throw new Error(this.toString(msgErr));
    }

    const resultTags = this.getTagsFromMessage(result);
    if (
      checkStatus &&
      resultTags &&
      "Status" in resultTags &&
      resultTags.Status !== "200"
    ) {
      throw new Error(
        `${resultTags.Status} ${this.getDataFromMessage(result)}`
      );
    }

    if (this.isDevEnvironment) {
      this.logDebugInfo(tags, msgType, data, result);
    }
  }

  /**
   * Execute an AO process call
   * @param {string} msgType - Message type (message or dryrun)
   * @param {Record<string, string>} tags - Request tags
   * @param {unknown} data - Request data
   * @param {boolean} checkStatus - Whether to check status tag
   * @returns {Promise<MessageResult>} - AO message result
   */
  async execute(
    msgType: string,
    tags: Record<string, string>,
    data: unknown,
    checkStatus: boolean = true
  ): Promise<MessageResult> {
    const startTime = Date.now();
    try {
      let msgResult: MessageResult;
      const options: MessageInput = {
        process: this.processId,
        tags: this.obj2tags(tags),
        data: this.toString(data),
      };

      if (tags.Owner) {
        options.Owner = tags.Owner;
      }

      if (msgType === "dryrun") {
        msgResult = await dryrun(options);
      } else {
        // Using browser wallet for message signing
        const messageId = await message({
          ...options,
          signer,
        });
        msgResult = await fetchResult({
          message: messageId,
          process: this.processId,
        });
      }

      this.handleResult(msgType, msgResult, tags, data, checkStatus);

      // Log execution time in development
      if (this.isDevEnvironment) {
        const executionTime = ((Date.now() - startTime) / 1000).toFixed(0);
        console.log(
          `AO ${msgType} completed in ${executionTime}s`,
          tags.Action ?? ""
        );
      }

      return msgResult;
    } catch (e) {
      if (this.isDevEnvironment) {
        this.logError(tags, msgType);
        console.error(e);
      }
      throw e;
    }
  }

  /**
   * Send a message to the AO process
   * @param {Record<string, string>} tags - Request tags
   * @param {unknown} data - Request data
   * @param {boolean} checkStatus - Whether to check status tag
   * @returns {Promise<MessageResult>} - AO message result
   */
  async sendMessage(
    tags: Record<string, string>,
    data: unknown = null,
    checkStatus: boolean = true
  ): Promise<MessageResult> {
    return this.execute("message", tags, data, checkStatus);
  }

  /**
   * Perform a dryrun on the AO process
   * @param {Record<string, string>} tags - Request tags
   * @param {unknown} data - Request data
   * @param {boolean} checkStatus - Whether to check status tag
   * @returns {Promise<MessageResult>} - AO dryrun result
   */
  async dryRun(
    tags: Record<string, string>,
    data: unknown = null,
    checkStatus: boolean = true
  ): Promise<MessageResult> {
    return this.execute("dryrun", tags, data, checkStatus);
  }
}

export default AOProcess;
