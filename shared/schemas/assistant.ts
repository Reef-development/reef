import { z } from "zod";
import { Id } from "./common.js";

export const AskInput = z
  .object({
    question: z.string().trim().min(3, "Ask a question").max(500),
    mine_id: Id.optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .strict();
export type AskInput = z.infer<typeof AskInput>;

/** One figure the answer is allowed to contain, as it was read out of the records. */
export type Figure = { label: string; value: string };

export type AssistantAnswer = {
  answer: string;
  /** Every figure the answer was built from, so a reader can check it against the records. */
  figures: Figure[];
  /** What the question was taken to be asking. */
  intent: string;
  /** What the figures cover, in words. */
  scope: string;
  /**
   * True when a written answer was discarded because it contained a number that is not in
   * `figures`, and the plain listing below was sent instead.
   */
  discarded: boolean;
};
