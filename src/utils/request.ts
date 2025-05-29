import { MessageResult } from "./AOProcess"
import { extractMessage, getHBCache, requestHB } from "./hb"

const PoolProcess = process.env.POOL_PROCESS_ID || "Zvk33TZcp2maje5ewY4tm4TN1479ncUaTmmqHihXwUA"

export function hasPendingTask(): Promise<boolean> {
  return getHBCache<string>(PoolProcess, "pending_taskcount").then(res => Number(res) > 0)
}

export function receiveTask(nodeID: string): Promise<{
  ref: string;
  prompt: string;
  config?: any;
}> {
  return requestHB<MessageResult>(PoolProcess, {
      Action: "Get-Pending-Task",
      Nodeid: nodeID,
  }).then(msg => {
    if (msg.Error) {
      throw new Error(msg.Error);
    }
    const { tags, data } = extractMessage(msg, 0);
    if (tags.Code === "200") {
      return msg.Messages;
    } else if (tags.Code === "403") {
      return msg.Error("Oracle not authorized. Make sure this Node ID is registered in the Pool");
      process.exit(1);
    } else if (tags.Code === "204") {
      throw new Error("No pending tasks available");
    } else {
      throw new Error(tags.Error || data || "Unknown error");
    }
  }).then(messages => {
    return JSON.parse(messages[0].Data)
  })
}

export function sendTaskResponse(nodeID: string, ref: string, output: any): Promise<MessageResult> {
  return requestHB<MessageResult>(PoolProcess, {
      Action: "Task-Response",
      "X-Oracle-Node-Id": nodeID,
      "X-Reference": ref,
  }, {
    output
  })
}