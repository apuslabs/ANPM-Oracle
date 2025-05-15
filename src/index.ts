import * as dotenv from "dotenv";
// Load environment variables
dotenv.config();

import { AOProcess } from "./utils/AOProcess";
import axios from "axios";
import * as os from "os";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import logger from "./utils/logger";

// Path to .env file
const envFilePath = path.join(__dirname, "..", ".env");

// Constants
const POOL_PROCESS_ID = process.env.POOL_PROCESS_ID || "";
const HYPERBEAM_URL = process.env.HYPERBEAM_URL || "http://localhost:10000";
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "1000", 10);

// Generate or load NODE_ID
let NODE_ID = process.env.NODE_ID || "";
if (NODE_ID === "") {
  // Generate a unique node ID if one isn't provided
  NODE_ID = generateNodeId();

  // Save NODE_ID to .env file for persistence
  saveNodeIdToEnv(NODE_ID);

  logger.info(`Generated new Node ID: ${NODE_ID} and saved to .env file`);
} else {
  logger.info(`Using existing Node ID: ${NODE_ID}`);
}

/**
 * Generate a unique node ID
 * @returns {string} A unique identifier
 */
function generateNodeId(): string {
  // Create a unique ID based on hostname and random values
  const hostname = os.hostname();
  const randomPart = crypto.randomBytes(16).toString("hex");
  return `${hostname}-${randomPart}`;
}

/**
 * Save NODE_ID to .env file
 * @param {string} nodeId - The node ID to save
 */
function saveNodeIdToEnv(nodeId: string): void {
  try {
    // Read existing .env file content if it exists
    let envContent = "";
    if (fs.existsSync(envFilePath)) {
      envContent = fs.readFileSync(envFilePath, "utf8");
    }

    // Check if NODE_ID is already in the file
    if (envContent.includes("NODE_ID=")) {
      // Replace existing NODE_ID
      envContent = envContent.replace(
        /NODE_ID=.*(\r?\n|$)/,
        `NODE_ID=${nodeId}$1`
      );
    } else {
      // Add NODE_ID to the file
      envContent += `${
        envContent.endsWith("\n") ? "" : "\n"
      }NODE_ID=${nodeId}\n`;
    }

    // Write back to .env file
    fs.writeFileSync(envFilePath, envContent);
  } catch (error) {
    logger.error("Failed to save NODE_ID to .env file:", { error });
  }
}

/**
 * Make a request to HyperBEAM for AI inference
 *
 * @param prompt - The user's prompt to process
 * @param config - Configuration parameters for the model
 * @returns The inference result
 */
async function runHyperBeamInference(
  prompt: string,
  config: any
): Promise<string> {
  try {
    // Prepare parameters for the request
    const queryParams = new URLSearchParams();
    queryParams.append("prompt", prompt);

    // Only add config if it's provided
    if (config) {
      queryParams.append("config", JSON.stringify(config));
    }

    logger.info(`Sending inference request to HyperBEAM`, {
      prompt: prompt.substring(0, 50) + (prompt.length > 50 ? "..." : ""),
    });

    const response = await axios.get(
      `${HYPERBEAM_URL}/~wasi-nn@1.0/run_inference_http?${queryParams.toString()}`,
      {
        timeout: 120000, // 2 minute timeout for inference
      }
    );

    return response.data;
  } catch (error: any) {
    logger.error("HyperBEAM inference failed", {
      error: error.message,
      responseData: error.response?.data,
      responseStatus: error.response?.status,
    });
    throw new Error(`HyperBEAM inference failed: ${error.message}`);
  }
}

/**
 * Main function to run the Oracle node
 */
async function main() {
  if (!POOL_PROCESS_ID) {
    logger.error("POOL_PROCESS_ID environment variable is not set");
    process.exit(1);
  }

  logger.info("Starting ANPM Oracle", {
    nodeId: NODE_ID,
    poolProcessId: POOL_PROCESS_ID,
    hyperbeamUrl: HYPERBEAM_URL,
  });

  // Initialize connection to AO process
  const poolProcess = new AOProcess(POOL_PROCESS_ID, false);

  // Process tasks in a continuous loop
  while (true) {
    try {
      logger.debug("Requesting pending task from Pool...");

      // Request a pending task from the Pool
      // Dryrun a pending task from the Pool
      // If there is pending tasks, then send real request
      const hasPendingTaskResult = await poolProcess.dryRun({
        Action: "Has-Pending-Task",
      });

      const hasPendingTaskResultTags = poolProcess.getTagsFromMessage(hasPendingTaskResult) || {};
      if (hasPendingTaskResultTags.Code === "204") {
        logger.info("No pending tasks available, Skipping...");
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
        continue;
      }

      const result = await poolProcess.sendMessage({
        Action: "Get-Pending-Task",
        NodeID: NODE_ID,
      });

      const resultTags = poolProcess.getTagsFromMessage(result) || {};

      // Check if we got a task
      if (resultTags.Code === "200") {
        const taskData = poolProcess.getDataFromMessage<{
          ref: string;
          prompt: string;
          config?: any;
        }>(result);

        if (taskData) {
          logger.info(`Received task ${taskData.ref}`, {
            prompt:
              taskData.prompt.substring(0, 50) +
              (taskData.prompt.length > 50 ? "..." : ""),
          });

          // Process the task using HyperBEAM
          logger.info(`Processing task ${taskData.ref} with HyperBEAM`);
          const output = await runHyperBeamInference(
            taskData.prompt,
            taskData.config
          );

          logger.info(`Task ${taskData.ref} completed, sending response...`);

          // Send the result back to the Pool
          await poolProcess.sendMessage(
            {
              Action: "Task-Response",
              "X-Oracle-Node-Id": NODE_ID,
              "X-Reference": taskData.ref,
            },
            {
              output,
            }
          );

          logger.info(`Task ${taskData.ref} response sent successfully`);
        }
      } else if (resultTags.Code === "204") {
        logger.info("No pending tasks available");
      } else if (resultTags.Code === "403") {
        logger.error(
          "Oracle not authorized. Make sure this Node ID is registered in the Pool"
        );
        process.exit(1);
      } else {
        logger.warn(`Unexpected response from Pool`, { code: resultTags.Code });
      }

      // Wait before polling again
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    } catch (error: any) {
      logger.error("Error in main loop", {
        error: error.message,
        stack: error.stack,
      });

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }
  }
}

// Start the Oracle node
main().catch((error) => {
  logger.error("Fatal error:", {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});
