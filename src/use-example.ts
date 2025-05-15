import * as dotenv from "dotenv";
dotenv.config();
import AOProcess from "./utils/AOProcess";
import { randomUUID } from "crypto";
// Load environment variables
dotenv.config();

const POOL_PROCESS_ID = process.env.POOL_PROCESS_ID || "";

const prompt = "Who are you?";

async function main() {
    const poolProcess = new AOProcess(POOL_PROCESS_ID, false);
    const taskID = randomUUID();
    await poolProcess.sendMessage({
        Action: "Add-Task",
        Reference: taskID,
    }, JSON.stringify({
        prompt,
    }))
    console.log("Task added:", taskID, "Prompt: ", prompt);
    while (true) {
        const result = await poolProcess.sendMessage({
            Action: "Get-Task-Response",
        }, taskID);
        const resultTags = poolProcess.getTagsFromMessage(result) || {};
        if (resultTags.Code === "200") {
            const taskData = poolProcess.getDataFromMessage<{
                ref: string;
                prompt: string;
                config?: any;
                status: string;
                resolve_node: string;
                output: string;
                created_at: number;
                updated_at: number;
                submitter: string;
            }>(result);
            if (taskData) {
                if (taskData.status === "pending") {
                    console.log("Task is waiting for processing...");
                } else if (taskData.status === "done") {
                    console.log("Task completed:", taskData.output);
                    break;
                } else {
                    console.log("Task status:", taskData.status);
                }
            } else {
                console.error("No task data found");
            }
        } else {
            console.log(result)
            console.error(result.Error || "Unknown error");
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
}

main().then(() => {
    process.exit(0);
})