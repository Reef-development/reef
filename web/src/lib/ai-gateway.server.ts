import { createOpenAI } from "@ai-sdk/openai";

export function createLovableAiGatewayProvider(apiKey: string) {
  return createOpenAI({
    name: "lovable",
    apiKey,
    baseURL: "https://ai.gateway.lovable.dev/v1",
  });
}